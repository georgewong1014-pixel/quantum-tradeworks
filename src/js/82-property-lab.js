/* ==========================================================================
   THE SCENARIO LAB — /property/lab (the owner's decision, 3 Oct 2026)
   --------------------------------------------------------------------------
   "As the user moves a slider, everything changes immediately: monthly
   repayment → cash required → cash flow → yield → break-even occupancy →
   projected equity → exit outcome. No Calculate button." Five sliders —
   price, deposit, rate, rent and renovation — over up to three columns, A,
   B and C, set side by side six ways.

   WHAT IT IS MADE OF, AND WHAT IT IS NOT.
   - One model. Every figure is the calculator's own (dealModel and
     propertyGrade, 75-property-grade.js), run on a column's inputs. The
     lab's own arithmetic is the change against a baseline, the scaling of a
     bar and the assumed occupancy tick (100 less the vacancy entered); it
     names none of the model's functions (model-test L3 holds it to that).
   - "Projected equity" is "Value less loan, year N (before selling costs)":
     equity already means the equities comparison and the cash committed on
     these pages (the owner's answer, 3 Oct 2026). Net sale proceeds and the
     total profit are the full report's, as on the calculator: shown only
     where the report is unlocked.
   - Moves are what-ifs. They are kept in this tab's memory, per column, and
     nothing is written — no store key, no address, no saveDeal — until the
     reader commits one: Save as a scenario, Update the scenario, or Open in
     the calculator. A commit is the reader typing those figures, so it
     marks them theirs exactly as the calculator does (markTouched) — and
     only then.
   - Nothing is ranked. The columns stay in the order A, B, C whatever is
     compared, no colour marks one as preferable, and changing what is
     compared changes the chart's form and scale, never its order.

   A PANEL, SO THE MAP CAN MOUNT IT. scenarioLabPanel draws the whole lab
   into any box, every id under its own prefix, so the Kuching map's side
   sheet can mount a compact one beside the page's (phase 3). labOpen is how
   anything opens a subject; labSubscribe is how anything hears a paint.
   LAB_FIGURES is global for the client proposal (phase 4), so the proposal
   and the lab cannot word or compute a figure differently.
   ========================================================================== */

/* ------------------------------------------------------------------ formats */
/* Money to the ringgit, never fmtAmount's "RM2.4k": one 0.05pp step of the
   rate moves the repayment by about RM16, which "RM2.4k" hides. A figure the
   model withholds prints as a dash, never 0. */
const LAB_FORMATS = {
  money0: (v) => fmtMoney(v, 'MYR', 0),
  pct2: (v) => fmtPct(v, 2),
  pct1: (v) => fmtPct(v, 1),
  x2: (v) => fmtX(v, 2),
  grade: (v) => (v == null || v === '' ? '—' : String(v)),
};
const labMoney = (v) => LAB_FORMATS.money0(v);
/* An entered percentage as entered: 90%, 4.3%, 89.65% — not a fixed scale. */
const labPctIn = (v) => (isNum(v) ? `${+Number(v).toFixed(2)}%` : '—');
const labYears = (n) => `${n} year${Number(n) === 1 ? '' : 's'}`;
/* A figure as printed, read back: "−RM1,197" is −1197, "2.47%" 2.47. */
const labPrinted = (s) => { const t = String(s); const n = Number(t.replace(/[^0-9.]/g, '')); return /^[−-]/.test(t) ? -n : n; };
/* The change between two figures in a format, in words for the ear and in
   a mark for the eye. Two figures that print the same are unchanged, so a
   change no reader could see is not announced as one. THE CHANGE BETWEEN THE
   FIGURES AS PRINTED: worked from the raw values it was rounded on its own,
   and disagreed with the two figures beside it — RM130,142 less RM106,245
   marked "▼ RM23,896", and a net yield that printed 2.47% then 2.46% marked
   "▼ 0.00 pp" (the verification of 4 Oct 2026). */
function labDelta(fmt, now, was) {
  if (!isNum(now) || !isNum(was)) return null;
  const f = LAB_FORMATS[fmt];
  const a = f(now), b = f(was);
  if (a === b) return { same: true, mark: 'unchanged', words: 'unchanged' };
  const dp = fmt === 'money0' ? 0 : fmt === 'pct1' ? 1 : 2;
  const d = +(labPrinted(a) - labPrinted(b)).toFixed(dp), up = d > 0;
  const size = fmt === 'money0' ? labMoney(Math.abs(d)) : fmt === 'x2' ? `${Math.abs(d).toFixed(2)}×` : `${Math.abs(d).toFixed(dp)} pp`;
  return { same: false, up, mark: `${up ? '▲' : '▼'} ${size}`, words: `${up ? 'up' : 'down'} ${size}` };
}

/* ------------------------------------------------------------------- inputs */
/* THE FIVE KNOBS. Each span is a setting of this page, not market data:
   anchored on the column's own figure as saved (or as opened), stated with
   its basis beside the slider, and widened to take any figure typed into
   the box, so the thumb is never pinned at an end it does not belong at. */
const labSnap = (v, step) => +(Math.round(v / step) * step).toFixed(step < 1 ? 2 : 0);
const LAB_INPUTS = [
  { k: 'price', label: () => ptr('in.price', 'Purchase price (RM)'), say: 'Purchase price', short: 'Price', step: 1000,
    span: (a) => [Math.max(0, labSnap(a * 0.75, 1000)), labSnap(a * 1.25, 1000)],
    basis: '±25% of as saved', why: ', to RM1,000 — five of the sensitivity panel’s 5% steps',
    shown: (v) => labMoney(v), spoken: (v) => `${fmtNum(v, 0)} ringgit` },
  { k: 'downPct', label: () => ptr('in.downPct', 'Deposit (%)'), say: 'Deposit', short: 'Deposit', step: 1,
    span: () => [0, 100], basis: 'the model’s own limits on a deposit',
    shown: (v) => labPctIn(v), spoken: (v, m) => `${fmtNum(v, 0)} percent${isNum(m?.deposit) ? `, ${fmtNum(m.deposit, 0)} ringgit` : ''}`,
    ticks: [10, 20, 30] },
  { k: 'ratePct', label: () => ptr('in.ratePct', 'Loan interest rate (%)'), say: 'Interest rate', short: 'Rate', step: 0.05,
    span: (a) => [Math.max(0, labSnap(a - 3, 0.05)), labSnap(a + 3, 0.05)],
    basis: '±3 pp of as saved, never below 0', why: ' — the model’s stress rows',
    shown: (v) => `${fmtNum(v, 2)}% a year`, spoken: (v) => `${fmtNum(v, 2)} percent a year` },
  { k: 'rent', label: () => ptr('in.rent', 'Expected monthly rent (RM)'), say: 'Rent', short: 'Rent', step: 50,
    span: (a) => [Math.max(0, labSnap(a * 0.5, 50)), labSnap(a * 1.5, 50)],
    basis: '±50% of as saved', why: ', to RM50 — five 10% rent steps',
    shown: (v) => `${labMoney(v)} a month`, spoken: (v) => `${fmtNum(v, 0)} ringgit a month` },
  { k: 'renovation', label: () => ptr('in.renovation', 'Renovation and furnishing (RM)'), say: 'Renovation', short: 'Reno', step: 500,
    span: (a) => [0, labSnap(a * 2, 500)], basis: 'nothing to twice as saved', why: ' — the model’s +100% overrun row',
    shown: (v) => labMoney(v), spoken: (v) => `${fmtNum(v, 0)} ringgit` },
];
const LAB_INPUT_BY_K = Object.fromEntries(LAB_INPUTS.map(x => [x.k, x]));
/* An end of a span, as the span note prints it. */
const labEdge = (inp, v) => (inp.k === 'downPct' || inp.k === 'ratePct' ? `${fmtNum(v, inp.k === 'ratePct' ? 2 : 0)}%` : labMoney(v));
/* Whether a knob means anything for this column's class: a parcel has no
   tenancy, so nothing uses a rent (propertyInputApplies, 70-property.js). */
const labApplies = (d, k) => propertyInputApplies(d, k);
const LAB_NOT_APPLY = { rent: 'A parcel has no tenancy, so nothing uses a rent.' };

/* ------------------------------------------------------------------ figures */
/* THE CHAIN, IN THE OWNER'S ORDER. Each row reads one field of the model's
   result and words its formula from the model's own fields and the
   formatters — never from a figure the lab worked out. `help` is a
   METRIC_HELP key (00-core.js). Global: the client proposal will read it. */
const labWhose = (d, k) => (isTouched(d, k) ? 'your assumption' : 'sample assumption — chosen by nobody');
const LAB_FIGURES = [
  { key: 'instalment', label: () => 'Monthly repayment', fmt: 'money0', help: 'propInstalment',
    read: (m) => m.instalment,
    note: (m) => (!(m.loan > 0) ? 'No loan' : !isNum(m.instalment) ? 'Not computable — the tenure is 0' : null),
    formula: (d, m) => {
      if (!(m.loan > 0)) return 'No loan: the deposit is the whole of the value the lender lends against, so nothing is repaid.';
      if (!isNum(m.instalment)) return `Not computable — the loan tenure is ${labYears(num0(d.tenureYears))}, and a loan with no years has no schedule of repayments.`;
      const basis = m.financingBasisConfirmed
        ? `${m.valuationRule === 'valuation_only' ? 'the valuation' : 'the lower of the price and the valuation'} — a valuation of ${labMoney(m.bankValuation)} is entered`
        : 'the price — no valuation entered';
      return `Loan ${labMoney(m.loan)} = ${labPctIn(m.marginOfFinancePct)} of the lender’s value basis ${labMoney(m.lenderValueBasis)} (${basis}), at ${fmtNum(num0(d.ratePct), 2)}% a year over ${labYears(num0(d.tenureYears))}, reducing balance → ${labMoney(m.instalment)} a month.`
        + (m.financingBasisConfirmed && m.valuationRule !== 'valuation_only'
          ? ` Under the lower-of rule the loan stops following the price above the valuation of ${labMoney(m.bankValuation)}.` : '');
    } },
  { key: 'safeCashRequired', label: () => 'Cash required', fmt: 'money0', help: 'propSafeCash',
    read: (m) => m.safeCashRequired,
    note: (m) => [(m.missingCostLines || []).length ? 'so far' : null,
      `${labMoney(m.unconfirmedCost)} on unverified fees`].filter(Boolean).join(' · '),
    formula: (d, m) => `${labMoney(m.transactionCash)} to complete + ${labMoney(m.improvementCash)} renovation and set-up + `
      + `${isNum(m.reserveCash) ? `${labMoney(m.reserveCash)} reserve (${labYears(m.reserveMonths).replace('year', 'month')})` : 'a reserve that cannot be priced'}`
      + ` = ${labMoney(m.safeCashRequired)}${(m.missingCostLines || []).length ? ' so far' : ''}. Still to pay on completion: ${labMoney(m.cashStillRequiredToComplete)}. `
      + `${labMoney(m.unconfirmedCost)} of it rests on fee lines not yet verified against their schedules, ${(m.placeholderCostLines || []).length} of them placeholders (fee table ${FEE_TABLE.version}).` },
  { key: 'cashflowMonthly', label: () => 'Monthly position', fmt: 'money0', help: 'propCashflow', neg: true,
    read: (m) => m.cashflowMonthly,
    note: (m) => (!isNum(m.cashflowMonthly) ? 'Not computable — the loan has no schedule'
      : m.taxComputed && isNum(m.path?.[0]?.cf) ? `after tax on the rent: ${labMoney(m.path[0].cf / 12)}` : 'before tax on the rent'),
    formula: (d, m) => (!isNum(m.cashflowMonthly)
      ? 'Not computable: with no repayment schedule the loan’s monthly cost is unknown, and so is what is left of the rent.'
      : m.letsToTenant
        ? `NOI ${labMoney(m.noi)} a year ÷ 12 − repayment ${labMoney(m.instalment)} = ${labMoney(m.cashflowMonthly)} a month, before tax on the rent.`
        : `No rent for this class: running costs of ${labMoney(m.opex)} a year ÷ 12 − repayment ${labMoney(m.instalment)} = ${labMoney(m.cashflowMonthly)} a month.`) },
  { key: 'netYield', label: () => 'Net yield', fmt: 'pct2', help: 'netYield',
    read: (m) => m.netYield,
    note: (m) => (m.letsToTenant === false ? 'not a quantity this asset has' : isNum(m.grossYield) ? `gross ${fmtPct(m.grossYield, 2)}` : null),
    formula: (d, m) => (m.letsToTenant === false
      ? 'Not a quantity this asset has: a class with no tenancy earns no rent to measure against the price.'
      : `NOI ${labMoney(m.noi)} a year ÷ price ${labMoney(num0(d.price))} = ${fmtPct(m.netYield, 2)}. Before the loan, so the deposit and the rate do not move it.`) },
  { key: 'breakEvenOccupancy', label: () => 'Break-even occupancy', fmt: 'pct1', help: 'propBreakEvenOccupancy',
    read: (m) => m.breakEvenOccupancy,
    note: (m) => (m.letsToTenant === false ? 'not a quantity this asset has'
      : !isNum(m.breakEvenOccupancy) ? 'Not computable'
      : m.breakEvenOccupancy > 100 ? 'cannot break even at this rent, however full' : null),
    formula: (d, m) => (!isNum(m.breakEvenOccupancy)
      ? (m.letsToTenant === false ? 'Not a quantity this asset has: there is no rent to fill.' : 'Not computable: the loan’s annual cost is unknown, or there is no rent to divide by.')
      : `(${labMoney(m.fixedOperatingCosts)} fixed costs + ${labMoney(m.annualDebtService)} debt service) ÷ (${labMoney(m.grossAnnualRent)} rent × (1 − ${fmtPct(m.variableCostRate * 100, 1)} variable costs)) = ${fmtPct(m.breakEvenOccupancy, 1)}.`
        + (m.breakEvenOccupancy > 100 ? ' Above 100% the property cannot cover its costs at this rent however full it is.' : '')) },
  { key: 'valueLessLoanAtExit', label: (d) => `Value less loan, year ${normHoldYears(d?.holdYears)} (before selling costs)`, fmt: 'money0', help: 'propValueLessLoan',
    read: (m) => m.valueLessLoanAtExit,
    note: (m) => (isNum(m.valueLessLoanAtExit) ? null : 'Not computable — the loan has no schedule'),
    formula: (d, m) => {
      const n = normHoldYears(d.holdYears);
      return `Value at year ${n} ${labMoney(m.exitValue)} (${labMoney(num0(d.price))} grown at ${fmtNum(num0(d.apprecPct), 1)}% a year — ${labWhose(d, 'apprecPct')} — for ${labYears(n)}, plus ${labMoney(m.renoRecovered)} of the renovation recovered) less the loan still owed, ${isNum(m.outstanding) ? labMoney(m.outstanding) : 'which cannot be computed'}.`;
    } },
  { key: 'irrPct', label: (d) => `If sold in year ${normHoldYears(d?.holdYears)}`, fmt: 'pct2', help: 'propIrr',
    read: (m) => m.irrPct,
    note: (m, d) => (isNum(m.irrPct) ? `rate of return on ${labMoney(m.equityOut)} committed` : (m.irrWhy || 'Not computable')),
    formula: (d, m) => {
      const n = normHoldYears(d.holdYears), rr = m.rpgtResult;
      return (isNum(m.irrPct) ? `The rate of return that sets every year’s cash flow after tax, and a sale in year ${n}, against the ${labMoney(m.equityOut)} committed at the start (the reserve comes back at the sale). The sale is priced at ${fmtNum(num0(d.apprecPct), 1)}% a year growth — ${labWhose(d, 'apprecPct')}. `
        : `No rate of return: ${m.irrWhy || 'the flows do not give one'}. `)
        + (rr ? `Selling in year ${n}: ${rr.why} ${rr.tax > 0 ? `That is ${labMoney(rr.tax)} on a gain of ${labMoney(rr.chargeableGain)} after ${labMoney(rr.allowable)} of allowable costs.` : 'Nothing is charged on this scenario.'} `
          + 'Rates are cited to Schedule 5 of the Real Property Gains Tax Act and have not been verified against the current schedule or any exemption order in force. Confirm before relying on the figure.' : '');
    } },
];
/* The report's two figures, in row 7 where it is unlocked (75-property-grade.js,
   propertyReportUnlocked — the calculator's own test). */
const LAB_PAID = [
  { key: 'netExitProceeds', label: 'Net sale proceeds', fmt: 'money0', help: 'propNetExit',
    formula: (d, m) => `${labMoney(m.valueLessLoanAtExit)} value less loan − agent ${labMoney(m.agentFee)} − legal ${labMoney(m.exitLegal)} − gains tax ${labMoney(m.rpgt)} − months carried while selling ${labMoney(m.carryWhileSelling)} = ${labMoney(m.netExitProceeds)}.` },
  { key: 'totalProfit', label: 'Total profit', fmt: 'money0', help: null,
    formula: (d, m) => `Every year’s cash flow after tax, plus the net sale proceeds, less the ${labMoney(m.acquisitionCost)} of cash the purchase took (everything paid out but the reserve): ${labMoney(m.totalProfit)}.` },
];
const labPaid = (d) => !!d && propertyReportUnlocked(d.projectId);

/* -------------------------------------------------------------- comparison */
/* THE SIX WAYS TO COMPARE. Each names the model's field its headline reads
   (data-field on its table) and draws a form of its own: bars, bars about
   nought, a stack, three panels on their own axes, or facts with no bars. */
const LAB_METRICS = [
  { id: 'yield', label: 'Yield', say: 'net yield' },
  { id: 'cashflow', label: 'Cash flow', say: 'the monthly position' },
  { id: 'entry', label: 'Entry cash', say: 'cash required' },
  { id: 'appreciation', label: 'Appreciation', say: 'the value at the sale' },
  { id: 'risk', label: 'Risk', say: 'break-even occupancy' },
  { id: 'location', label: 'Location', say: 'location' },
];
const LAB_METRIC_IDS = LAB_METRICS.map(x => x.id);

/* -------------------------------------------------------------------- state */
/* LAB[subject] = { key, model, cols: [{ key, source, name, of, baseInputs,
   moves, work, ref, cur }], active, input, metric, gesture, naming }, in
   module memory: kept while the tab lives, gone on a reload, as the header
   says. `moves` holds exactly the figures whose pmCanon differs from the
   column's baseInputs — what pmDiff would save — and `work` is baseInputs
   with them, written one key a tick. */
const LAB = {};
const LAB_LETTERS = ['A', 'B', 'C'];
const LAB_SOURCE_CHIP = { deal: 'On the calculator', current: 'On the calculator', base: 'As saved', sc: 'Scenario', variant: 'Lab variant — not saved' };
let labSubject = null;          /* the page's subject */
let labUrlSeen = null;          /* the address last read on arrival */
let labArrivalNote = null;      /* said for the arrival that needed it */
const LAB_LISTENERS = new Set();
const LAB_PANELS = new Set();

const labKeyOf = (spec) => (spec?.kind === 'model' ? `m:${spec.id}` : 'deal');
const labSourceKind = (c) => (String(c.source).startsWith('sc:') ? 'sc' : c.source);
/* The figures run: none without a price, which the model cannot carry
   (an emptied price box is not nought — 75-property-grade.js). */
const labRun = (d) => (d && num0(d.price) > 0 ? pmCompareRun(d) : null);
/* `inherited`: the moves a copy was made with — the figures the column it
   copied had moved in the lab — which a commit marks as the reader's with
   the copy's own (labMarked). */
function labCol(key, source, name, baseInputs, extra = {}) {
  const base = pmBare(pmCopy(baseInputs || {}));
  return { key, source, name, of: null, inherited: {}, baseInputs: base, moves: {}, work: pmCopy(base), ref: labRun(base), cur: null, ...extra };
}
/* One figure of a column moved: the work takes it, and it is a move only
   while it differs from the column's base. The column's run is then not its
   figures' any more: it is dropped, and the next paint runs them (the
   active column, in labPaint) or takes the kept run (any other). A run kept
   past a change of its column's figures is how the lab came to show the old
   figures under new inputs (the verification of 4 Oct 2026, F1). */
function labWrite(col, k, v) {
  col.work[k] = v;
  if (pmCanon(v) === pmCanon(col.baseInputs[k])) delete col.moves[k]; else col.moves[k] = v;
  col.cur = null;
  /* The work's edition, for what is worked out from it once and kept
     (labBaseline). A new work object is a new edition by itself. */
  col.ver = (col.ver || 0) + 1;
}
const labMoveCount = (col) => Object.keys(col.moves).length;
/* The figures a commit of this column marks as the reader's: its own moves
   and the moves it was copied with. */
const labMarked = (col) => [...new Set([...Object.keys(col.inherited || {}), ...Object.keys(col.moves)])];
/* The name of the column that is the calculator's deal, as that deal is
   now: the sample until the reader changes a figure of it. */
const labDealName = () => (propertyStatus(State.deal).kind === 'sample' ? 'Sample deal' : 'On the calculator');
/* The subject a plain /property/lab opens: the calculator's deal, which is
   a saved property's once one is open there. */
const labDealSubject = () => { const st = propertyStatus(State.deal); return st.kind === 'model' ? `m:${st.rec.id}` : 'deal'; };

/* The inputs a column's source holds now, from where they are kept. */
function labSourceInputs(lab, col) {
  const k = labSourceKind(col);
  if (k === 'deal') return pmBare(State.deal);
  if (!lab.model) return null;
  const rec = pmFind(lab.model);
  if (!rec) return null;
  if (k === 'base') return pmInputsOf(rec);
  if (k === 'sc') { const sc = pmScenario(rec, col.source.slice(3)); return sc ? pmSavedInputs(rec, sc) : null; }
  if (k === 'current') return State.deal?.modelId === rec.id ? pmBare(State.deal) : null;
  return null;
}
/* WHAT IS KEPT ELSEWHERE MAY HAVE CHANGED SINCE: the calculator edited, a
   scenario saved again, renamed or deleted. Each drawing of the page reads
   each column's source again; a column keeps its moves on its new base (a
   move the base now holds is no longer a move), and one whose source is
   gone is kept as a lab variant, said so by its name. */
function labRebase(lab) {
  const rec = lab.model ? pmFind(lab.model) : null;
  if (lab.model && !rec) return false;
  for (const col of lab.cols) {
    if (col.source === 'variant') continue;
    const now = labSourceInputs(lab, col);
    if (!now) { col.name = `${col.name} — ${labSourceKind(col) === 'sc' ? 'no longer saved' : 'no longer on the calculator'}`; col.source = 'variant'; continue; }
    const base = pmBare(pmCopy(now));
    if (labSourceKind(col) === 'sc') { const sc = pmScenario(rec, col.source.slice(3)); if (sc) col.name = sc.name; }
    /* The calculator's deal is named as it is now: "Sample deal" is not the
       name of a deal the reader has since changed (F2). */
    if (labSourceKind(col) === 'deal') col.name = labDealName();
    if (pmCanon(base) === pmCanon(col.baseInputs)) continue;
    col.baseInputs = base;
    const moves = col.moves;
    col.moves = {};
    col.work = pmCopy(base);
    col.cur = null;
    for (const [k, v] of Object.entries(moves)) labWrite(col, k, v);
    col.ref = labRun(base);
  }
  return true;
}

/* THE COLUMNS A SUBJECT OPENS ON (the brief's §4.1). A saved property: as
   saved, then what the calculator's own comparison has chosen this visit
   (PM_COMPARE) or its scenarios, from pmColumns; with nothing for B, a copy
   of A that moves apart from it at the first touch. The sample deal or an
   unsaved one: the calculator's deal, and a copy of it. */
function labBuild(spec) {
  if (spec.kind === 'model') {
    const rec = pmFind(spec.id);
    if (!rec) return null;
    const st = propertyStatus(State.deal);
    const offered = pmColumns(rec, State.deal, st);
    const byId = new Map(offered.map(c => [c.id, c]));
    let ids = Array.isArray(spec.cols) ? spec.cols.filter(id => byId.has(id)) : [];
    if (!ids.length) {
      const chosen = (PM_COMPARE[rec.id] || []).filter(id => byId.has(id) && id !== 'base');
      const rest = offered.map(c => c.id).filter(id => id !== 'base' && !chosen.includes(id));
      const first = spec.scenarioId && byId.has(spec.scenarioId) ? [spec.scenarioId] : [];
      ids = ['base', ...new Set([...first, ...chosen, ...rest])].slice(0, 3);
    }
    ids = [...new Set(ids)].slice(0, 3);
    const cols = ids.map((id, i) => {
      const o = byId.get(id);
      const source = id === 'base' ? 'base' : id === 'current' ? 'current' : `sc:${id}`;
      return labCol(LAB_LETTERS[i], source, id === 'base' ? 'As saved' : o.short, o.inputs);
    });
    if (cols.length === 1) cols.push(labCol('B', 'variant', 'Copy of A', cols[0].work, { of: 'A' }));
    return { key: `m:${rec.id}`, model: rec.id, cols, active: 'B', input: 'price', metric: 'yield', gesture: null, naming: null };
  }
  const a = labCol('A', 'deal', labDealName(), pmBare(State.deal));
  const b = labCol('B', 'variant', 'Copy of A', a.work, { of: 'A' });
  return { key: 'deal', model: null, cols: [a, b], active: 'B', input: 'price', metric: 'yield', gesture: null, naming: null };
}
/* A subject's state, made the first time it is asked for. The calculator's
   deal, when it is a saved property, opens as that property — its columns,
   and the scenario the calculator has open beside it. */
function labEnsure(spec) {
  if (spec.kind === 'deal') {
    const st = propertyStatus(State.deal);
    if (st.kind === 'model') spec = { kind: 'model', id: st.rec.id, scenarioId: st.sc?.id || null };
  }
  const key = labKeyOf(spec);
  const fresh = spec.cols && LAB[key] && pmCanon(spec.cols) !== pmCanon(labSavedIds(LAB[key]));
  if (!LAB[key] || fresh) { const made = labBuild(spec); if (!made) return null; LAB[key] = made; }
  else if (!labRebase(LAB[key])) { delete LAB[key]; return null; }
  if (spec.metric && LAB_METRIC_IDS.includes(spec.metric)) LAB[key].metric = spec.metric;
  return LAB[key];
}
const labSavedIds = (lab) => lab.cols.filter(c => c.source !== 'variant' && c.source !== 'deal')
  .map(c => (c.source === 'base' ? 'base' : c.source === 'current' ? 'current' : c.source.slice(3)));
const labColOf = (lab, key) => lab.cols.find(c => c.key === key) || lab.cols[0];
const labActive = (lab) => labColOf(lab, lab.active);

/* --------------------------------------------------------------- the API */
/* OPEN A SUBJECT. { kind: 'deal' } — the calculator's deal; { kind:
   'model', id, scenarioId?, cols? } — a saved property; { kind: 'place',
   city, district } — the page's active column moved to a listed district
   (setDealPlace, on that column's own copy, never the calculator's deal);
   phase 3 adds { kind: 'scheme' }. Opens nothing in the address: the page
   writes its own, and only for a saved column or the comparison. */
function labOpen(subject) {
  if (subject?.kind === 'place') {
    const lab = labSubject && LAB[labSubject];
    if (!lab) return { ok: false, why: 'No scenario is open in the lab.' };
    const col = labActive(lab);
    const town = (SARAWAK_CITIES.find(c => c.id === subject.city) || {}).name || subject.city;
    const copy = pmCopy(col.work);
    const district = setDealPlace(copy, subject.city, subject.district);
    if (!district) {
      const why = `${subject.district} is not one of ${town}'s listed districts, so the calculator cannot model it by name.`;
      toast(why);
      return { ok: false, why };
    }
    /* labWrite drops the column's run, so the redraw runs the moved column
       — its grade too: a custom project's grade has a gate the sample
       project's has not (F1). */
    for (const k of ['city', 'district', 'projectId']) labWrite(col, k, copy[k]);
    labRefresh();
    return { ok: true, key: lab.key, district };
  }
  const lab = labEnsure(subject?.kind === 'model' ? subject : { kind: 'deal' });
  if (!lab) return { ok: false, why: 'That property is not saved in this browser.' };
  labSubject = lab.key;
  /* On the lab's own page the address names what is open, at once: a
     property opened here with the page's address left plain was undone at
     the next drawing (a theme change, the filings landing), which reads a
     plain /property/lab as the calculator's deal (the re-verification of
     4 Oct 2026). Another panel's opening writes no address. */
  if (State.view === 'propertyLab') { clearTimeout(labAddressTimer); labWriteAddress(lab); }
  labRefresh();
  return { ok: true, key: lab.key };
}
/* Told after each paint, with what the lab holds. A listener whose node has
   left the page takes itself off. */
function labSubscribe(fn, node = null) {
  const entry = { fn, node };
  LAB_LISTENERS.add(entry);
  return () => LAB_LISTENERS.delete(entry);
}
/* WHAT A LISTENER IS GIVEN IS ITS OWN: copies, never the lab's objects. A
   listener handed the live work saw it change under it mid-drag, and one
   that wrote to it moved a column with no move recorded (F9). And only the
   figures the page shows — the chain's, the grade, and net sale proceeds and
   total profit only where the report is unlocked — never the whole run, so
   a map's side sheet cannot show what the page withholds. */
function labFiguresOf(c) {
  const m = c.cur?.m;
  if (!m) return null;
  const out = {};
  for (const f of LAB_FIGURES) out[f.key] = f.read(m, c.work);
  out.grade = c.cur.g?.grade ?? null;
  if (labPaid(c.work)) for (const f of LAB_PAID) out[f.key] = m[f.key];
  return out;
}
function labNotify(lab) {
  if (!LAB_LISTENERS.size) return;
  const snap = { key: lab.key, active: lab.active, metric: lab.metric,
    cols: lab.cols.map(c => ({ key: c.key, source: c.source, name: c.name, moves: pmCopy(c.moves), work: pmCopy(c.work), figures: labFiguresOf(c) })) };
  for (const e of [...LAB_LISTENERS]) {
    if (e.node && !e.node.isConnected) { LAB_LISTENERS.delete(e); continue; }
    try { e.fn(snap); } catch { /* a listener's own fault */ }
  }
}

/* ---------------------------------------------------------------- the address */
/* READ ON ARRIVAL, as arrivePropertyUrl reads the calculator's: when the
   address is new — a link, a bookmark, Back — and not at every drawing,
   which would undo the reader's columns. ?model=<id>&cols=<ids>&by=<metric>.
   A property not saved here is said so, and the deal on the calculator is
   shown in its place. */
function labArrive() {
  const key = location.pathname + location.search;
  const q = new URLSearchParams(location.search);
  const model = q.get('model');
  /* The same address: the same columns, each read again from where its
     figures are kept (labRebase) — while the address still opens the same
     subject. A plain /property/lab opens the calculator's deal, and that
     is another subject once another property is open there: the lab went
     on showing the last one, its deal column moved onto the new figures
     under the old name (the verification of 4 Oct 2026, F2). A property
     deleted since is gone from the lab too, and the address is read
     afresh. */
  const want = model && pmFind(model) ? `m:${model}` : labDealSubject();
  if (labUrlSeen === key && labSubject === want && LAB[labSubject]) {
    if (labRebase(LAB[labSubject])) return;
    delete LAB[labSubject];
    labSubject = null;
  }
  labUrlSeen = key;
  labArrivalNote = null;
  const by = q.get('by');
  const metric = LAB_METRIC_IDS.includes(by) ? by : null;
  let lab = null;
  if (model) {
    const cols = (q.get('cols') || '').split(',').map(s => s.trim()).filter(Boolean);
    lab = pmFind(model) ? labEnsure({ kind: 'model', id: model, cols: cols.length ? cols : null, metric }) : null;
    if (!lab) labArrivalNote = 'That property is not saved in this browser — showing the deal on the calculator.';
  }
  if (!lab) lab = labEnsure({ kind: 'deal', metric });
  /* The comparison is the address's: none named is Yield. */
  lab.metric = metric || 'yield';
  labSubject = lab.key;
}
/* WRITTEN ONLY FOR A SAVED COLUMN OR THE COMPARISON, a moment after the
   change and never on a tick (Safari refuses after about 100 replaceState
   calls in 30 seconds), by the page's own panel only, and only while the
   page is the lab. Variants and moves are not in it: a link opens the saved
   columns, never a reader's unsaved what-ifs. */
let labAddressTimer = 0;
function labWriteAddress(lab) {
  if (State.view !== 'propertyLab' || labSubject !== lab.key) return;
  const q = new URLSearchParams(location.search);
  ['model', 'cols', 'by'].forEach(k => q.delete(k));
  if (lab.model) { q.set('model', lab.model); const ids = labSavedIds(lab); if (ids.length) q.set('cols', ids.join(',')); }
  if (lab.metric && lab.metric !== 'yield') q.set('by', lab.metric);
  const s = q.toString().replace(/%2C/g, ',');
  const next = location.pathname + (s ? `?${s}` : '');
  if (next === location.pathname + location.search) return;
  history.replaceState(history.state, '', next);
  labUrlSeen = location.pathname + location.search;
}
function labAddressSoon(lab) {
  clearTimeout(labAddressTimer);
  labAddressTimer = setTimeout(() => labWriteAddress(lab), 300);
}

/* ------------------------------------------------------------------ drawing */
const labId = (P, s) => `${P.idPrefix}-${s}`;
/* Text written only when it differs: a frame writes twenty figures, and a
   node rewritten with its own words is a mutation every observer hears. */
/* What each wrote last is kept on the node, so a frame compares strings it
   holds instead of reading the page's text and attributes back — the
   larger part of a paint's time once the model's run was its only run
   (the verification of 4 Oct 2026: a paint's median sat within 10% of its
   8ms limit on a 4× slower processor). Only these write these nodes. */
function labText(node, s) {
  if (!node) return;
  s = String(s ?? '');
  if (node.labWrote === s) return;
  node.labWrote = s;
  if (node.childNodes.length === 1 && node.firstChild.nodeType === 3) { if (node.firstChild.data !== s) node.firstChild.data = s; }
  else if (node.textContent !== s) node.textContent = s;
}
const labAttr = (node, k, v) => {
  if (!node) return;
  const s = v == null ? null : String(v);
  const was = (node.labAttrs ||= {});
  if (Object.hasOwn(was, k) && was[k] === s) return;
  was[k] = s;
  if (node.getAttribute(k) !== s) { if (s == null) node.removeAttribute(k); else node.setAttribute(k, s); }
};
const labClass = (node, k, on) => {
  if (!node) return;
  const was = (node.labClasses ||= {});
  on = !!on;
  if (was[k] === on) return;
  was[k] = on;
  node.classList.toggle(k, on);
};
const labStyle = (node, k, v) => {
  if (!node) return;
  const was = (node.labStyles ||= {});
  if (was[k] === v) return;
  was[k] = v;
  if (k.startsWith('--')) node.style.setProperty(k, v); else node.style[k] = v;
};
const labLetter = (key) => el('span', { class: `lab-letter lab-c-${key}`, 'aria-hidden': 'true' }, key);
const labBaseline = (lab, col) => {
  const k = labSourceKind(col);
  if (k === 'variant') {
    const of = labColOf(lab, col.of || 'A');
    /* Whether the column copied still holds what was copied: two whole
       deals compared, so the answer is kept until either changes — the
       copied column's work (a new object, or a new edition of it), or this
       column's base. Worked out every frame, it was a twelfth of a paint. */
    const c = col.blKept;
    let same;
    if (c && c.work === of?.work && c.ver === of?.ver && c.base === col.baseInputs) same = c.same;
    else {
      same = !!of && pmCanon(of.work) === pmCanon(col.baseInputs);
      col.blKept = { work: of?.work, ver: of?.ver, base: col.baseInputs, same };
    }
    return { label: same ? `vs ${col.of || 'A'}` : `vs ${col.of || 'A'} as copied`,
      back: `Back to ${col.of || 'A'} as copied` };
  }
  if (k === 'deal' || k === 'current') return { label: 'vs when you opened the lab', back: 'Back to as opened' };
  return { label: 'vs as saved', back: 'Back to as saved' };
};

/* THE PANEL. Draws the lab for a subject into a box of its own; the page
   mounts one, and the map's side sheet will mount a compact one. Every id
   carries the panel's prefix, so two can stand on one page. */
function scenarioLabPanel(container, { subject = null, compact = false, idPrefix = 'lab', address = true } = {}) {
  /* The subject given, else the page's, else the calculator's deal. */
  let key = subject ? labEnsure(subject)?.key || null : null;
  if (!key) key = labSubject && LAB[labSubject] ? labSubject : labEnsure({ kind: 'deal' })?.key || null;
  if (address && !labSubject) labSubject = key;
  const P = { idPrefix, compact, address, key, node: null, els: null, shape: null };
  P.node = el('div', { class: `lab${compact ? ' lab-compact' : ''}`, id: labId(P, 'root') });
  labDraw(P);
  P.refresh = () => labDraw(P);
  LAB_PANELS.add(P);
  if (container) container.append(P.node);
  return { node: P.node, refresh: P.refresh };
}

/* Draws the panel's whole contents again from LAB, keeping the control in
   focus by its id — for a change of structure (another column, the input
   picked on a phone, a commit). A slider's tick never comes here. `focusId`
   may name several, the first that can take the keyboard taking it: a
   commit's button is disabled once what it saved is saved, and focus handed
   to it fell to <body> (the verification of 4 Oct 2026). */
function labDraw(P, focusId = null) {
  const lab = LAB[P.key];
  const had = focusId || (P.node.contains(document.activeElement) ? document.activeElement.id : null);
  P.els = { knobs: {}, chain: {}, paid: {}, cmp: null };
  if (!lab) { P.node.replaceChildren(el('p', { class: 'body' }, 'Nothing is open in the lab.')); return; }
  /* Every column's figures run again from its inputs as they are (the kept
     runs, pmCompareRun): a drawing never shows a run kept from before. */
  for (const col of lab.cols) col.cur = labRun(col.work);
  const grid = el('div', { class: 'lab-grid' });
  const inputs = el('div', { class: 'lab-inputs', id: labId(P, 'inputs') });
  const outputs = el('div', { class: 'lab-outputs' });
  grid.append(inputs, outputs);
  inputs.append(labColumnPicker(P, lab), labInputPicker(P, lab));
  const col = labActive(lab);
  LAB_INPUTS.forEach(inp => inputs.append(labKnob(P, lab, col, inp)));
  P.els.colsCard = labColumnsCard(P, lab);
  P.els.commitCard = labCommits(P, lab, col);
  P.cardSig = labCardSig(lab);
  /* The chain, what needs evidence, the evidence itself (L3: under the
     chain, collapsed; from 1440px the drawer on the right), then A, B and
     C side by side and keeping one. */
  const chain = labChain(P, lab, col);
  const alert = P.compact ? null : labAlert(P, lab);
  const evidence = labEvidence(P, lab);
  outputs.append(...[chain, alert, evidence, labCompare(P, lab), P.els.colsCard, P.els.commitCard].filter(Boolean));
  /* The rows the workspace's column takes from 1440px, where the knobs and
     the drawer stand beside every one of them (styles.css). */
  grid.style.setProperty('--lab-rows', String(outputs.children.length - 1));
  P.node.replaceChildren(labHeader(P, lab), grid);
  labPaintPanel(P, { initial: true });
  if (P.address) labBarSync();
  for (const id of [].concat(had || [])) {
    const n = document.getElementById(id);
    if (!n || !P.node.contains(n) || n.disabled || !n.getClientRects().length) continue;
    n.focus({ preventScroll: true });
    if (document.activeElement === n) break;
  }
}

/* The fixed header, at every width, and the status of what is open. The
   claim is the brief's fixed wording (§8), whole at every width. */
const LAB_CLAIM = 'Arithmetic on the figures in each column. Not advice, not a valuation, not a forecast — nothing here is ranked.';
const LAB_NOT_OFFICIAL = 'Not an official property valuation — in Malaysia that must be carried out by a registered valuer.';
function labHeader(P, lab) {
  const hd = el('div', { class: 'lab-hd' });
  const status = el('p', { class: 'lab-status', id: labId(P, 'status') });
  if (P.idPrefix === 'lab' && labArrivalNote && lab.key === labSubject) status.append(el('span', { class: 'lab-note-warn' }, labArrivalNote), ' ');
  const rec = lab.model ? pmFind(lab.model) : null;
  const st = rec ? null : propertyStatus(State.deal);
  /* A panel mounted on its own (the map's side sheet, phase 3) keeps the
     claim and the status line as they were. */
  if (P.compact) {
    hd.append(el('p', { class: 'lab-claim' }, [el('span', { class: 'chip chip-bronze' }, 'Not a valuation'), ' ', el('span', {}, LAB_CLAIM)]));
    if (rec) status.append('Columns from ', el('strong', {}, `“${rec.name}”`), ` · saved ${pmWhen(pmUpdated(rec))}`);
    else if (st.kind === 'sample') status.append(el('strong', {}, 'Sample deal'),
      ' — illustrative figures, not a real listing. Every driving figure is the tool’s illustrative default until you change it.');
    else if (st.kind === 'model') status.append('The deal on the calculator, as it was when the lab opened — ', el('strong', {}, `“${st.rec.name}”`), ' is saved since; open it from My properties to see its columns.');
    else status.append('The deal on the calculator — not saved as a property.');
    hd.append(status);
  } else {
    /* THE PAGE'S HEADER (N3, D18): which property this is, then its four
       figures. The status line is the identity line's name. */
    status.classList.add('lab-id-name');
    if (rec) status.append(el('strong', {}, `“${rec.name}”`), ` · saved ${pmWhen(pmUpdated(rec))}`);
    else if (st.kind === 'sample') status.append(el('strong', {}, 'Sample deal'), ' — not a real listing');
    /* Reached only by a panel given the deal as its subject while the
       calculator holds a saved property: the page itself opens that
       property (labArrive). */
    else if (st.kind === 'model') status.append('The deal on the calculator, as it was when the lab opened — ', el('strong', {}, `“${st.rec.name}”`), ' is saved since; open it from My properties to see its columns.');
    else status.append(el('strong', {}, 'The deal on the calculator'), ' — not saved as a property');
    hd.append(labIdentity(P, lab, status), labTiles(P, lab));
  }
  return hd;
}

/* ------------------------------------------------- the identity and the tiles */
/* WHAT THE PAGE IS ABOUT, BEFORE ANY CONTROL (N3, the 5 Oct audit; D18).
   The subject's own figures: the calculator's deal, or a saved property as
   saved — never a column's what-ifs, which the chain below shows against
   them. Run by the model's kept runs (pmCompareRun), as a column is. */
const labSubjectInputs = (lab) => {
  if (!lab.model) return pmBare(State.deal);
  const rec = pmFind(lab.model);
  return rec ? pmInputsOf(rec) : null;
};
/* Place, type and size, as the calculator has them. */
function labPlaceLine(d) {
  const town = (SARAWAK_CITIES.find(c => c.id === d.city) || {}).name || d.city || '';
  const size = num0(d.sqft) > 0 ? `${fmtNum(num0(d.sqft), 0)} sq ft`
    : num0(d.landSqft) > 0 ? `${fmtNum(num0(d.landSqft), 0)} sq ft of land` : null;
  return [[d.district, town].filter(Boolean).join(', '), d.propertyType, size].filter(Boolean).join(' · ');
}
/* Whether a column holds figures a scenario would add to its property: moved
   in the lab, a lab copy, or the calculator's unsaved changes, and not the
   property as saved. labCommits offers its Save on the same test. */
function labCanSave(lab, col) {
  const rec = lab.model ? pmFind(lab.model) : null;
  if (!rec) return false;
  const differs = Object.keys(pmDiff(pmBare(col.work), pmInputsOf(rec))).length > 0;
  const kind = labSourceKind(col);
  return differs && (labMoveCount(col) > 0 || kind === 'variant' || kind === 'current');
}
const labScenarioNaming = (lab, col, at = null) => {
  const rec = pmFind(lab.model);
  return { kind: 'scenario', at, value: cpScenarioName(pmDiff(labNext(col), pmInputsOf(rec)), pmInputsOf(rec)) || `Scenario ${(rec.scenarios || []).length + 1}` };
};
/* THE IDENTITY LINE. The name — "Sample deal — not a real listing", or the
   property's — with its place, type and size; Save as the page's one
   primary button; and the regulated claim and the lab's own, whole at
   every width: "Not a valuation" leads, and the reader is never left to
   find it under the figures. */
function labIdentity(P, lab, status) {
  const d = labSubjectInputs(lab);
  const box = el('section', { class: 'lab-identity', 'aria-labelledby': labId(P, 'status') });
  P.els.idAct = labIdentityAct(P, lab);
  box.append(el('div', { class: 'lab-id-top' }, [status, P.els.idAct, d ? el('p', { class: 'lab-id-meta' }, labPlaceLine(d)) : null]));
  P.els.idForm = el('div', { class: 'lab-id-form' }, lab.naming?.at === 'identity' ? [labNameForm(P, lab, labActive(lab))] : []);
  box.append(P.els.idForm);
  box.append(el('p', { class: 'lab-claim lab-id-claim' }, [el('span', { class: 'chip chip-bronze' }, 'Not a valuation'), ' ',
    el('span', {}, `${LAB_NOT_OFFICIAL} ${LAB_CLAIM}`)]));
  return box;
}
/* Save, as what it saves: the deal as a property until it is one, then the
   column the sliders move as a scenario of it — where that would differ
   from what is saved. Nothing to save, nothing to press. */
function labIdentityAct(P, lab) {
  const col = labActive(lab);
  const box = el('div', { class: 'lab-id-act' });
  const id = labId(P, 'id-save');
  /* While its name is asked for, under the line, the form's Save is the
     one to press: one primary, not two. */
  if (lab.naming?.at === 'identity') return box;
  if (!lab.model) box.append(el('button', { type: 'button', class: 'btn btn-primary', id,
    onclick: () => labNaming(P, lab, { kind: 'property', at: 'identity', value: pmNameOf(State.deal) }) }, 'Save this property'));
  else if (labCanSave(lab, col)) box.append(el('button', { type: 'button', class: 'btn btn-primary', id,
    onclick: () => labNaming(P, lab, labScenarioNaming(lab, labActive(lab), 'identity')) },
    `Save ${col.key} as a scenario${labMarked(col).length ? ' — the moved figures become yours' : ''}`));
  else box.append(el('span', { class: 'lab-id-saved' }, 'Saved in this browser'));
  return box;
}
/* THE FOUR TILES. Three of the chain's own figures (LAB_FIGURES: the same
   reading, format and note as its rows, so a tile and a row cannot word or
   compute one differently), each with what it rests on — today's evidence
   words until the badge set lands (plan 3.7): "Illustrative default" while
   any figure it is worked from is still the tool's seeded one, else the
   weakest evidence among them — and the next step. */
const LAB_TILES = [
  { key: 'safeCashRequired', level: 1, rests: ['price', 'downPct', 'ratePct', 'tenureYears', 'maintenance'] },
  { key: 'cashflowMonthly', level: 1, rests: ['price', 'downPct', 'ratePct', 'tenureYears', 'rent', 'vacancyPct', 'maintenance'] },
  { key: 'netYield', level: 2, rests: ['price', 'rent', 'vacancyPct', 'maintenance'] },
];
function labTileKind(d, rests) {
  const keys = rests.filter(k => propertyInputApplies(d, k));
  if (keys.some(k => inputIsSeeded(d, k))) return { kind: 'illustrative_default', words: evidenceOf('illustrative_default').label };
  const weakest = keys.filter(k => evidenceDriversFor(d).includes(k)).map(k => evidenceOf(shownEvidence(d, k))).sort((a, b) => a.rank - b.rank)[0];
  return weakest ? { kind: weakest.id, words: weakest.label } : { kind: 'user', words: evidenceOf('user').label };
}
const labTag = (kind) => el('span', { class: `lab-tag lab-tile-kind ls-badge${kind.kind === 'illustrative_default' ? ' is-default' : ''}`, 'data-kind': kind.kind }, kind.words);
function labTiles(P, lab) {
  const d = labSubjectInputs(lab);
  const run = d && num0(d.price) > 0 ? pmCompareRun(d) : null;
  const rec = lab.model ? pmFind(lab.model) : null;
  const grid = el('div', { class: 'lab-tiles', role: 'list', 'aria-label': rec ? `“${rec.name}” as saved` : 'The deal on the calculator' });
  for (const t of LAB_TILES) {
    const f = LAB_FIGURES.find(x => x.key === t.key);
    const v = run ? f.read(run.m, d) : null;
    const kind = d ? labTileKind(d, t.rests) : { kind: 'unavailable', words: 'Unavailable' };
    /* THE SYSTEM'S METRIC CARD (37-layout-system.js): the cash and the
       month are the decision (L1, the card-metric size); the yield
       qualifies them (L2, medium). */
    const card = lsMetricCard({ label: f.label(d), value: LAB_FORMATS[f.fmt](v), badge: labTag(kind), level: t.level,
      sub: run ? (f.note(run.m, d) || '') : 'Needs a purchase price', tone: f.neg && isNum(v) && v < 0 ? 'neg' : null,
      cls: 'lab-tile', attrs: { role: 'listitem', 'data-tile': t.key }, valueAttrs: { class: 'lab-tile-val', 'data-value': isNum(v) ? String(v) : '' } });
    card.querySelector('.ls-card-hd').classList.add('lab-tile-hd');
    card.querySelector('.ls-card-label').classList.add('lab-tile-label');
    card.querySelector('.ls-card-sub').classList.add('lab-tile-sub');
    grid.append(card);
  }
  grid.append(labNextTile(P, lab, d));
  return grid;
}
/* NEXT STEP: the first figure still the tool's (the review queue's order,
   the one that moves the most first), entered where figures become the
   reader's — the calculator, at its box; then Save; then Compare. Only for
   the calculator's own deal: a saved property opened by a link while
   another deal is on the calculator would open the wrong one there. */
/* The figure in a word or two: the tile is half a phone's width. */
const LAB_NEXT_NOUN = { price: 'price', rent: 'rent', sqft: 'built-up area', maintenance: 'maintenance', ratePct: 'rate', vacancyPct: 'vacancy',
  downPct: 'deposit', apprecPct: 'growth rate', tenureYears: 'loan tenure', holdYears: 'holding period' };
function labNextTile(P, lab, d) {
  const onCalc = !lab.model || State.deal?.modelId === lab.model;
  const q = d && onCalc ? propertyReviewQueue(d) : [];
  const id = labId(P, 'next-go');
  let kind, act, sub;
  if (q.length) {
    const f = q[0], path = `/property/calculator#d-${f.k}`;
    kind = { kind: 'illustrative_default', words: evidenceOf('illustrative_default').label };
    act = el('a', { class: 'lab-next-go', id, href: href(path), onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path);
    } }, [`Replace the ${LAB_NEXT_NOUN[f.k] || f.label.toLowerCase()}`, el('span', { class: 'sr-only' }, ` — the sample ${f.label.toLowerCase()}, in the calculator`)]);
    sub = `The sample’s: ${isNum(d[f.k]) ? f.fmt(d[f.k]) : '—'}`;
  } else if (!lab.model) {
    kind = { kind: 'unsaved', words: 'Not saved' };
    act = el('button', { type: 'button', class: 'lab-next-go', id, onclick: () => labNaming(P, lab, { kind: 'property', at: 'identity', value: pmNameOf(State.deal) }) }, 'Save this property');
    sub = 'Then compare its scenarios';
  } else {
    kind = { kind: 'saved', words: 'Saved' };
    act = el('button', { type: 'button', class: 'lab-next-go', id, onclick: () => {
      const r = P.node.querySelector(`input[name="${labId(P, 'by')}"]:checked`);
      if (!r) return;
      r.closest('.lab-cmp-card')?.scrollIntoView({ block: 'start' });
      r.focus({ preventScroll: true });
    } }, 'Compare scenarios');
    sub = 'A, B and C side by side, below';
  }
  /* THE SYSTEM'S ACTION CARD: a title, one line, one call to action. */
  const card = lsActionCard({ title: 'Next step', line: sub, cta: act, badge: labTag(kind), cls: 'lab-tile lab-tile-next',
    attrs: { role: 'listitem', 'data-tile': 'next', 'data-kind': kind.kind } });
  card.querySelector('.ls-card-hd').classList.add('lab-tile-hd');
  card.querySelector('.ls-card-label').classList.add('lab-tile-label');
  card.querySelector('.ls-card-act').classList.add('lab-tile-val', 'lab-next-what');
  card.querySelector('.ls-card-sub').classList.add('lab-tile-sub');
  return card;
}

/* THE PAGE'S ACTION BAR ON A PHONE (the layout system, under 640px):
   Analyse — the product's action, the full model in the calculator;
   Compare — A, B and C side by side, below; Save this — the conversion,
   what the identity line's Save does (which a phone does not show beside
   the name: the bar carries it). */
const labPagePanel = () => [...LAB_PANELS].find(x => x.address && x.node.isConnected) || null;
function labBarSave() {
  const P = labPagePanel(), lab = P && LAB[P.key];
  if (!lab) return { aria: 'Nothing to save', disabled: true };
  const col = labActive(lab);
  if (lab.naming?.at === 'identity') return { aria: 'Save — name it under the property’s name', run: () => document.getElementById(labId(P, lab.naming.kind === 'property' ? 'property-name' : 'scenario-name'))?.focus() };
  if (!lab.model) return { aria: 'Save this property', run: () => labNaming(P, lab, { kind: 'property', at: 'identity', value: pmNameOf(State.deal) }) };
  if (labCanSave(lab, col)) return { aria: `Save ${col.key} as a scenario`, run: () => labNaming(P, lab, labScenarioNaming(lab, col, 'identity')) };
  return { aria: 'Saved in this browser', disabled: true, said: `Saved in this browser — move a figure to save ${col.key} as a scenario.` };
}
function labBarActions() {
  const s = labBarSave();
  return [
    { id: 'ls-act-analyse', label: 'Analyse', icon: 'chart', path: '/property/calculator', aria: 'Analyse this property in the calculator' },
    { id: 'ls-act-compare', label: 'Compare', icon: 'scale', aria: 'Compare A, B and C', onclick: () => {
      const P = labPagePanel();
      const r = P && P.node.querySelector(`input[name="${labId(P, 'by')}"]:checked`);
      if (r) lsGoTo(r.closest('.lab-cmp-card'), r);
    } },
    { id: 'ls-act-save', label: 'Save this', icon: 'bookmark', primary: true, aria: s.aria, disabled: s.disabled, said: () => labBarSave().said, onclick: () => labBarSave().run?.() },
  ];
}
function labBarSync() {
  const s = labBarSave();
  lsActUpdate('ls-act-save', { aria: s.aria, disabled: !!s.disabled });
}

/* "Sliders move": which column the knobs set. Radios, so the arrow keys
   move between them and a screen reader hears one group. Each is named by
   its letter and its name, "B — Copy of A" (aria-label): the drawn letter
   is a badge the ear skips, and named by the name alone two copies were
   "Copy of A" and "Copy of B", with no way to tell which radio was B, though
   every button and delta speaks in letters. */
function labColumnPicker(P, lab) {
  const fs = el('fieldset', { class: 'lab-pick lab-pick-cols' });
  fs.append(el('legend', { class: 'lab-legend' }, 'Sliders move'));
  const row = el('div', { class: 'lab-seg', role: 'presentation' });
  for (const c of lab.cols) {
    const id = labId(P, `col-${c.key}`);
    const on = c.key === lab.active;
    row.append(el('label', { class: `lab-seg-opt${on ? ' is-on' : ''}`, for: id }, [
      el('input', { type: 'radio', class: 'lab-radio', name: labId(P, 'col'), id, value: c.key, checked: on ? '' : null, 'aria-label': `${c.key} — ${c.name}`,
        onchange: () => { lab.active = c.key; lab.naming = null; labDraw(P, id); labAfterStructure(P, lab, {}); } }),
      labLetter(c.key), el('span', { class: 'lab-seg-name' }, c.name),
    ]));
  }
  fs.append(row);
  /* WHAT A MOVE BECOMES, said from the first drawing beside the columns it
     is about (labPaintPanel). It stood across the page above the sliders,
     a line of its own; on a phone it now shares the strip's line, which
     its legend leaves to the ear there — "Sliders move B." starts it,
     for the eye only (styles.css) — and the first slider is on the first
     screen under the four figures (N3, mobile.mjs n3-first-view). */
  const say = el('span', { class: 'lab-moved-say' }, '');
  const moved = el('p', { class: 'lab-moved-line', id: labId(P, 'unsaved') }, el('span', { class: 'lab-moved-in' }, [
    el('strong', { class: 'lab-moved-who', 'aria-hidden': 'true' }, `Sliders move ${lab.active}. `), say]));
  P.els.unsaved = moved;
  P.els.unsavedSay = say;
  fs.append(moved);
  return fs;
}
/* "Input": on a phone one knob at a time, chosen here; from 600px wide all
   five stand and this is not drawn (styles.css, scenario-lab). */
function labInputPicker(P, lab) {
  const col = labActive(lab);
  const fs = el('fieldset', { class: 'lab-pick lab-pick-input' });
  fs.append(el('legend', { class: 'lab-legend' }, 'Input'));
  const row = el('div', { class: 'lab-seg ls-chips', role: 'presentation' });
  for (const inp of LAB_INPUTS) {
    const id = labId(P, `in-${inp.k}`);
    const off = !labApplies(col.work, inp.k);
    const on = lab.input === inp.k;
    row.append(el('label', { class: `lab-seg-opt${on ? ' is-on' : ''}${off ? ' is-off' : ''}`, for: id, title: off ? LAB_NOT_APPLY[inp.k] : null }, [
      el('input', { type: 'radio', class: 'lab-radio', name: labId(P, 'in'), id, value: inp.k, checked: on ? '' : null, disabled: off ? '' : null,
        'aria-describedby': off ? labId(P, `off-${inp.k}`) : null,
        onchange: () => { lab.input = inp.k; labDraw(P, id); } }),
      el('span', {}, inp.short),
    ]));
  }
  fs.append(row);
  for (const inp of LAB_INPUTS) if (!labApplies(col.work, inp.k)) fs.append(el('p', { class: 'metaline lab-off-why', id: labId(P, `off-${inp.k}`) }, `${inp.short}: ${LAB_NOT_APPLY[inp.k]}`));
  return fs;
}

/* ONE KNOB: the calculator's own label, a slider and a box beside it. */
function labSpan(col, inp) {
  const anchor = num0(col.baseInputs[inp.k]);
  let [lo, hi] = inp.span(anchor);
  const v = num0(col.work[inp.k]);
  if (v < lo) lo = Math.floor(v / inp.step) * inp.step;
  if (v > hi) hi = Math.ceil(v / inp.step) * inp.step;
  if (!(hi > lo)) hi = lo + inp.step;
  return [+lo.toFixed(2), +hi.toFixed(2)];
}
function labEvidenceWords(d, k) {
  const ev = shownEvidence(d, k);
  return ev === 'illustrative_default' ? 'Illustrative default — not yours, and not from any market' : `Evidence: ${evidenceOf(ev).label}`;
}
function labKnob(P, lab, col, inp) {
  const k = inp.k;
  const applies = labApplies(col.work, k);
  const noSlider = k === 'renovation' && !(num0(col.baseInputs.renovation) > 0) && !(num0(col.work.renovation) > 0);
  const aboutOpen = applies && !!P.about?.[k];
  const row = el('div', { class: `lab-knob${lab.input === k ? ' is-on' : ''}${applies ? '' : ' is-off'}${aboutOpen ? ' is-about' : ''}`, id: labId(P, `knob-${k}`), data: { k } });
  const rid = labId(P, `r-${k}`), nid = labId(P, `n-${k}`), lid = labId(P, `l-${k}`), sid = labId(P, `span-${k}`), eid = labId(P, `ev-${k}`);
  const hd = el('div', { class: 'lab-knob-hd' });
  hd.append(el('label', { class: 'lab-knob-label', id: lid, for: noSlider ? nid : rid }, inp.label()));
  /* ABOUT THIS INPUT, ONE TAP AWAY ON A PHONE (the release fix of 5 Oct
     2026). In a wide sans — CI's Linux DejaVu, or Verdana here — the span's
     line, the renovation's note (four lines), the deposit's (two) and a
     wrapped evidence tag stood between the slider and its results, and the
     last result left a 360×640 screen by up to 60px. Below a 600px panel the
     span and the notes that explain the knob sit in a panel this button
     opens, straight after the knob's tags, closed at first; from 600px it is
     not drawn and they stand as before. Nothing is reworded or dropped: the
     slider is still described by the span (aria-describedby reads a closed
     panel too), the evidence tag and a 0% rate's warning stay in sight, and
     a reader with no script is shown the panel open (styles.css). */
  const aboutId = labId(P, `about-${k}`);
  const about = el('div', { class: 'lab-about', id: aboutId });
  if (applies) {
    const btn = el('button', { type: 'button', class: 'btn btn-quiet lab-about-btn', id: labId(P, `about-btn-${k}`), 'aria-expanded': aboutOpen ? 'true' : 'false', 'aria-controls': aboutId,
      onclick: () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        (P.about ||= {})[k] = open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.classList.toggle('is-about', open);
      } }, [el('span', { class: 'lab-about-i', 'aria-hidden': 'true', html: icon('info', 15) }), el('span', { class: 'lab-about-word' }, 'About'),
      el('span', { class: 'sr-only' }, ` ${inp.label()}`), el('span', { class: 'lab-about-chev', 'aria-hidden': 'true', html: icon('chev', 14) })]);
    hd.append(btn);
  }
  const num = el('input', { type: 'number', inputmode: 'decimal', class: 'input input-inline lab-num', id: nid, step: inp.step,
    value: String(col.work[k] ?? ''), 'aria-label': `${inp.label()} — type a figure`, 'aria-describedby': `${sid} ${eid}`,
    disabled: applies ? null : '' });
  row.append(hd);
  /* The slider, its box and its way back on one line: on a phone the knob,
     its figure and the seven results it moves fit one screen. NOTHING IN A
     KNOB COMES OR GOES WHILE IT MOVES. The first tick of a drag used to add
     a line for "What-if" and a 44px line for "Back to…" between the slider
     and the results, so every result jumped 75px under a moving thumb and
     the last ones left a 360×640 screen (the verification of 4 Oct 2026,
     F5). Now the way back holds its place on the slider's line from the
     first drawing, out of sight and reach until a move (is-idle), and the
     what-if tag takes the evidence tag's place, the two drawn in one cell. */
  /* The unit beside the box (data-unit): on a phone the chosen chip names
     the knob, and its label is for the ear (styles.css, layout-system). */
  const ctl = el('div', { class: 'lab-knob-ctl', 'data-unit': (inp.label().match(/\((RM|%)\)\s*$/) || [])[1] || null });
  row.append(ctl);
  const knob = { row, num, range: null, reset: null, whatIf: null, span: null, ev: null, ticks: null };
  if (!applies) {
    ctl.append(num);
    row.append(el('p', { class: 'metaline lab-span', id: sid }, LAB_NOT_APPLY[k] || 'Not used by this class.'));
    row.append(el('span', { class: 'lab-tag', id: eid, hidden: '' }, ''));
    P.els.knobs[k] = knob;
    return row;
  }
  knob.ids = { sid, eid, wid: labId(P, `wi-${k}`) };
  if (!noSlider) {
    const [lo, hi] = labSpan(col, inp);
    const range = el('input', { type: 'range', class: 'lab-range', id: rid, min: lo, max: hi, step: inp.step, value: String(num0(col.work[k])),
      'aria-describedby': `${sid} ${eid}` });
    knob.range = range;
    const track = el('div', { class: 'lab-range-wrap' }, range);
    ctl.append(track);
    if (inp.ticks) {
      const t = el('div', { class: 'lab-ticks', 'aria-hidden': 'true' });
      inp.ticks.forEach(x => t.append(el('span', { class: 'lab-tick', style: `--at:${(x - lo) / (hi - lo)}` })));
      knob.ticks = t;
      track.append(t);
    }
    labWireRange(P, lab, range, k);
  }
  ctl.append(num);
  const bl = labBaseline(lab, col);
  const back = `${bl.back} (${inp.shown(num0(col.baseInputs[k]))})`;
  knob.reset = el('button', { type: 'button', class: 'btn btn-ghost lab-reset is-idle', id: labId(P, `back-${k}`), 'aria-label': back, title: back,
    html: icon('undo', 18),
    onclick: () => {
      const c = labActive(lab);
      labWrite(c, k, c.baseInputs[k]);
      labSchedule(); labSay(P, lab, k);
      if (!labKnobShapeHolds(P, lab, k)) return;
      (knob.range || knob.num).focus({ preventScroll: true });
    } });
  ctl.append(knob.reset);
  const ft = el('div', { class: 'lab-knob-ft' });
  const tags = el('div', { class: 'lab-tags' });
  knob.ev = el('span', { class: 'lab-tag', id: eid }, labEvidenceWords(col.work, k));
  knob.whatIf = el('span', { class: 'lab-tag lab-tag-whatif is-idle', id: knob.ids.wid }, 'What-if — not saved, no evidence attached');
  tags.append(knob.ev, knob.whatIf);
  /* COMPUTED, NOT APPROVED, IN SIGHT ON A PHONE (the release re-check of
     5 Oct 2026). Below a 600px panel the deposit's lender-limits note sits
     in "About", so a deposit taken to 0% showed nothing to say that no
     lender approved it (the brief's gap rule). A fixed tag beside the
     evidence tag says it at every deposit and never comes or goes while the
     slider moves; from 600px the whole note stands under the tags. */
  if (k === 'downPct') tags.append(el('span', { class: 'lab-tag lab-tag-gap' }, 'Computed, not approved'));
  ft.append(tags);
  row.append(ft);
  /* In sight whatever the panel: what to do where there is no slider, and
     a 0% rate's warning. */
  if (noSlider) row.append(el('p', { class: 'metaline lab-knob-note' }, 'No renovation entered — type a budget to explore.'));
  if (k === 'ratePct') { knob.zero = el('p', { class: 'metaline lab-knob-note lab-note-warn', hidden: '' }, 'The rate is 0%. If that was intended, the repayment is right; if not, it is roughly half what it should be — the model cannot tell the two apart.'); row.append(knob.zero); }
  knob.span = el('p', { class: 'metaline lab-span', id: sid });
  /* The span's ends and its basis, and why that basis — the last shown on
     a phone only in the open panel, where it has the room. */
  knob.spanEdges = el('span', {}, '');
  knob.span.append(knob.spanEdges, el('span', { class: 'lab-span-why' }, inp.why || ''), '.');
  about.append(knob.span);
  if (k === 'downPct') about.append(el('p', { class: 'metaline lab-knob-note' }, 'Lender limits on the margin of finance are not modelled: computed, not approved.'));
  if (k === 'renovation') {
    knob.recover = el('p', { class: 'metaline lab-knob-note' });
    about.append(knob.recover);
  }
  row.append(about);
  if (k === 'renovation') {
    knob.card = el('div', { class: 'lab-reno', id: labId(P, 'reno'), hidden: '' });
    row.append(knob.card);
  }
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); labTyped(P, lab, k, num); } });
  num.addEventListener('change', () => labTyped(P, lab, k, num));
  P.els.knobs[k] = knob;
  return row;
}
/* A FIGURE TYPED, on change or Enter — never on each keystroke, so a
   half-typed "5" never prices a RM5 flat. An emptied box keeps its figure,
   as the calculator's does: an empty box is not zero. */
function labTyped(P, lab, k, num) {
  const col = labActive(lab), inp = LAB_INPUT_BY_K[k];
  if (String(num.value).trim() === '') {
    num.value = String(col.work[k] ?? '');
    toast(`An empty box is not zero — “${inp.label()}” stays at ${isNum(col.work[k]) ? col.work[k] : 'its last figure'}. Type 0 if you mean nought.`);
    return;
  }
  let v = num0(num.value);
  if (k === 'downPct') v = clamp(v, 0, 100);
  /* The box shows the figure the model is given: a deposit typed as 150
     is 100, and the box said 150 while every figure used 100 (F7). */
  if (String(num.value) !== String(v)) num.value = String(v);
  if (pmCanon(v) === pmCanon(col.work[k])) return;
  labWrite(col, k, v);
  labSchedule();
  labSay(P, lab, k);
  /* The keyboard stays in the box it typed into; a change heard as it
     left the box leaves it where it went. */
  labKnobShapeHolds(P, lab, k, document.activeElement === num ? [num.id] : null);
}
/* Whether a knob as drawn still has the shape its column's figures call
   for: the renovation knob has a slider only where there is a renovation
   to span. Where it has not, the panels on this subject are drawn again,
   the keyboard kept on the knob — a budget typed into an empty renovation
   drew no slider, and still said "No renovation entered", until something
   else redrew the page (F12). */
function labKnobShapeHolds(P, lab, k, focus = undefined) {
  if (k !== 'renovation') return true;
  const col = labActive(lab), kn = P.els.knobs[k];
  const want = num0(col.baseInputs.renovation) > 0 || num0(col.work.renovation) > 0;
  if (!kn || !!kn.range === want) return true;
  for (const Q of [...LAB_PANELS]) {
    if (Q.key !== P.key || !Q.node.isConnected) continue;
    labDraw(Q, Q === P && focus !== null ? (focus || [labId(P, 'r-renovation'), labId(P, 'n-renovation')]) : null);
  }
  return false;
}
/* THE SLIDER. One keydown handler, so every browser steps alike; a drag
   holds any redraw nobody asked for until the finger lifts (renderHold,
   35-ui.js); every step paints in the next frame and nothing is written. */
function labWireRange(P, lab, range, k) {
  const inp = LAB_INPUT_BY_K[k];
  const startGesture = () => { if (!lab.gesture || lab.gesture.k !== k || lab.gesture.col !== lab.active) lab.gesture = { col: lab.active, k, v: labActive(lab).work[k] }; };
  range.addEventListener('focus', startGesture);
  range.addEventListener('input', () => {
    const col = labActive(lab);
    const v = labSnap(num0(range.value), inp.step);
    if (pmCanon(v) === pmCanon(col.work[k])) return;
    labWrite(col, k, v);
    labSchedule();
  });
  range.addEventListener('change', () => labSay(P, lab, k));
  range.addEventListener('pointerdown', (e) => {
    range.focus({ preventScroll: true });
    renderHold();
    P.node.classList.add('is-dragging');
    lab.gesture = { col: lab.active, k, v: labActive(lab).work[k], touch: e.pointerType === 'touch', x: e.clientX, dx: 0 };
  });
  range.addEventListener('pointermove', (e) => { const g = lab.gesture; if (g && g.k === k && isNum(g.x)) g.dx = Math.max(g.dx, Math.abs(e.clientX - g.x)); });
  const end = () => { P.node.classList.remove('is-dragging'); renderRelease(); };
  ['pointerup', 'lostpointercapture'].forEach(t => range.addEventListener(t, end));
  /* A FINGER THAT SCROLLS THE PAGE MOVES NO FIGURE. A touch on the track
     sets the slider where it lands; when the finger then goes up or down
     the page, the browser takes the gesture as a scroll (touch-action:
     pan-y) and cancels the pointer — and the figure stayed where the touch
     had put it (the verification of 4 Oct 2026, F14). A cancelled touch
     that never slid sideways puts the figure back where the gesture began.
     One that slid sideways was a drag, and keeps its figure. */
  range.addEventListener('pointercancel', () => {
    const g = lab.gesture;
    end();
    if (!g || !g.touch || g.k !== k || g.col !== lab.active || g.dx > 10) return;
    const col = labActive(lab);
    if (pmCanon(col.work[k]) === pmCanon(g.v)) return;
    labWrite(col, k, g.v);
    labSchedule();
    labSay(P, lab, k);
  });
  range.addEventListener('blur', () => { end(); lab.gesture = null; });
  range.addEventListener('keydown', (e) => {
    const lo = Number(range.min), hi = Number(range.max), now = num0(range.value);
    const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    let v = null;
    if (by != null) v = now + by * (e.shiftKey && Math.abs(by) === 1 ? 10 : 1) * inp.step;
    else if (e.key === 'Home') v = lo;
    else if (e.key === 'End') v = hi;
    else if (e.key === 'Escape' && lab.gesture && lab.gesture.k === k && lab.gesture.col === lab.active) {
      if (pmCanon(labActive(lab).work[k]) === pmCanon(lab.gesture.v)) return;
      e.preventDefault();
      labWrite(labActive(lab), k, lab.gesture.v);
      labSchedule();
      labSay(P, lab, k);
      return;
    } else return;
    e.preventDefault();
    startGesture();
    range.value = String(labSnap(clamp(v, lo, hi), inp.step));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/* THE CHAIN: seven rows in the owner's order, and the grade. */
function labChain(P, lab, col) {
  const card = el('section', { class: 'card ls-section lab-chain-card', 'aria-labelledby': labId(P, 'chain-h') });
  const bl = labBaseline(lab, col);
  card.append(el('div', { class: 'lab-chain-hd' }, [
    el('h2', { class: 'h-card lab-chain-h', id: labId(P, 'chain-h') }, [labLetter(col.key), ` ${col.key} — ${col.name}`]),
    (P.els.baseline = el('span', { class: 'metaline lab-baseline' }, `Changes ${bl.label}`)),
  ]));
  const list = el('div', { class: 'lab-chain' });
  const d = col.work;
  for (const f of LAB_FIGURES) {
    const det = el('details', { class: 'lab-row', data: { row: f.key } });
    const value = el('span', { class: 'lab-val num', data: { lab: f.key, labFmt: f.fmt }, 'data-value': '' }, '—');
    const deltaEye = el('span', { class: 'lab-delta-mark', 'aria-hidden': 'true' }, '');
    const deltaEar = el('span', { class: 'sr-only' }, '');
    const note = el('span', { class: 'lab-row-note' }, '');
    const label = el('span', { class: 'lab-row-label' }, f.label(d));
    const sum = el('summary', { class: 'lab-sum' }, [label, el('span', { class: 'lab-row-fig' }, [value, el('span', { class: 'lab-delta' }, [deltaEye, deltaEar])]), note]);
    det.append(sum);
    const body = el('div', { class: 'lab-row-body' });
    const formula = el('p', { class: 'lab-formula' }, '');
    body.append(formula);
    const paidBox = f.key === 'irrPct' ? el('div', { class: 'lab-paid' }) : null;
    if (paidBox) body.append(paidBox);
    body.append(el('p', { class: 'lab-help' }, [metricLabel(f.help, `What ${f.label(d).replace(/ \(before selling costs\)$/, '').toLowerCase().replace(/^if sold/, 'the rate of return if sold')} means`)]));
    const where = labWhereEntered(lab, col, f.key);
    if (where) { body.append(where); (P.els.where ||= []).push(where); }
    det.append(body);
    list.append(det);
    P.els.chain[f.key] = { value, deltaEye, deltaEar, note, label, formula, fmt: f.fmt, paidBox, sum, det };
    /* A row's formula is written while it is open, and when it opens. */
    det.addEventListener('toggle', () => { if (det.open) labPaintPanel(P); });
    /* From 1440px, in the evidence drawer beside the figures instead
       (labShowFormula): opened under its row, it moved every row below. */
    sum.addEventListener('click', (e) => {
      if (P.compact || !lsWide() || !P.els.how?.node.isConnected || det.open) return;
      e.preventDefault();
      labShowFormula(P, f.key);
    });
  }
  card.append(list);
  if (labPaid(d)) {
    const paid = el('div', { class: 'lab-paid-figs', id: labId(P, 'paid') });
    for (const f of LAB_PAID) {
      const v = el('span', { class: 'lab-val num', data: { lab: f.key, labFmt: f.fmt }, 'data-value': '' }, '—');
      paid.append(el('span', { class: 'lab-paid-fig' }, [el('span', { class: 'lab-paid-k' }, `${f.label} `), v]));
      P.els.paid[f.key] = { value: v };
    }
    P.els.chain.irrPct.sum.append(paid);
  }
  /* THE GRADE, THE SYSTEM'S INSIGHT CARD: the finding (the verdict and the
     most serious gate), its figure (the letter) and "See why →" into the
     evidence, where every gate is (labEvidence). */
  const letter = el('span', { class: 'ls-card-figure lab-grade-letter num', data: { lab: 'grade', labFmt: 'grade' }, 'data-value': '' }, '—');
  const verdict = el('p', { class: 'ls-card-title lab-grade-verdict' }, '');
  const gate = el('p', { class: 'ls-card-sub lab-grade-gate' }, '');
  const seeWhy = lsCta('See why', { id: labId(P, 'see-why'), sr: ' — every gate behind the grade', onclick: () => lsOpenEvidence(P.els.grade?.why) });
  const grade = lsInsightCard({ label: 'Underwriting grade', figure: letter, finding: verdict, sub: gate, cta: seeWhy, cls: 'lab-grade', attrs: { id: labId(P, 'grade') } });
  seeWhy.setAttribute('aria-controls', labId(P, 'grade-why'));
  card.append(grade);
  P.els.grade = { letter, verdict, gate, seeWhy };
  return card;
}

/* THE EVIDENCE (L3), the system's drawer (lsEvidence): why the letter —
   every gate the grade has, worst first, with who confirms each, and the
   score it is not; what the figures rest on (§6.3), from the column's own
   inputs; and, from 1440px, how the figure a row names is worked out — a
   row pressed there writes its formula here instead of opening under
   itself, so nothing in the workspace moves. Written while open. */
function labEvidence(P, lab) {
  const why = lsEvidenceSection({ id: labId(P, 'grade-why'), cls: 'lab-grade-why', summary: ['Why ', (P.els.grade.whyLetter = el('span', {}, ''))],
    body: el('div', { class: 'lab-grade-why-body' }) });
  why.querySelector('summary').classList.add('lab-grade-why-sum');
  why.addEventListener('toggle', () => { if (why.open) labPaintPanel(P); });
  const ctx = el('p', { class: 'metaline lab-context', id: labId(P, 'context') }, '');
  const rests = el('p', { class: 'metaline lab-rests', id: labId(P, 'rests') }, '');
  const movedBy = el('p', { class: 'metaline lab-movedby', id: labId(P, 'movedby') }, '');
  const rest = lsEvidenceSection({ id: labId(P, 'ev-rests'), summary: 'What these figures rest on', body: [movedBy, ctx, rests] });
  const formula = el('p', { class: 'lab-formula', id: labId(P, 'ev-formula-text') }, '');
  const fhead = el('p', { class: 'ls-ev-k', id: labId(P, 'ev-formula-k') }, '');
  const how = lsEvidenceSection({ id: labId(P, 'ev-formula'), cls: 'ls-ev-wide', summary: 'How a figure is worked out', body: [fhead, formula] });
  how.addEventListener('toggle', () => { if (how.open) labPaintPanel(P); });
  P.els.grade.why = why;
  P.els.grade.whyBody = why.querySelector('.lab-grade-why-body');
  P.els.context = ctx; P.els.rests = rests; P.els.movedBy = movedBy;
  P.els.how = { node: how, head: fhead, formula };
  return lsEvidence({ id: labId(P, 'evidence'), title: 'Evidence', sections: [why, rest, how] });
}
/* From 1440px a row of the chain shows its formula in the drawer. */
function labShowFormula(P, key) {
  P.formulaKey = key;
  for (const [k, ce] of Object.entries(P.els.chain)) ce.sum.classList.toggle('is-shown', k === key);
  if (P.els.how) P.els.how.node.open = true;
  labPaintPanel(P);
  const f = LAB_FIGURES.find(x => x.key === key);
  if (f) liveSay(`How ${f.label(labActive(LAB[P.key]).work).toLowerCase()} is worked out, in the evidence beside the figures.`);
}
/* THE SYSTEM'S ALERT CARD: how many of the figures behind these results
   are still the tool's, and where they are reviewed — the calculator's
   review list (/property/calculator#review). Only for the calculator's own
   deal, as the next step: another deal is not the one there. */
function labAlert(P, lab) {
  const onCalc = !lab.model || State.deal?.modelId === lab.model;
  const d = labSubjectInputs(lab);
  const q = d && onCalc ? propertyReviewQueue(d) : [];
  if (!q.length) return null;
  return lsAlertCard({ text: `${q.length} assumption${q.length === 1 ? '' : 's'} need${q.length === 1 ? 's' : ''} evidence`,
    sub: `${q.slice(0, 3).map(x => x.label.toLowerCase()).join(', ')}${q.length > 3 ? ` and ${q.length - 3} more` : ''} — still the tool’s starting figures.`,
    cta: lsCta('Review', { path: '/property/calculator#review', id: labId(P, 'review'), sr: ' them in the calculator' }), cls: 'lab-alert', attrs: { id: labId(P, 'alert') } });
}
/* Where a figure is entered, only while the column IS the calculator's
   deal and unmoved: a plain link from any other column would open a
   different deal than the one on screen. */
function labWhereEntered(lab, col, key) {
  if (labSourceKind(col) !== 'deal') return null;
  const sec = { instalment: 'financing', safeCashRequired: 'acquisition', cashflowMonthly: 'rental', netYield: 'rental',
    breakEvenOccupancy: 'rental', valueLessLoanAtExit: 'scenarios', irrPct: 'scenarios' }[key];
  const label = (PC_SECTIONS.find(s => s.id === sec) || {}).label || 'the calculator';
  const path = `/property/calculator#${sec}`;
  return el('p', { class: 'metaline' }, [el('a', { href: href(path), onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path);
  } }, `Entered in the calculator’s ${label} section`)]);
}

/* THE COMPARISON. One table a panel, A, B, C in that order whatever is
   compared; the switch changes the form and the scale. */
function labCompare(P, lab) {
  const card = el('section', { class: 'card ls-section lab-cmp-card', 'aria-labelledby': labId(P, 'cmp-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'cmp-h') }, 'A, B and C side by side'));
  const fs = el('fieldset', { class: 'lab-pick lab-pick-by' });
  fs.append(el('legend', { class: 'lab-legend' }, 'Compare by'));
  const seg = el('div', { class: 'lab-seg lab-seg-by ls-chips', role: 'presentation' });
  for (const mt of LAB_METRICS) {
    const id = labId(P, `by-${mt.id}`);
    const on = lab.metric === mt.id;
    seg.append(el('label', { class: `lab-seg-opt${on ? ' is-on' : ''}`, for: id }, [
      el('input', { type: 'radio', class: 'lab-radio', name: labId(P, 'by'), id, value: mt.id, checked: on ? '' : null,
        onchange: () => {
          lab.metric = mt.id;
          seg.querySelectorAll('.lab-seg-opt').forEach(o => o.classList.toggle('is-on', o.getAttribute('for') === id));
          P.shape = null;
          labPaintPanel(P);
          labSayMetric(lab);
          if (P.address) labAddressSoon(lab);
        } }),
      el('span', {}, mt.label),
    ]));
  }
  fs.append(seg);
  card.append(fs);
  const body = el('div', { class: 'lab-cmp-body', id: labId(P, 'cmp') });
  card.append(body);
  P.els.cmpBody = body;
  return card;
}

/* What a metric shows for the columns, as figures: the view the comparison
   is drawn from, and redrawn from in place while its shape holds. */
function labMetricView(metric, lab) {
  const cols = lab.cols;
  const row = (c) => ({ key: c.key, name: c.name, chip: LAB_SOURCE_CHIP[labSourceKind(c)], active: c.key === lab.active, m: c.cur?.m || null, g: c.cur?.g || null, d: c.work });
  const rows = cols.map(row);
  const vm = { metric, tables: [], words: [], twin: null, caption: `Compared by ${(LAB_METRICS.find(x => x.id === metric) || {}).say}. Order: ${cols.map(c => c.key).join(', ')}.` };
  const one = (field, fmt, value, extra = {}) => ({ field, fmt, rows: rows.map(r => {
    const v = r.m ? value(r) : null;
    return { ...r, value: v, text: !r.m ? 'not computed yet' : isNum(v) ? LAB_FORMATS[fmt](v) : (extra.missing ? extra.missing(r) : '—'),
      ticks: r.m && extra.ticks ? extra.ticks(r).filter(t => isNum(t.value)) : [], parts: r.m && extra.parts ? extra.parts(r) : null,
      note: r.m && extra.note ? extra.note(r) : null };
  }), ...extra.table });
  if (metric === 'yield') {
    vm.tables.push(one('netYield', 'pct2', r => r.m.netYield, {
      missing: r => (r.m.letsToTenant === false ? 'does not apply' : '—'),
      ticks: r => [{ value: r.m.grossYield, label: 'gross' }],
      note: r => (r.m.letsToTenant === false ? 'A parcel has no rent: yield does not apply.' : `gross ${fmtPct(r.m.grossYield, 2)}`),
      table: { form: 'bars', title: 'Net yield, with gross yield marked' } }));
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'Net yield', 'Gross yield', 'Cash-on-cash'],
      rows: () => rows.map(r => [`${r.key} — ${esc(r.name)}`, r.m ? fmtPct(r.m.netYield, 2) : 'not computed yet', r.m ? fmtPct(r.m.grossYield, 2) : '—', r.m ? fmtPct(r.m.cashOnCash, 2) : '—']) };
  } else if (metric === 'cashflow') {
    const anyTax = rows.some(r => r.m?.taxComputed);
    vm.tables.push(one('cashflowMonthly', 'money0', r => r.m.cashflowMonthly, {
      ticks: r => (r.m.taxComputed && isNum(r.m.path?.[0]?.cf) ? [{ value: r.m.path[0].cf / 12, label: 'after tax' }] : []),
      note: r => (r.m.taxComputed ? `after tax on the rent ${labMoney(r.m.path[0].cf / 12)}` : 'before tax on the rent'),
      table: { form: 'diverging', title: 'Monthly position, about nought' } }));
    if (!anyTax) vm.words.push('Every column is before tax on the rent: no marginal tax rate is entered.');
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'Monthly position', 'After tax on the rent'],
      rows: () => rows.map(r => [`${r.key} — ${esc(r.name)}`, r.m ? labMoney(r.m.cashflowMonthly) : 'not computed yet', r.m?.taxComputed ? labMoney(r.m.path[0].cf / 12) : 'no tax rate entered']) };
  } else if (metric === 'entry') {
    vm.tables.push(one('safeCashRequired', 'money0', r => r.m.safeCashRequired, {
      parts: r => [{ part: 'transactionCash', value: r.m.transactionCash, label: 'to complete' },
        { part: 'improvementCash', value: r.m.improvementCash, label: 'renovation and set-up' },
        ...(isNum(r.m.reserveCash) ? [{ part: 'reserveCash', value: r.m.reserveCash, label: 'reserve' }] : [])],
      note: r => [(r.m.missingCostLines || []).length ? 'so far' : null, !isNum(r.m.reserveCash) ? 'the reserve cannot be priced, so it draws no part' : null,
        `${labMoney(r.m.unconfirmedCost)} on unverified fee lines`].filter(Boolean).join(' · '),
      table: { form: 'stacked', title: 'Cash required: to complete, renovation and set-up, and the reserve' } }));
    vm.words.push('Each bar, from nought: what completion takes, then renovation and set-up (the stronger shade), then the reserve (outlined).');
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'To complete', 'Renovation and set-up', 'Reserve', 'Cash required', 'On unverified fee lines'],
      rows: () => rows.map(r => [`${r.key} — ${esc(r.name)}`, ...(r.m ? [labMoney(r.m.transactionCash), labMoney(r.m.improvementCash), isNum(r.m.reserveCash) ? labMoney(r.m.reserveCash) : 'cannot be priced',
        `${labMoney(r.m.safeCashRequired)}${(r.m.missingCostLines || []).length ? ' so far' : ''}`, labMoney(r.m.unconfirmedCost)] : ['not computed yet', '—', '—', '—', '—'])]) };
  } else if (metric === 'appreciation') {
    vm.tables.push(one('exitValue', 'money0', r => r.m.exitValue, {
      parts: r => [{ part: 'price', value: num0(r.d.price), label: 'price' }, { part: 'priceGrowthAtExit', value: r.m.priceGrowthAtExit, label: 'growth on the price' },
        { part: 'renoRecovered', value: r.m.renoRecovered, label: 'renovation recovered' }],
      ticks: r => [{ value: r.m.valueLessLoanAtExit, label: 'value less loan' }],
      note: r => `at ${fmtNum(num0(r.d.apprecPct), 1)}% a year for ${labYears(normHoldYears(r.d.holdYears))} — ${labWhose(r.d, 'apprecPct')}`,
      table: { form: 'stacked', title: 'Value at the sale: the price, the growth on it and the renovation recovered, with value less loan marked' } }));
    vm.words.push('Each bar, from nought: the price, then the growth on it (the stronger shade), then the renovation recovered (outlined); the mark is value less loan.');
    const live = rows.filter(r => r.m);
    const holds = [...new Set(live.map(r => normHoldYears(r.d.holdYears)))];
    if (holds.length > 1) vm.words.push(live.map(r => `${r.key} holds ${labYears(normHoldYears(r.d.holdYears))}`).join(', ') + '.');
    if (live.length > 1 && new Set(live.map(r => num0(r.d.apprecPct))).size === 1 && holds.length === 1)
      vm.words.push('Every column grows at the same rate for the same years, so the bars differ only by price and renovation recovered.');
    vm.words.push('No price history is held to test this: NAPIC’s H1 2025 files carry no transaction dates.');
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'Price', 'Growth on the price', 'Renovation recovered', 'Value at the sale', 'Value less loan'],
      rows: () => rows.map(r => [`${r.key} — ${esc(r.name)}`, ...(r.m ? [labMoney(num0(r.d.price)), labMoney(r.m.priceGrowthAtExit), labMoney(r.m.renoRecovered), labMoney(r.m.exitValue), labMoney(r.m.valueLessLoanAtExit)]
        : ['not computed yet', '—', '—', '—', '—'])]) };
  } else if (metric === 'risk') {
    const worst = (m) => { const xs = [m.stress?.rate?.at(-1)?.monthly, m.letsToTenant === false ? null : m.stress?.vacancy?.at(-1)?.monthly].filter(isNum); return xs.length ? Math.min(...xs) : null; };
    vm.tables.push(one('breakEvenOccupancy', 'pct1', r => r.m.breakEvenOccupancy, {
      missing: r => (r.m.letsToTenant === false ? 'does not apply' : '—'),
      ticks: r => [{ value: 100 - num0(r.d.vacancyPct), label: 'occupancy assumed' }],
      note: r => `${r.g?.grade ? `grade ${r.g.grade}, ${r.g.gates.length} gate${r.g.gates.length === 1 ? '' : 's'}` : ''}`,
      table: { form: 'bars', title: 'Break-even occupancy, against 100%', refs: [{ value: 100, label: '100%' }] } }));
    vm.tables.push(one('dscr', 'x2', r => r.m.dscr, {
      missing: r => (!(r.m.loan > 0) ? 'no loan' : r.m.letsToTenant === false ? 'does not apply' : '—'),
      table: { form: 'bars', title: 'Debt-service cover, against 1.00×', refs: [{ value: 1, label: '1.00×' }] } }));
    vm.tables.push(one('worstMonth', 'money0', r => worst(r.m), {
      note: r => (isNum(r.m.breakEvenRate) ? `rate headroom ${fmtNum(r.m.breakEvenRate - num0(r.d.ratePct), 2)} pp` : r.m.breakEvenRateWhy === 'never-positive' ? 'negative at any rate' : r.m.breakEvenRateWhy === 'always-positive' ? 'positive at any rate to 25%' : 'rate headroom unknown'),
      table: { form: 'diverging', title: 'Worst stressed month (+3 pp, or 40% vacant), about nought' } }));
    vm.words.push('Room before the monthly position turns negative — not a probability. Each panel is on its own scale, and nothing combines them.');
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'Break-even occupancy', 'Occupancy assumed', 'Debt-service cover', 'Worst stressed month', 'Break-even rate', 'Grade'],
      rows: () => rows.map(r => [`${r.key} — ${esc(r.name)}`, ...(r.m ? [fmtPct(r.m.breakEvenOccupancy, 1), fmtPct(100 - num0(r.d.vacancyPct), 0), fmtX(r.m.dscr, 2), labMoney(worst(r.m)),
        isNum(r.m.breakEvenRate) ? fmtPct(r.m.breakEvenRate, 2) : esc(r.m.breakEvenRateWhy || '—'), esc(`${r.g?.grade || '—'} — ${r.g?.verdict || ''}`)] : ['not computed yet', '—', '—', '—', '—', '—'])]) };
  } else {
    const place = (r) => `${r.d.district || '—'}, ${(SARAWAK_CITIES.find(c => c.id === r.d.city) || {}).name || r.d.city || '—'}`;
    const facts = (r) => {
      const proj = r.m?.proj;
      const cmp = comparableSupport(r.d), am = areaMetrics(r.d.city, r.d.district);
      const lr = landRiskProfile(r.d.city, r.d.district), dt = demandTest(r.d.city, r.d.district);
      return [
        proj && !proj.custom ? `${proj.name}: synthetic sample project — sample transaction data for demonstration` : 'Custom — no comparable held',
        `${cmp.price.verified} verified transacted price${cmp.price.verified === 1 ? '' : 's'} and ${cmp.rent.verified} verified achieved rent${cmp.rent.verified === 1 ? '' : 's'} recorded for this district and type${isNum(cmp.priceVsMedian) ? `; the price is ${fmtPct(Math.abs(cmp.priceVsMedian), 0)} ${cmp.priceVsMedian > 0 ? 'above' : 'below'} their middle figure` : ''}`,
        `${am.total} record${am.total === 1 ? '' : 's'} for the district${am.sampleN ? `, ${am.sampleN} of them worked-example figures` : ''}`,
        lr.sentence,
        `Demand test: ${dt.verdict}`,
      ];
    };
    const tbl = { field: 'district', fmt: null, form: 'facts', title: 'Where each column is',
      rows: rows.map(r => ({ ...r, value: r.d.district || null, text: place(r), ticks: [], parts: null, note: null })) };
    vm.tables.push(tbl);
    const same = new Set(rows.map(r => `${r.d.city}|${r.d.district}`)).size === 1;
    vm.facts = same ? [{ title: `${cols.map(c => c.key).join(', ').replace(/, ([^,]*)$/, ' and $1')} are the same place — location does not separate them`, lines: facts(rows[0]) }]
      : rows.map(r => ({ title: `${r.key} — ${place(r)}`, lines: facts(r) }));
    const verified = rows.filter(r => comparableSupport(r.d).hasVerifiedPrice && isNum(comparableSupport(r.d).priceVsMedian));
    if (verified.length >= 2) vm.tables.push(one('priceVsMedian', 'pct1', r => comparableSupport(r.d).priceVsMedian,
      { table: { form: 'diverging', title: 'The price against the middle of the verified transacted comparables' } }));
    vm.words.push('Facts recorded for each place, never scored. No range from NAPIC is shown here.');
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'Place', 'What is recorded'],
      rows: () => rows.map(r => [`${r.key} — ${esc(r.name)}`, esc(place(r)), esc(facts(r).join(' · '))]) };
  }
  /* The scale: from the least to the most of the values and the reference
     marks, nought always inside it, on clean ticks (niceTicks), so the axis
     is never cut. */
  for (const t of vm.tables) {
    if (t.form === 'facts') continue;
    const xs = [0];
    for (const r of t.rows) {
      if (isNum(r.value)) xs.push(r.value);
      (r.ticks || []).forEach(x => xs.push(x.value));
      if (r.parts) { let s = 0; for (const p of r.parts) { if (isNum(p.value)) { s += p.value; xs.push(s); } } }
    }
    (t.refs || []).forEach(x => xs.push(x.value));
    const nt = niceTicks(Math.min(...xs), Math.max(...xs));
    t.lo = nt.lo; t.hi = nt.hi > nt.lo ? nt.hi : nt.lo + 1;
    /* A reference line is drawn inside the scale, never on its end: with
       every column under 1.00× the debt-service scale ended at 1.00, and the
       line sat on the track's rounded end, one pixel of it in sight (the
       verification of 4 Oct 2026, F13). The scale runs a step past it. */
    const step = nt.ticks.length > 1 ? nt.ticks[1] - nt.ticks[0] : (t.hi - t.lo);
    if ((t.refs || []).some(x => x.value >= t.hi)) t.hi += step;
    if ((t.refs || []).some(x => x.value <= t.lo && x.value !== 0)) t.lo -= step;
  }
  vm.shape = JSON.stringify([metric, vm.tables.map(t => [t.field, t.form, t.rows.map(r => [r.key, !!r.m, (r.parts || []).map(p => p.part), (r.ticks || []).length, r.active])]),
    vm.words, vm.facts || null, vm.twin.headers]);
  return vm;
}
const labX = (t, v) => (v - t.lo) / (t.hi - t.lo);
/* Where a line `w` px wide is centred on the track, kept whole inside it:
   nought at the track's end (every month below it) drew half a pixel. */
const labLineAt = (t, v, w) => `clamp(${w / 2}px, ${(labX(t, v) * 100).toFixed(3)}%, calc(100% - ${w / 2}px))`;
function labDrawCompare(P, lab, vm) {
  const body = P.els.cmpBody;
  const parts = [];
  const tableEls = [];
  const panels = el('div', { class: `lab-cmp-panels${vm.tables.length > 1 ? ' is-multi' : ''}` });
  vm.tables.forEach((t, ti) => {
    const table = el('table', { class: `lab-cmp lab-form-${t.form}`, data: { field: t.field, form: t.form } });
    table.append(el('caption', { class: ti === 0 ? 'lab-cmp-cap' : 'lab-cmp-cap lab-cmp-sub' }, ti === 0 ? `${vm.caption} ${t.title}.` : `${t.title}.`));
    const tb = el('tbody');
    const rowEls = [];
    t.rows.forEach(r => {
      const valueTd = el('td', { class: 'lab-cmp-v num' }, r.text);
      const tr = el('tr', { class: `lab-cmp-row lab-c-${r.key}${r.active ? ' is-active' : ''}`, data: { labCol: r.key }, 'data-value': isNum(r.value) || typeof r.value === 'string' ? String(r.value) : '' }, [
        el('th', { scope: 'row' }, [labLetter(r.key), el('span', { class: 'lab-cmp-name' }, ` ${r.key} — ${r.name}`), ' ', el('span', { class: 'lab-cmp-chip' }, r.chip)]),
        valueTd,
      ]);
      tb.append(tr);
      const re = { tr, valueTd, fill: null, segs: [], ticks: [], refs: [], zero: null, note: null };
      if (t.form !== 'facts') {
        const bar = el('tr', { class: `lab-cmp-barrow lab-c-${r.key}`, 'aria-hidden': 'true' });
        const track = el('div', { class: 'lab-track' });
        re.zero = el('span', { class: 'lab-zero' });
        track.append(re.zero);
        /* Placed with the scale, a frame at a time (labUpdateCompare): drawn
           once, the 100% line stayed where the first scale put it. */
        (t.refs || []).forEach(() => { const s = el('span', { class: 'lab-ref' }); re.refs.push(s); track.append(s); });
        if (r.parts) r.parts.forEach((p, i) => { const s = el('span', { class: `lab-bar-seg lab-seg-${i + 1}`, data: { part: p.part }, 'data-value': isNum(p.value) ? String(p.value) : '' }); re.segs.push(s); track.append(s); });
        else if (r.m) { re.fill = el('span', { class: 'lab-bar-fill' }); track.append(re.fill); }
        (r.ticks || []).forEach(() => { const s = el('span', { class: 'lab-mark' }); re.ticks.push(s); track.append(s); });
        bar.append(el('td', { colspan: '2' }, [track, r.note ? (re.note = el('span', { class: 'metaline lab-cmp-note' }, r.note)) : null]));
        tb.append(bar);
      }
      rowEls.push(re);
    });
    table.append(tb);
    panels.append(el('div', { class: 'lab-cmp-panel' }, table));
    tableEls.push({ table, rows: rowEls });
  });
  parts.push(panels);
  if (vm.facts) {
    const f = el('div', { class: 'lab-facts' });
    vm.facts.forEach(x => f.append(el('div', { class: 'panel lab-fact' }, [el('h3', { class: 'h-card' }, x.title), el('ul', { class: 'lab-fact-list' }, x.lines.map(l => el('li', {}, l)))])));
    parts.push(f);
  }
  const words = el('div', { class: 'lab-cmp-words' }, vm.words.map(w => el('p', { class: 'metaline' }, w)));
  parts.push(words);
  const twin = tableTwin(vm.twin.caption, vm.twin.headers, vm.twin.rows());
  twin.addEventListener('toggle', () => { if (twin.open) labPaintPanel(P); });
  twin.classList.add('lab-twin');
  parts.push(twin);
  body.replaceChildren(...parts);
  P.els.cmp = { tables: tableEls, words, twin };
  P.shape = vm.shape;
  labUpdateCompare(P, vm);
}
/* In place, while the view's shape holds: figures, marks and the scale. */
function labUpdateCompare(P, vm) {
  const E = P.els.cmp;
  vm.tables.forEach((t, ti) => {
    const te = E.tables[ti];
    t.rows.forEach((r, ri) => {
      const re = te.rows[ri];
      labText(re.valueTd, r.text);
      labAttr(re.tr, 'data-value', isNum(r.value) || typeof r.value === 'string' ? String(r.value) : '');
      labClass(re.tr, 'is-active', r.active);
      if (t.form === 'facts') return;
      const z = labX(t, 0) * 100;
      if (re.zero) labStyle(re.zero, 'left', labLineAt(t, 0, 1));
      (t.refs || []).forEach((x, i) => { if (re.refs[i]) labStyle(re.refs[i], 'left', labLineAt(t, x.value, 2)); });
      if (re.fill) labStyle(re.fill, 'transform', isNum(r.value) ? `translateX(${z.toFixed(3)}%) scaleX(${(r.value / (t.hi - t.lo)).toFixed(5)})` : 'scaleX(0)');
      if (r.parts) {
        let at = 0;
        r.parts.forEach((p, i) => {
          const s = re.segs[i];
          const v = isNum(p.value) ? p.value : 0;
          labAttr(s, 'data-value', isNum(p.value) ? String(p.value) : '');
          labStyle(s, 'transform', `translateX(${(labX(t, at) * 100).toFixed(3)}%) scaleX(${(v / (t.hi - t.lo)).toFixed(5)})`);
          at += v;
        });
      }
      (r.ticks || []).forEach((x, i) => { if (re.ticks[i]) labStyle(re.ticks[i], 'left', labLineAt(t, x.value, 2)); });
      if (re.note) labText(re.note, r.note || '');
    });
  });
  /* The twin's rows, written while it is open (and once, for the first
     drawing): closed, not even worked out a frame. */
  if (!(E.twin.open || !E.twinAt)) return;
  const html = vm.twin.rows().map(row => `<tr>${row.map((c, i) => `<td${i === 0 ? ' class="ident"' : ''}>${c}</td>`).join('')}</tr>`).join('');
  const tbody = E.twin.querySelector('tbody');
  if (tbody && E.twinAt !== html) { tbody.innerHTML = html; E.twinAt = html; }
}

/* The columns: which saved figures each shows, a copy added, one removed. */
function labColumnsCard(P, lab) {
  const card = el('section', { class: 'card ls-section lab-cols-card', 'aria-labelledby': labId(P, 'cols-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'cols-h') }, 'Columns'));
  const rec = lab.model ? pmFind(lab.model) : null;
  const offered = rec ? pmColumns(rec, State.deal, propertyStatus(State.deal)) : [];
  const list = el('ul', { class: 'lab-cols' });
  for (const c of lab.cols) {
    const li = el('li', { class: `lab-col-row lab-c-${c.key}${c.key === lab.active ? ' is-active' : ''}` });
    li.append(el('span', { class: 'lab-col-name' }, [labLetter(c.key), el('strong', {}, ` ${c.key} — ${c.name}`), ' ', el('span', { class: 'lab-cmp-chip' }, LAB_SOURCE_CHIP[labSourceKind(c)]),
      labMoveCount(c) ? el('span', { class: 'lab-tag lab-tag-whatif' }, `${labMoveCount(c)} move${labMoveCount(c) === 1 ? '' : 's'} not saved`) : null]));
    const acts = el('span', { class: 'lab-col-acts' });
    if (rec) {
      const sid = labId(P, `shows-${c.key}`);
      const sel = el('select', { class: 'select select-sm', id: sid, 'aria-label': `What column ${c.key} shows`, onchange: (e) => {
        const o = offered.find(x => x.id === e.target.value);
        if (!o) return;
        const i = lab.cols.indexOf(c);
        lab.cols[i] = labCol(c.key, o.id === 'base' ? 'base' : o.id === 'current' ? 'current' : `sc:${o.id}`, o.id === 'base' ? 'As saved' : o.short, o.inputs);
        pmCompareSelect(rec.id, labSavedIds(lab));
        labDraw(P, sid);
        labAfterStructure(P, lab, { address: true, say: `Column ${c.key} shows ${lab.cols[i].name}.` });
      } });
      const now = c.source === 'base' ? 'base' : c.source === 'current' ? 'current' : String(c.source).startsWith('sc:') ? c.source.slice(3) : '';
      if (!now) sel.append(el('option', { value: '', selected: '' }, `${c.name} (not saved)`));
      offered.forEach(o => sel.append(el('option', { value: o.id, selected: o.id === now ? '' : null }, o.id === 'base' ? 'As saved' : o.short)));
      acts.append(el('label', { class: 'sr-only', for: sid }, `What column ${c.key} shows`), sel);
    }
    if (labMoveCount(c)) acts.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: labId(P, `clear-${c.key}`),
      onclick: () => labClear(P, lab, c) }, `Clear ${c.key}’s moves`));
    if (c.key !== 'A') acts.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: labId(P, `remove-${c.key}`),
      onclick: () => {
        lab.cols = lab.cols.filter(x => x !== c);
        if (lab.active === c.key) lab.active = lab.cols[lab.cols.length - 1].key;
        if (rec && c.source !== 'variant') pmCompareSelect(rec.id, labSavedIds(lab));
        labDraw(P, labId(P, 'add'));
        labAfterStructure(P, lab, { address: c.source !== 'variant', say: `Column ${c.key} removed.`, focus: labId(P, 'cols-h') });
      } }, `Remove ${c.key}`));
    li.append(acts);
    list.append(li);
  }
  card.append(list);
  if (lab.cols.length < 3) {
    const act = labActive(lab);
    const free = LAB_LETTERS.find(x => !lab.cols.some(c => c.key === x));
    card.append(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: labId(P, 'add'), onclick: () => {
      /* The copy carries the moves it was made with, so a commit of it marks
         them as the reader's as a commit of the column it copied would. */
      const c = labCol(free, 'variant', `Copy of ${act.key}`, act.work, { of: act.key, inherited: pmCopy({ ...(act.inherited || {}), ...act.moves }) });
      lab.cols.push(c);
      lab.cols.sort((a, b) => LAB_LETTERS.indexOf(a.key) - LAB_LETTERS.indexOf(b.key));
      lab.active = c.key;
      labDraw(P, labId(P, `col-${c.key}`));
      labAfterStructure(P, lab, { say: `Column ${c.key} added, a copy of ${act.key}. Sliders move ${c.key}.` });
    } }, `Add a column — a copy of ${act.key}`));
  }
  return card;
}
function labClear(P, lab, c) {
  c.moves = {};
  c.work = pmCopy(c.baseInputs);
  c.cur = null;
  labDraw(P);
  labAfterStructure(P, lab, { say: `${c.key}’s moves cleared.`, focus: labId(P, `col-${c.key}`) });
}

/* COMMITS — THE ONLY WRITES. Each says what it does to whose figures. */
function labCommits(P, lab, col) {
  const card = el('section', { class: 'card ls-section lab-commit', 'aria-labelledby': labId(P, 'commit-h'), id: labId(P, 'commit') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'commit-h') }, `Keep ${col.key}`));
  const rec = lab.model ? pmFind(lab.model) : null;
  const n = labMoveCount(col);
  const kind = labSourceKind(col);
  const acts = el('div', { class: 'lab-commit-acts' });
  /* A new scenario is offered where it would differ from the property and
     from the column's own saved figures: a column with moves, or a lab
     variant or the calculator's unsaved changes that differ from the
     property. A saved scenario unmoved is saved already. */
  const differs = rec ? Object.keys(pmDiff(pmBare(col.work), pmInputsOf(rec))).length > 0 : false;
  const canSave = differs && (n > 0 || kind === 'variant' || kind === 'current');
  /* EACH COMMIT SAYS WHAT IT DOES TO WHOSE FIGURES (the brief's §8), the
     button and its toast alike — where it marks any: a column with nothing
     moved in the lab commits figures already as they were marked. */
  const yours = labMarked(col).length ? ' — the moved figures become yours' : '';
  /* The page's one primary is the identity line's Save (N3): here, under
     the figures, the same save is offered again, quieter. A panel with no
     identity line (the map's) keeps it primary. */
  const keepCls = P.compact ? 'btn-primary' : 'btn-ghost';
  if (rec) {
    acts.append(el('button', { type: 'button', class: `btn ${keepCls}`, id: labId(P, 'save'), disabled: canSave ? null : '',
      onclick: () => labNaming(P, lab, labScenarioNaming(lab, col)) },
      `Save ${col.key} as a scenario${yours}`));
    if (kind === 'sc' && n) acts.append(el('button', { type: 'button', class: 'btn btn-ghost', id: labId(P, 'update'), onclick: () => labUpdateScenario(P, lab) },
      `Update scenario “${col.name}”${yours}`));
  } else {
    acts.append(el('button', { type: 'button', class: `btn ${keepCls}`, id: labId(P, 'save-first'),
      onclick: () => labNaming(P, lab, { kind: 'property', value: pmNameOf(State.deal) }) }, 'Save this property first'));
  }
  acts.append(el('button', { type: 'button', class: 'btn btn-ghost', id: labId(P, 'open'), onclick: () => labOpenInCalculator(P, lab) },
    `Open ${col.key} in the calculator${yours}`));
  acts.append(el('button', { type: 'button', class: 'btn btn-quiet', id: labId(P, 'clear'), disabled: n ? null : '', onclick: () => labClear(P, lab, col) },
    `Clear ${col.key}’s moves`));
  card.append(acts);
  /* The name is asked for where its Save was pressed: here, or under the
     identity line (labIdentity). */
  if (lab.naming && lab.naming.at !== 'identity') card.append(labNameForm(P, lab, col));
  const why = [];
  if (!rec) why.push(`A scenario belongs to a saved property. “Save this property first” saves the deal on the calculator as a property — then ${col.key} can be saved as its scenario.`);
  else if (!canSave) why.push(differs ? `${col.key} is saved already, as “${col.name}” — move a figure to save a new scenario, or to update this one.`
    : `${col.key} holds the property as saved — move a figure first: a scenario with nothing changed is the property twice.`);
  why.push(`Saving or opening ${col.key} makes the moved figures yours, as typing them in the calculator does: a moved price or rent stops being an illustrative default. `
    + 'Until then nothing moved here is saved or marked as yours. The grade stays U while any figure that drives it — the built-up area and the maintenance too — is still the tool’s starting figure.');
  card.append(el('p', { class: 'metaline lab-commit-why' }, why.join(' ')));
  return card;
}
/* The column's figures as a commit writes them: the moved ones marked as
   the reader's (markTouched) on a copy, BEFORE anything stores it —
   propertyLoad saves the deal at once. The moved ones are the column's own
   and those it was copied with: a copy of a moved column, saved, stored
   the copied price unmarked, and the calculator would have called it the
   tool's illustrative default (the verification of 4 Oct 2026, F5). */
function labNext(col) {
  const next = pmCopy(col.work);
  for (const k of labMarked(col)) markTouched(next, k);
  return next;
}
/* What a commit's toast says of the figures it marked, and of the grade:
   committing turns the illustrative markers into the reader's own, as
   typing does, but the grade stays U while any figure that drives it is
   still the tool's — the built-up area and the maintenance too, which no
   knob moves (the brief's §13.9). */
const LAB_DRIVER_WORDS = { price: 'the price', rent: 'the rent', maintenance: 'the maintenance', sqft: 'the built-up area' };
const labList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
function labYoursWords(col) {
  const words = [...new Set(labMarked(col).map(k => LAB_INPUT_BY_K[k]?.say.toLowerCase() || (['city', 'district', 'projectId'].includes(k) ? 'the place' : k)))];
  if (!words.length) return '';
  return ` — ${labList(words)} ${words.length === 1 ? 'is' : 'are'} now yours, as if typed in the calculator`;
}
function labGateWords(d) {
  const left = evidenceDriversFor(d).filter(k => shownEvidence(d, k) === 'illustrative_default');
  if (!left.length) return '';
  return ` The grade stays U while ${labList(left.map(k => LAB_DRIVER_WORDS[k] || k))} ${left.length === 1 ? 'is' : 'are'} still the tool’s starting figure${left.length === 1 ? '' : 's'}.`;
}
function labNaming(P, lab, naming) {
  lab.naming = naming;
  labDraw(P, labId(P, naming.kind === 'property' ? 'property-name' : 'scenario-name'));
  const f = document.getElementById(labId(P, naming.kind === 'property' ? 'property-name' : 'scenario-name'));
  if (f) { f.focus(); f.select?.(); }
}
/* THE NAME, ASKED FOR IN THE PAGE — not prompt(), which a phone draws over
   everything and a screen reader announces out of place. */
function labNameForm(P, lab, col) {
  const isProp = lab.naming.kind === 'property';
  const fid = labId(P, isProp ? 'property-name' : 'scenario-name');
  const form = el('form', { class: 'lab-name-form', onsubmit: (e) => { e.preventDefault(); isProp ? labSaveProperty(P, lab, input.value) : labCommitScenario(P, lab, input.value); } });
  const input = el('input', { type: 'text', class: 'input', id: fid, maxlength: '80', value: lab.naming.value || '', autocomplete: 'off',
    oninput: (e) => { lab.naming.value = e.target.value; } });
  form.append(el('label', { for: fid, class: 'lab-name-label' }, isProp ? 'Name this property' : `Name ${col.key} as a scenario of “${pmFind(lab.model)?.name || ''}”`), input,
    el('div', { class: 'lab-name-acts' }, [
      el('button', { type: 'submit', class: 'btn btn-primary btn-sm', id: labId(P, 'name-save') }, 'Save'),
      el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: labId(P, 'name-cancel'), onclick: () => {
        const back = lab.naming?.at === 'identity' ? ['id-save', 'next-go'] : [isProp ? 'save-first' : 'save'];
        lab.naming = null; labDraw(P, back.map(x => labId(P, x)));
      } }, 'Cancel'),
    ]));
  return form;
}
/* "Save this property first": the deal on the calculator saved as a
   property (saveActiveProperty), and the lab opens it — the columns move
   onto it with their moves. The deal's column becomes the property as
   saved, its moves kept as moves; a copy keeps the figures it was copied
   with as well as its own moves. Rebuilt on the property's figures, a
   copy of a moved column lost what it had copied and went on calling
   itself "Copy of A" (the verification of 4 Oct 2026, F4). */
function labSaveProperty(P, lab, name) {
  const fromId = lab.naming?.at === 'identity';
  const rec = saveActiveProperty({ name: String(name || '').trim() || pmNameOf(State.deal) });
  if (!rec) return;
  const moved = lab.cols.map(c => ({ key: c.key, moves: { ...c.moves }, name: c.name, source: c.source, of: c.of, baseInputs: c.baseInputs, inherited: c.inherited || {} }));
  delete LAB[lab.key];
  const next = labEnsure({ kind: 'model', id: rec.id, cols: ['base'] });
  next.cols = moved.map(m => {
    const c = m.source === 'deal' ? labCol(m.key, 'base', 'As saved', pmInputsOf(rec))
      : labCol(m.key, 'variant', m.name, m.baseInputs, { of: m.of, inherited: pmCopy(m.inherited) });
    for (const [k, v] of Object.entries(m.moves)) labWrite(c, k, v);
    return c;
  });
  next.active = lab.active;
  if (P.key === lab.key) P.key = next.key;
  if (labSubject === lab.key) labSubject = next.key;
  /* The keyboard on the next thing to do with the column, which the
     property's save leaves enabled — beside the identity line where the
     save was asked for there. */
  labDraw(P, [...(fromId ? [labId(P, 'id-save'), labId(P, 'next-go')] : []), labId(P, 'save'), labId(P, 'open')]);
  labAfterStructure(P, next, { address: true });
}
function labCommitScenario(P, lab, name) {
  const rec = pmFind(lab.model);
  const col = labActive(lab);
  if (!rec) { toast('That property is no longer saved in this browser'); return null; }
  const next = labNext(col);
  const overrides = pmDiff(next, pmInputsOf(rec));
  if (!Object.keys(overrides).filter(k => k !== 'touched').length) { toast(`${col.key} holds the inputs “${rec.name}” is saved with — move a figure first.`); return null; }
  const yours = labYoursWords(col);
  const fromId = lab.naming?.at === 'identity';
  const sc = pmAddScenario(rec.id, overrides, String(name || '').trim() || `Scenario ${(rec.scenarios || []).length + 1}`);
  if (!sc) { toast(STORE_REFUSED); return null; }
  /* The calculator's comparison shows it beside the columns already here. */
  const shown = labSavedIds(lab);
  const fresh = pmFind(rec.id);
  const i = lab.cols.indexOf(col);
  lab.cols[i] = labCol(col.key, `sc:${sc.id}`, sc.name, pmSavedInputs(fresh, pmScenario(fresh, sc.id)));
  pmCompareSelect(rec.id, [...shown, sc.id]);
  lab.naming = null;
  /* Saved, the button that saved it is disabled: the keyboard goes to the
     next thing to do with the column, not to <body>. */
  labDraw(P, [...(fromId ? [labId(P, 'id-save'), labId(P, 'next-go')] : []), labId(P, 'open'), labId(P, `col-${col.key}`)]);
  labAfterStructure(P, lab, { address: true });
  toast(`Saved ${col.key} as the scenario “${sc.name}” of “${rec.name}”${yours}.${labGateWords(next)}`);
  return sc;
}
function labUpdateScenario(P, lab) {
  const rec = pmFind(lab.model);
  const col = labActive(lab);
  if (!rec || labSourceKind(col) !== 'sc') return null;
  const scId = col.source.slice(3);
  const next = labNext(col), yours = labYoursWords(col);
  const out = pmWriteScenario(rec.id, scId, pmDiff(next, pmInputsOf(rec)));
  if (!out) { toast(STORE_REFUSED); return null; }
  const fresh = pmFind(rec.id), sc = pmScenario(fresh, scId);
  const i = lab.cols.indexOf(col);
  lab.cols[i] = labCol(col.key, col.source, sc.name, pmSavedInputs(fresh, sc));
  labDraw(P, [labId(P, 'open'), labId(P, `col-${col.key}`)]);
  labAfterStructure(P, lab, {});
  toast(`Updated the scenario “${sc.name}” of “${rec.name}”${yours}.${labGateWords(next)}`);
  return sc;
}
/* OPEN IN THE CALCULATOR: the calculator is given the column's figures,
   marked as the reader's first (propertyLoad saves at once), and the deal
   it had is kept aside where it was the reader's own work. */
function labOpenInCalculator(P, lab) {
  const col = labActive(lab);
  const k = labSourceKind(col);
  const next = labNext(col), yours = labYoursWords(col);
  const scId = k === 'sc' ? col.source.slice(3) : k === 'current' ? State.deal?.scenarioId || null : null;
  const kept = propertyLoad(next, { modelId: lab.model || null, scenarioId: scId });
  /* With the calculator's own deal as the subject, the column's moves are
     the calculator's now: it starts from the figures it handed over, with
     nothing left to call "not saved", and the deal's column — read again on
     the way back — is the calculator's deal as it is now. Kept as moves,
     Back found them still "not saved" beside a deal column named "Sample
     deal" that held them (the verification of 4 Oct 2026, F2). */
  if (!lab.model) {
    col.baseInputs = pmNormalInputs(next);
    col.moves = {}; col.inherited = {};
    col.work = pmCopy(col.baseInputs);
    col.ref = labRun(col.baseInputs);
    col.cur = null;
  }
  navigate('/property/calculator');
  toast(`The calculator now holds ${col.key}${yours}.${labGateWords(next)}${pmKeptNote(kept)}`);
}

/* ------------------------------------------------------------------ painting */
/* ONE FRAME. Requests within a frame coalesce into one paint; a position
   passed over between frames is dropped, not queued. */
let labFrame = 0, labPaints = 0;
function labSchedule() {
  if (labFrame) return;
  labFrame = requestAnimationFrame(() => { labFrame = 0; labPaint(); });
}
function labPaint() {
  performance.mark('lab-paint-start');
  const fresh = new Set();
  for (const P of [...LAB_PANELS]) {
    if (!P.node.isConnected) { LAB_PANELS.delete(P); continue; }
    const lab = LAB[P.key];
    if (!lab) continue;
    /* The active column's model and grade — the only model runs a frame —
       outside the kept runs, so a drag does not fill them. */
    if (!fresh.has(lab.key)) {
      fresh.add(lab.key);
      const col = labActive(lab);
      if (num0(col.work.price) > 0) { const m = dealModel(col.work); col.cur = { m, g: propertyGrade(col.work, m) }; }
      else col.cur = null;
    }
    labPaintPanel(P);
  }
  for (const key of fresh) labNotify(LAB[key]);
  performance.measure('lab-paint', 'lab-paint-start');
  performance.clearMarks('lab-paint-start');
  if (++labPaints % 600 === 0) performance.clearMeasures('lab-paint');
}
const labCardSig = (lab) => JSON.stringify([lab.active, lab.naming?.kind || null, lab.cols.map(c => [c.key, c.source, labMoveCount(c)])]);
/* Every figure on the panel, from the columns' current runs. */
function labPaintPanel(P, { initial = false } = {}) {
  const lab = LAB[P.key];
  if (!lab || !P.els) return;
  const col = labActive(lab);
  /* The other columns from their runs as last made (pmCompareRun's, kept
     on the column until a figure of it changes — labWrite drops it): no
     model call, and no reading of a whole deal to find its kept run, a
     frame. The active one was run this frame. */
  for (const c of lab.cols) if (!c.cur) c.cur = labRun(c.work);
  const m = col.cur?.m || null, g = col.cur?.g || null, ref = col.ref?.m || null, d = col.work;
  /* What the changes are against, once a paint: worked out for each row,
     it compared two whole deals seven times a frame. */
  const bl = labBaseline(lab, col);
  const focused = document.activeElement;
  /* The knobs. */
  for (const inp of LAB_INPUTS) {
    const kn = P.els.knobs[inp.k];
    if (!kn) continue;
    const v = num0(d[inp.k]);
    const box = String(d[inp.k] ?? '');
    if (kn.num && focused !== kn.num && kn.boxAt !== box) { if (String(kn.num.value) !== box) kn.num.value = box; kn.boxAt = box; }
    const moved = Object.hasOwn(col.moves, inp.k);
    if (kn.range) {
      const [lo, hi] = labSpan(col, inp);
      labAttr(kn.range, 'min', lo); labAttr(kn.range, 'max', hi);
      if (Math.abs(num0(kn.range.value) - v) > inp.step / 2) kn.range.value = String(v);
      /* The value as it is said, worked out again only when what it says
         has changed (the deposit says its ringgit, which the price moves). */
      const sayAt = `${v}|${inp.k === 'downPct' ? m?.deposit : ''}`;
      if (kn.sayAt !== sayAt) { kn.sayAt = sayAt; labAttr(kn.range, 'aria-valuetext', inp.spoken(v, m)); }
      labStyle(kn.range, '--pos', `${(clamp((v - lo) / (hi - lo), 0, 1) * 100).toFixed(2)}%`);
      if (kn.ticks) [...kn.ticks.children].forEach((t, i) => labStyle(t, '--at', String((inp.ticks[i] - lo) / (hi - lo))));
      if (kn.spanEdges && kn.spanAt !== `${lo}|${hi}`) { kn.spanAt = `${lo}|${hi}`; labText(kn.spanEdges, `${labEdge(inp, lo)} to ${labEdge(inp, hi)}: ${inp.basis}`); }
    } else if (kn.spanEdges) labText(kn.spanEdges, `Typed into the box; ${inp.basis}`);
    /* Moved: the what-if tag in the evidence tag's place, and the way back
       in sight — each in the room it held from the first drawing. */
    if (kn.whatIf) {
      labClass(kn.whatIf, 'is-idle', !moved);
      labClass(kn.ev, 'is-idle', moved);
      labClass(kn.reset, 'is-idle', !moved);
      const desc = `${kn.ids.sid} ${moved ? kn.ids.wid : kn.ids.eid}`;
      labAttr(kn.range, 'aria-describedby', desc);
      labAttr(kn.num, 'aria-describedby', desc);
    }
    if (kn.ev) { labText(kn.ev, labEvidenceWords(d, inp.k)); labClass(kn.ev, 'is-default', shownEvidence(d, inp.k) === 'illustrative_default'); }
    if (kn.zero) kn.zero.hidden = !(m && m.zeroRateModelled);
    if (kn.recover) labText(kn.recover, num0(d.renoValueRecoveryPct) > 0
      ? `Moves the cash required and, through the ${labPctIn(num0(d.renoValueRecoveryPct))} of it recovered at the sale, the sale value — not the rent you entered.`
      : 'Moves the cash required, and the gains tax it is allowed against — none of it is recovered at the sale (0%, set in the calculator), and it does not change the rent you entered.');
  }
  /* The chain. */
  const empty = !(num0(d.price) > 0);
  for (const f of LAB_FIGURES) {
    const ce = P.els.chain[f.key];
    if (!ce) continue;
    const v = m ? f.read(m, d) : null;
    labText(ce.value, LAB_FORMATS[f.fmt](v));
    labAttr(ce.value, 'data-value', isNum(v) ? String(v) : '');
    labClass(ce.value, 'neg', !!f.neg && isNum(v) && v < 0);
    labText(ce.label, f.label(d));
    /* The change, worked out again only when either figure has changed. */
    const rv = m && ref ? f.read(ref, col.baseInputs) : null;
    if (!(ce.dlAt && ce.dlAt[0] === v && ce.dlAt[1] === rv && ce.dlAt[2] === !!(m && ref))) ce.dlAt = [v, rv, !!(m && ref), m && ref ? labDelta(f.fmt, v, rv) : null];
    const dl = ce.dlAt[3];
    labText(ce.deltaEye, empty ? '' : dl ? dl.mark : '');
    labText(ce.deltaEar, empty ? '' : dl ? (dl.same ? 'unchanged' : `${dl.words} ${bl.label}`) : '');
    labText(ce.note, empty ? 'Needs a purchase price' : m ? (f.note(m, d) || '') : '');
    /* Formulas of closed rows wait until they open, except in the page's
       first draw — served whole, with no script to open them. */
    if (initial || ce.det.open) labText(ce.formula, empty ? 'Needs a purchase price: the model cannot price a purchase with no price, so this column runs nothing until one is typed.' : m ? f.formula(d, m) : '');
  }
  /* The drawer's formula: the row last pressed from 1440px, else the
     first — the same words its row writes (LAB_FIGURES). */
  if (P.els.how && (initial || P.els.how.node.open)) {
    const f = LAB_FIGURES.find(x => x.key === P.formulaKey) || LAB_FIGURES[0];
    labText(P.els.how.head, f.label(d));
    labText(P.els.how.formula, empty ? 'Needs a purchase price: the model cannot price a purchase with no price, so this column runs nothing until one is typed.' : m ? f.formula(d, m) : '');
  }
  if (P.els.chain.irrPct?.paidBox && (initial || P.els.chain.irrPct.det.open)) {
    const box = P.els.chain.irrPct.paidBox;
    const words = !m ? '' : labPaid(d)
      ? LAB_PAID.map(f => f.formula(d, m)).join(' ')
      : 'The net proceeds of that sale and the total profit are part of the full investor report, which is a preview: the calculator’s Report section shows it in this browser. Nothing is on sale.';
    if (box.textContent !== words) box.replaceChildren(el('p', { class: 'lab-formula' }, words));
  }
  for (const f of LAB_PAID) {
    const pe = P.els.paid[f.key];
    if (!pe) continue;
    const v = m ? m[f.key] : null;
    labText(pe.value, LAB_FORMATS[f.fmt](v));
    labAttr(pe.value, 'data-value', isNum(v) ? String(v) : '');
  }
  /* The grade: the letter, the verdict and the worst gate, every frame. */
  if (P.els.grade) {
    const worst = g ? ['critical', 'serious', 'warning'].map(s => g.gates.find(x => x.severity === s)).find(Boolean) : null;
    labText(P.els.grade.letter, LAB_FORMATS.grade(g?.grade));
    labAttr(P.els.grade.letter, 'data-value', g?.grade || '');
    labText(P.els.grade.verdict, g ? g.verdict : 'Needs a purchase price');
    labText(P.els.grade.gate, worst ? `${g.gates.length} gate${g.gates.length === 1 ? '' : 's'}; the most serious: ${worst.text}` : g ? 'No gate is open.' : '');
    labText(P.els.grade.whyLetter, g?.grade || 'there is no grade');
    if (initial || P.els.grade.why.open) {
      const rank = { critical: 0, serious: 1, warning: 2 };
      const gates = g ? [...g.gates].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)) : [];
      const score = !g ? 'No grade: the column needs a purchase price.'
        : `${!isNum(g.score) ? 'Not scored' : g.grade === 'U' ? `Model score ${g.score}/100 — not carried into a grade` : `Score ${g.score}/100`}, on ${fmtPct(g.coverage * 100, 0)} of the framework’s weight. `
          + 'A research grade on the evidence entered: not a bank decision, not a valuation and not legal clearance. How it is reached, pillar by pillar, is in the calculator.';
      const sig = JSON.stringify([score, gates.map(x => [x.severity, x.text, x.who || ''])]);
      if (P.els.grade.whyAt !== sig) {
        P.els.grade.whyAt = sig;
        P.els.grade.whyBody.replaceChildren(
          /* The words one text node after the chip, as the served page's
             markup reads back: a space of its own was a node of its own
             once drawn, and the words stood 4px from where they were served. */
          gates.length ? el('ul', { class: 'lab-grade-gates' }, gates.map(x => el('li', { data: { severity: x.severity } }, [
            x.severity === 'critical' ? el('span', { class: 'chip chip-bronze' }, 'Blocking') : null,
            `${x.severity === 'critical' ? ' ' : ''}${x.text}${x.who ? ` Confirm with: ${x.who}.` : ''}`]))) : el('p', { class: 'metaline' }, g ? 'No gate is open.' : ''),
          el('p', { class: 'metaline lab-grade-score' }, score));
      }
    }
  }
  /* What moved, what the figures rest on. */
  if (P.els.movedBy) {
    const moves = Object.keys(col.moves).filter(k => LAB_INPUT_BY_K[k]).map(k => LAB_INPUT_BY_K[k].say.toLowerCase());
    const placeMoved = ['city', 'district'].some(k => Object.hasOwn(col.moves, k));
    if (placeMoved) moves.push('the place');
    let s = '';
    if (m && ref && moves.length) {
      /* The rows the moves moved, found by comparing the figures as printed
         — never a list written by hand — set apart by semicolons, as a row's
         name can carry a comma ("value less loan, year 10"). The report's
         two figures join them where it is unlocked. */
      const moved = (f) => LAB_FORMATS[f.fmt](f.read(m, d)) !== LAB_FORMATS[f.fmt](f.read(ref, col.baseInputs));
      const movedRows = LAB_FIGURES.filter(moved).map(f => f.label(d).replace(/ \(before selling costs\)$/, '').toLowerCase());
      if (labPaid(d)) LAB_PAID.forEach(f => { if (LAB_FORMATS[f.fmt](m[f.key]) !== LAB_FORMATS[f.fmt](ref[f.key])) movedRows.push(f.label.toLowerCase()); });
      s = `Moved by ${col.key}’s moves (${moves.join(', ')}): ${movedRows.length ? movedRows.join('; ') : 'none of the seven'}.`;
      /* WHAT RENOVATION DOES NOT MOVE, said and nothing more. "Renovation
         moves only the cash required and the rate of return" was false
         wherever any of it is recovered at the sale (value less loan and
         the sale move too) or the gains tax changes with it — it is
         allowed against the gain — and the list above already says what
         moved (the verification of 4 Oct 2026, F3). */
      if (lab.input === 'renovation' || Object.hasOwn(col.moves, 'renovation'))
        s += ' Renovation does not change the rent you entered.';
    }
    labText(P.els.movedBy, s);
    P.els.movedBy.hidden = !s;
  }
  if (P.els.context) labText(P.els.context, `Hold ${labYears(normHoldYears(d.holdYears))} · tenure ${labYears(num0(d.tenureYears))} · rent growth ${fmtNum(num0(d.rentGrowthPct), 1)}% · appreciation ${fmtNum(num0(d.apprecPct), 1)}% a year — change these in the calculator.`);
  if (P.els.rests) {
    const q = propertyReviewQueue(d);
    labText(P.els.rests, q.length ? `These figures rest on ${q.length} of the tool’s starting figures: ${q.map(x => x.label.toLowerCase()).join(', ')}.` : 'None of these figures rests on a starting figure of the tool’s.');
  }
  /* ALWAYS SAID, so nothing moves under the thumb. The line appeared at the
     first tick of a drag, above the sliders: where the browser does not
     anchor the scroll (Safari), the slider and all seven results dropped
     43px under the finger at 360 (the re-verification of 4 Oct 2026). It now
     stands from the first drawing, saying what happens to a move before
     there is one, and holds its room on a phone (styles.css). */
  if (P.els.unsaved) {
    const withMoves = lab.cols.filter(c => labMoveCount(c));
    const s = withMoves.length ? `${withMoves.map((c, i) => `${c.key} has ${labMoveCount(c)}${i === 0 ? ` move${labMoveCount(c) === 1 ? '' : 's'}` : ''}`).join(' and ')} not saved — kept until you close or reload this tab.`
      : 'Moves you make here are kept until you close or reload this tab.';
    labText(P.els.unsavedSay, s);
    P.els.unsaved.classList.toggle('is-unsaved', withMoves.length > 0);
  }
  /* What follows the moves: the baseline's name, the links to where a
     figure is entered (only while the column is the calculator's deal as
     it is), and the column and commit cards — drawn again only when a
     column's count of moves, its source or the column moved changes, not
     at every frame. */
  if (P.els.baseline) labText(P.els.baseline, `Changes ${bl.label}`);
  (P.els.where || []).forEach(n => { n.hidden = labMoveCount(col) > 0; });
  const sig = labCardSig(lab);
  if (!initial && sig !== P.cardSig && P.els.colsCard?.isConnected) {
    const had = document.activeElement && [P.els.colsCard, P.els.commitCard, P.els.idAct].some(n => n?.contains(document.activeElement)) ? document.activeElement.id : null;
    const cc = labColumnsCard(P, lab), cm = labCommits(P, lab, col);
    P.els.colsCard.replaceWith(cc); P.els.commitCard.replaceWith(cm);
    P.els.colsCard = cc; P.els.commitCard = cm; P.cardSig = sig;
    /* The identity line's Save offers what the commit card's does. */
    if (P.els.idAct?.isConnected) { const a = labIdentityAct(P, lab); P.els.idAct.replaceWith(a); P.els.idAct = a; }
    if (P.address) labBarSync();
    if (had) document.getElementById(had)?.focus({ preventScroll: true });
  }
  /* The comparison: in place while its shape holds, drawn again when not. */
  if (P.els.cmpBody) {
    const vm = labMetricView(lab.metric, lab);
    if (initial || vm.shape !== P.shape || !P.els.cmp) labDrawCompare(P, lab, vm); else labUpdateCompare(P, vm);
  }
}

/* ------------------------------------------------------------------- speech */
/* ONE SENTENCE, A MOMENT AFTER THE CHANGE — never on each tick, which would
   talk over the reader the whole length of a drag. */
let labSayTimer = 0;
function labSay(P, lab, k) {
  clearTimeout(labSayTimer);
  labSayTimer = setTimeout(() => {
    const col = labActive(lab), inp = LAB_INPUT_BY_K[k];
    const m = col.cur?.m, ref = col.ref?.m;
    if (!inp) return;
    if (!m) { liveSay(`${inp.say} ${inp.shown(num0(col.work[k]))}. ${col.key} needs a purchase price; nothing is computed.`); return; }
    const dl = ref ? labDelta('money0', m.instalment, ref.instalment) : null;
    const bl = labBaseline(lab, col).label.replace(/^vs /, 'on ');
    liveSay(`${inp.say} ${inp.shown(num0(col.work[k]))}. Repayment ${isNum(m.instalment) ? `${labMoney(m.instalment)} a month` : 'not computable'}${dl ? (dl.same ? `, unchanged ${bl}` : `, ${dl.words} ${bl}`) : ''}. Monthly position ${labMoney(m.cashflowMonthly)}.`);
    if (k === 'renovation') labRenoCard(P, lab);
  }, 500);
}
/* With the renovation knob let go: what the renovation buys, by the
   calculator's own with-and-without run (renovationReturn) — one model run
   more, on release only. */
function labRenoCard(P, lab) {
  for (const Q of LAB_PANELS) {
    if (Q.key !== lab.key) continue;
    const card = Q.els?.knobs?.renovation?.card;
    const col = labActive(lab);
    if (!card || !col.cur) continue;
    const r = renovationReturn(col.work, col.cur.m);
    card.hidden = false;
    card.replaceChildren(el('p', { class: 'metaline' }, r.applicable
      ? `With and without the renovation (the calculator’s renovation return): rate of return ${fmtPct(r.irrWith, 2)} with it, ${fmtPct(r.irrWithout, 2)} without; cash required ${labMoney(r.cashWith)} with it, ${labMoney(r.cashWithout)} without. The share of the rent that depends on it is ${labPctIn(r.rentUpliftPct)} — set in the calculator, never by this knob.`
      : r.why));
  }
}
function labSayMetric(lab) {
  const mt = LAB_METRICS.find(x => x.id === lab.metric);
  const vm = labMetricView(lab.metric, lab);
  const t = vm.tables[0];
  liveSay(`Comparing by ${mt.say}: ${t.rows.map(r => `${r.key} ${r.text}`).join(', ')}. Order ${lab.cols.map(c => c.key).join(', ')}.`);
}
/* After a change of structure: the listeners told, the address written
   where a saved column changed, and the change said. */
function labAfterStructure(P, lab, { address = false, say = null, focus = null } = {}) {
  labNotify(lab);
  if (address && P.address) labAddressSoon(lab);
  if (say) liveSay(say);
  if (focus) { const n = document.getElementById(focus); if (n) focusAfterRedraw(n); }
}
/* Every panel drawn again from LAB: for a subject opened from outside. */
function labRefresh() {
  for (const P of [...LAB_PANELS]) {
    if (!P.node.isConnected) { LAB_PANELS.delete(P); continue; }
    if (P.address && labSubject) P.key = labSubject;
    labDraw(P);
  }
}

/* ---------------------------------------------------------------- the page */
/* /property AND /property/lab (N3, the owner's decision D18). Property's
   landing opens the Lab on the calculator's deal, in the order a reader
   decides in: which property this is, its four figures, the five sliders,
   what they move, A, B and C side by side, then keeping one. The Start here
   panel (startHereFor) and the head's second line went: a reader met about
   180 words before the first control, 150 of them prose. What the second
   line said — moves are what-ifs, kept in this tab until saved — the line
   above the sliders says from the first drawing (labPaintPanel). */
VIEWS.propertyLab = () => {
  labArrive();
  /* On the layout system (ls-page: 37-layout-system.js, styles.css). */
  const wrap = el('div', { class: 'lab-page ls-page' });
  /* Its own state, beside its name (N2b, the 5 Oct audit): TOOLS says beta,
     and TOOL_FLAGGED marks no tab Beta, so the page's only visible state
     was its product's "Property Intelligence · Live". */
  wrap.append(pageHead({ title: 'Scenario Lab', badge: toolBadge('lab'), cls: 'lab-page-hd',
    lede: 'Move a slider and every result below follows — from the calculator’s own model.' }));
  for (const P of [...LAB_PANELS]) if (P.address) LAB_PANELS.delete(P);
  wrap.append(scenarioLabPanel(null, { idPrefix: 'lab', address: true }).node);
  return wrap;
};
