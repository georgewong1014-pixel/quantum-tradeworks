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
    /* While any fee line is not Verified, the headline says how much of it
       rests on those lines; the row's calculation names each one (the fee
       rulebook, 70-property.js). Short, because the note is the tile's and
       the chain row's: one line in the row at 360px in Verdana, or the last
       result left the screen (mobile.mjs, batch1-phone), and two on the
       tile, or the first slider went under the action bar (n3-first-view).
       An unknown rule is unverified too; the row's calculation, the
       calculator and its ledger say which of the two each line is. */
    note: (m) => [(m.missingCostLines || []).length ? 'so far' : null,
      m.unconfirmedCost > 0 ? `${labMoney(m.unconfirmedCost)} on unverified lines` : null].filter(Boolean).join(' · '),
    formula: (d, m) => `${labMoney(m.transactionCash)} to complete + ${labMoney(m.improvementCash)} renovation and set-up + `
      + `${isNum(m.reserveCash) ? `${labMoney(m.reserveCash)} reserve (${labYears(m.reserveMonths).replace('year', 'month')})` : 'a reserve that cannot be priced'}`
      + ` = ${labMoney(m.safeCashRequired)}${(m.missingCostLines || []).length ? ' so far' : ''}. Still to pay on completion: ${labMoney(m.cashStillRequiredToComplete)}. `
      + (m.unconfirmedCost > 0
        ? `${labMoney(m.unconfirmedCost)} of it rests on unverified or unknown lines: ${feeUncertainWords(m, labMoney)}`
        : 'No line in it rests on an estimate or an unknown rule: each fee line is computed from its official source or is your own quote')
      + ` (fee rulebook ${FEE_TABLE.version}, checked ${feeDay(FEE_TABLE.checkedOn)}).` },
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
const LAB_SOURCE_CHIP = { deal: 'On the calculator', current: 'On the calculator', base: 'As saved', sc: 'Scenario', variant: 'Lab variant — not saved',
  pm: 'Another property', sample: 'Sample — not a real listing' };
let labSubject = null;          /* the page's subject */
let labUrlSeen = null;          /* the address last read on arrival */
let labArrivalNote = null;      /* said for the arrival that needed it */
const LAB_LISTENERS = new Set();
const LAB_PANELS = new Set();

const labKeyOf = (spec) => (spec?.kind === 'model' ? `m:${spec.id}` : 'deal');
const labSourceKind = (c) => (String(c.source).startsWith('sc:') ? 'sc' : String(c.source).startsWith('pm:') ? 'pm' : c.source);
/* COLUMNS FROM ANOTHER PROPERTY (the decision layer, P6). Column A is the
   lab's subject — the property opened, or the calculator's deal — and B
   and C may be its scenarios and copies, as before, or another of the
   reader's saved properties ('pm:<id>', or 'pm:<id>/<scenario id>') or the
   sample deal ('sample'). Such a column carries `prop`, the property it is
   of ('pm:<id>' or 'sample'): it keeps its own figures, its own route and
   asset and so its own model, and nothing answered for another property's
   columns reaches it. A copy of it is of its property too. */
const labPmRef = (source) => { const m = /^pm:([^/]+)(?:\/(.+))?$/.exec(String(source || '')); return m ? { id: m[1], sc: m[2] || null } : null; };
const labPropOf = (col) => col?.prop || 'own';
/* The saved property a column's figures belong to: the subject's, another
   one's, or none (the calculator's unsaved deal, the sample). */
const labColRecId = (lab, col) => (col?.prop ? (String(col.prop).startsWith('pm:') ? col.prop.slice(3) : null) : lab.model);
const labColRec = (lab, col) => { const id = labColRecId(lab, col); return id ? pmFind(id) : null; };
/* A source another property's column may be given, as the address and a
   saved comparison name it: the sample, or a saved property (or one of its
   scenarios) that is not the subject. */
function labForeignCol(key, id, subjectId = null) {
  if (id === 'sample') return labCol(key, 'sample', 'Sample deal', pmSampleDeal(), { prop: 'sample' });
  const r = labPmRef(id), rec = r && r.id !== subjectId ? pmFind(r.id) : null;
  if (!rec) return null;
  const sc = r.sc ? pmScenario(rec, r.sc) : null;
  if (r.sc && !sc) return null;
  return labCol(key, sc ? `pm:${rec.id}/${sc.id}` : `pm:${rec.id}`, sc ? `${rec.name} — ${sc.name}` : rec.name, pmSavedInputs(rec, sc), { prop: `pm:${rec.id}` });
}
/* The figures run: none without a price, which the model cannot carry
   (an emptied price box is not nought — 75-property-grade.js). */
const labRun = (d) => (d && num0(d.price) > 0 ? pmCompareRun(d) : null);
/* `inherited`: the moves a copy was made with — the figures the column it
   copied had moved in the lab — which a commit marks as the reader's with
   the copy's own (labMarked). */
function labCol(key, source, name, baseInputs, extra = {}) {
  const base = pmBare(pmCopy(baseInputs || {}));
  return { key, source, name, of: null, prop: null, inherited: {}, baseInputs: base, moves: {}, work: pmCopy(base), ref: labRun(base), cur: null, ...extra };
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
  /* Another property's: as it is saved now; the sample, as the tool has it. */
  if (k === 'pm') {
    const r = labPmRef(col.source), other = r ? pmFind(r.id) : null;
    if (!other) return null;
    if (!r.sc) return pmInputsOf(other);
    const sc = pmScenario(other, r.sc);
    return sc ? pmSavedInputs(other, sc) : null;
  }
  if (k === 'sample') return pmSampleDeal();
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
    if (!now) { col.name = `${col.name} — ${['sc', 'pm'].includes(labSourceKind(col)) ? 'no longer saved' : 'no longer on the calculator'}`; col.source = 'variant'; continue; }
    const base = pmBare(pmCopy(now));
    if (labSourceKind(col) === 'sc') { const sc = pmScenario(rec, col.source.slice(3)); if (sc) col.name = sc.name; }
    /* Another property's column is named as that property is now. */
    if (labSourceKind(col) === 'pm') {
      const r = labPmRef(col.source), other = pmFind(r.id), sc = r.sc ? pmScenario(other, r.sc) : null;
      col.name = sc ? `${other.name} — ${sc.name}` : other.name;
    }
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
    /* The property's own, named as another property's would be — a saved
       comparison names every column so — read as its own. */
    const own = (id) => { const r = labPmRef(id); return r && r.id === rec.id ? (r.sc || 'base') : id; };
    const foreign = (id) => !byId.has(id) && !!labForeignCol('A', id, rec.id);
    let ids = Array.isArray(spec.cols) ? spec.cols.map(own).filter(id => byId.has(id) || foreign(id)) : [];
    /* Column A is the property opened: one of its own. */
    if (ids.length && !byId.has(ids[0])) ids.unshift('base');
    if (!ids.length) {
      const chosen = (PM_COMPARE[rec.id] || []).filter(id => byId.has(id) && id !== 'base');
      const rest = offered.map(c => c.id).filter(id => id !== 'base' && !chosen.includes(id));
      const first = spec.scenarioId && byId.has(spec.scenarioId) ? [spec.scenarioId] : [];
      ids = ['base', ...new Set([...first, ...chosen, ...rest])].slice(0, 3);
    }
    ids = [...new Set(ids)].slice(0, 3);
    const cols = ids.map((id, i) => {
      const o = byId.get(id);
      if (!o) return labForeignCol(LAB_LETTERS[i], id, rec.id);
      const source = id === 'base' ? 'base' : id === 'current' ? 'current' : `sc:${id}`;
      return labCol(LAB_LETTERS[i], source, id === 'base' ? 'As saved' : o.short, o.inputs);
    });
    if (cols.length === 1) cols.push(labCol('B', 'variant', 'Copy of A', cols[0].work, { of: 'A' }));
    return { key: `m:${rec.id}`, model: rec.id, cols, active: 'B', input: 'price', metric: 'yield', lens: LAB_LENS_DEFAULT, gesture: null, naming: null };
  }
  const a = labCol('A', 'deal', labDealName(), pmBare(State.deal));
  /* Beside the calculator's deal, other properties named by the address. */
  const more = (Array.isArray(spec.cols) ? [...new Set(spec.cols)] : []).map(id => labForeignCol('B', id)).filter(Boolean).slice(0, 2);
  more.forEach((c, i) => { c.key = LAB_LETTERS[i + 1]; });
  const cols = more.length ? [a, ...more] : [a, labCol('B', 'variant', 'Copy of A', a.work, { of: 'A' })];
  return { key: 'deal', model: null, cols, active: 'B', input: 'price', metric: 'yield', lens: LAB_LENS_DEFAULT, gesture: null, naming: null };
}
/* A subject's state, made the first time it is asked for. The calculator's
   deal, when it is a saved property, opens as that property — its columns,
   and the scenario the calculator has open beside it. */
function labEnsure(spec) {
  if (spec.kind === 'deal') {
    const st = propertyStatus(State.deal);
    /* Other properties named beside the deal stay beside it. */
    if (st.kind === 'model') spec = { kind: 'model', id: st.rec.id, scenarioId: st.sc?.id || null, lens: spec.lens,
      cols: Array.isArray(spec.cols) && spec.cols.length ? [st.sc?.id || 'base', ...spec.cols] : undefined };
  }
  const key = labKeyOf(spec);
  const fresh = spec.cols && LAB[key] && pmCanon(spec.cols) !== pmCanon(labSavedIds(LAB[key]));
  if (!LAB[key] || fresh) { const made = labBuild(spec); if (!made) return null; LAB[key] = made; }
  else if (!labRebase(LAB[key])) { delete LAB[key]; return null; }
  if (spec.metric && LAB_METRIC_IDS.includes(spec.metric)) LAB[key].metric = spec.metric;
  if (spec.lens && LAB_LENS_IDS.includes(spec.lens)) LAB[key].lens = spec.lens;
  return LAB[key];
}
/* A column's source as the address names it: 'base', 'current', a
   scenario's id, or another property's 'pm:<id>[/<scenario id>]' or
   'sample'. */
const labColId = (c) => (c.source === 'base' ? 'base' : c.source === 'current' ? 'current' : String(c.source).startsWith('sc:') ? c.source.slice(3) : c.source);
const labSavedIds = (lab) => lab.cols.filter(c => c.source !== 'variant' && c.source !== 'deal').map(labColId);
/* The subject's own saved columns: what the calculator's comparison of
   this property is told (PM_COMPARE) — never another property's. */
const labOwnIds = (lab) => lab.cols.filter(c => !c.prop && c.source !== 'variant' && c.source !== 'deal').map(labColId);
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
  /* A saved comparison (P6), ?compare=<id>: its property, its columns and
     its lens, as the address would name them. */
  const saved = q.get('compare') ? labComparisonOf(q.get('compare')) : null;
  if (saved) {
    q.set('model', saved.model);
    q.set('cols', saved.cols.join(','));
    if (saved.lens) q.set('lens', saved.lens); else q.delete('lens');
    if (saved.metric) q.set('by', saved.metric); else q.delete('by');
  }
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
  const lens = LAB_LENS_IDS.includes(q.get('lens')) ? q.get('lens') : null;
  const cols = (q.get('cols') || '').split(',').map(s => s.trim()).filter(Boolean);
  let lab = null;
  if (q.get('compare') && !saved) labArrivalNote = 'That comparison is not saved in this browser — showing the deal on the calculator.';
  if (model) {
    lab = pmFind(model) ? labEnsure({ kind: 'model', id: model, cols: cols.length ? cols : null, metric, lens }) : null;
    if (!lab) labArrivalNote = saved ? 'That comparison’s first property is no longer saved in this browser — showing the deal on the calculator.'
      : 'That property is not saved in this browser — showing the deal on the calculator.';
  }
  /* Beside the calculator's deal, the other properties the address names. */
  if (!lab) lab = labEnsure({ kind: 'deal', metric, lens, cols: !model && cols.length ? cols : null });
  /* The comparison and the lens are the address's: none named is Yield,
     and the cash-flow lens. */
  lab.metric = metric || 'yield';
  lab.lens = lens || LAB_LENS_DEFAULT;
  labSubject = lab.key;
  /* A saved comparison opened is named in the address as its columns are. */
  if (saved || q.get('compare')) labAddressSoon(lab);
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
  ['model', 'cols', 'by', 'lens', 'compare'].forEach(k => q.delete(k));
  if (lab.model) { q.set('model', lab.model); const ids = labSavedIds(lab); if (ids.length) q.set('cols', ids.join(',')); }
  /* Beside the calculator's deal: the other properties' columns (P6). */
  else { const ids = labSavedIds(lab); if (ids.length) q.set('cols', ids.join(',')); }
  if (lab.metric && lab.metric !== 'yield') q.set('by', lab.metric);
  if (lab.lens && lab.lens !== LAB_LENS_DEFAULT) q.set('lens', lab.lens);
  const s = q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%2F/g, '/');
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
  P.els = { knobs: {}, chain: {}, paid: {}, cmp: null, pe: null, au: null, nd: null, cm: null, xr: null };
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
  /* The price against the reader's evidence (the decision layer, P2) —
     or, answered Auction, the auction risk mode in its place (P3), or,
     answered New development, the developer premium model (P4). */
  const route = dealRoute(labAnswerInputs(lab));
  const price = P.compact ? null : route === 'auction' ? labAuctionSection(P, lab) : route === 'newdev' ? labNewDevSection(P, lab) : labPriceSection(P, lab);
  /* Answered Commercial, of any subtype and on any route: the four rents,
     their sustainability and the lease-down (P5), after the price. */
  const commercial = !P.compact && propertyClassOf(labAnswerInputs(lab)) === 'commercial' ? labCommercialSection(P, lab) : null;
  const evidence = labEvidence(P, lab);
  /* Columns of more than one property, route or asset: each on its own
     model, side by side, under a lens (P6). */
  const cross = labCrossRoute(lab) ? labXrCard(P, lab) : null;
  outputs.append(...[chain, alert, price, commercial, evidence, cross, labCompare(P, lab), P.els.colsCard, P.els.commitCard].filter(Boolean));
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
/* The page's identity line says the same in one clause (the 9 Oct audit,
   #5): every denial kept — arithmetic, not advice, not a valuation, not a
   forecast, nothing ranked — and only the words around them dropped. */
const LAB_CLAIM_SHORT = 'Arithmetic, not advice, not a valuation, not a forecast — nothing here is ranked.';
const LAB_NOT_OFFICIAL ='Not an official property valuation — in Malaysia that must be carried out by a registered valuer.';
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
    /* The two questions and the objective (the decision layer, P1:
       83-property-decision.js) after the line that names the property and
       its disclosures, and before the figures their answers lead. */
    hd.append(labIdentity(P, lab, status), labQuestions(P, lab), labTiles(P, lab));
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
  /* A scenario of the property the column is of (P6): another property's
     column is saved as a scenario of that property. */
  const rec = labColRec(lab, col);
  if (!rec) return false;
  const differs = Object.keys(pmDiff(pmBare(col.work), pmInputsOf(rec))).length > 0;
  const kind = labSourceKind(col);
  return differs && (labMoveCount(col) > 0 || kind === 'variant' || kind === 'current');
}
const labScenarioNaming = (lab, col, at = null) => {
  const rec = labColRec(lab, col);
  return { kind: 'scenario', at, value: cpScenarioName(pmDiff(labNext(col), pmInputsOf(rec)), pmInputsOf(rec)) || `Scenario ${(rec.scenarios || []).length + 1}` };
};
/* THE GUIDED SAVE (the owner's property track, 8 Oct 2026). A scenario
   belongs to a saved property, and an unsaved deal has none: "Save this
   property first" made that the reader's errand — save, then find the
   column's Save again. One action now asks for both names, the property's
   and, where the column the sliders move holds figures a scenario would
   keep, that column's as its scenario; and one Save saves the property,
   then the scenario, the column's moves carried across (labSaveProperty).
   The identity line, the commit card, the next step and the phone's bar
   all start it. Where the column holds nothing a scenario would keep, it
   is the property's save alone, as before. */
/* The column holds what-ifs of the reader's — its moves, or those it was
   copied with — that differ from the deal. Compared figure by figure, not
   as whole deals: it is asked as the column's moves change, beside a drag
   (scenario-lab-verify V6). */
function labScenarioAfterProperty(lab, col) {
  /* Another property's column is never this property's scenario (P6). */
  if (lab.model || !col || col.prop || !(labMoveCount(col) > 0 || labSourceKind(col) === 'variant')) return false;
  const deal = State.deal || {};
  return labMarked(col).some(k => pmCanon(col.work[k]) !== pmCanon(deal[k]));
}
const labGuidedWords = (lab, col) => (labScenarioAfterProperty(lab, col) ? `Save this property and ${col.key} as a scenario` : 'Save this property');
function labGuidedScenario(lab, col) {
  if (!labScenarioAfterProperty(lab, col)) return null;
  const base = pmBare(State.deal);
  return { key: col.key, on: true, value: cpScenarioName(pmDiff(labNext(col), base), base) || 'Scenario 1' };
}
const labGuidedNaming = (lab, at = null) => ({ kind: 'property', at, value: pmNameOf(State.deal), scenario: labGuidedScenario(lab, labActive(lab)) });
/* THE IDENTITY LINE. The name — "Sample deal — not a real listing", or the
   property's — with its place, type and size; Save as the page's one
   primary button; and the regulated claim and the lab's own, whole at
   every width: "Not a valuation" leads, and the reader is never left to
   find it under the figures. */
function labIdentity(P, lab, status) {
  const d = labSubjectInputs(lab);
  const box = el('section', { class: 'lab-identity', 'aria-labelledby': labId(P, 'status') });
  P.els.idAct = labIdentityAct(P, lab);
  /* On a phone the place line carries the two questions' summary and its
     Change (83-property-decision.js): one 44px line, the questions opening
     under the identity line — the answers as the column the sliders move
     holds them, which are the property's own until a move is made. */
  /* With the sliders on another property's column (P6) the summary is that
     column's, and names it. */
  const act = labActive(lab);
  const sum = pqSummaryLine(labAnswerInputs(lab) || d, P.idPrefix);
  if (act?.prop) sum.textContent = `${act.key}: ${sum.textContent}`;
  const meta = !d ? null : P.compact ? el('p', { class: 'lab-id-meta' }, labPlaceLine(d))
    : el('p', { class: 'lab-id-meta has-sum' }, [el('span', { class: 'lab-id-place' }, labPlaceLine(d)), sum, pqChangeButton(P.idPrefix)]);
  box.append(el('div', { class: 'lab-id-top' }, [status, P.els.idAct, meta]));
  P.els.idForm = el('div', { class: 'lab-id-form' }, lab.naming?.at === 'identity' ? [labNameForm(P, lab, labActive(lab))] : []);
  box.append(P.els.idForm);
  box.append(el('p', { class: 'lab-claim lab-id-claim' }, [el('span', { class: 'chip chip-bronze' }, 'Not a valuation'), ' ',
    el('span', {}, `${LAB_NOT_OFFICIAL} ${LAB_CLAIM_SHORT}`)]));
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
  if (lab.model && labAnswersPending(lab)) box.append(el('button', { type: 'button', class: 'btn btn-primary', id,
    onclick: () => labSaveAnswers(P, lab) }, labSaveAnswersWords(lab)));
  /* The sliders on another property's column, moved (P6): Save keeps it as
     a scenario of that property. */
  else if (col.prop && labCanSave(lab, col)) box.append(el('button', { type: 'button', class: 'btn btn-primary', id,
    onclick: () => labNaming(P, lab, labScenarioNaming(lab, labActive(lab), 'identity')) },
    `Save ${col.key} as a scenario${labMarked(col).length ? ' — the moved figures become yours' : ''}`));
  else if (!lab.model) box.append(el('button', { type: 'button', class: 'btn btn-primary', id,
    onclick: () => labNaming(P, lab, labGuidedNaming(lab, 'identity')) }, labGuidedWords(lab, col)));
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
const LAB_TILE_RESTS = {
  safeCashRequired: ['price', 'downPct', 'ratePct', 'tenureYears', 'maintenance'],
  cashflowMonthly: ['price', 'downPct', 'ratePct', 'tenureYears', 'rent', 'vacancyPct', 'maintenance'],
  netYield: ['price', 'rent', 'vacancyPct', 'maintenance'],
  valueLessLoanAtExit: ['price', 'downPct', 'ratePct', 'tenureYears', 'apprecPct', 'holdYears'],
  irrPct: ['price', 'downPct', 'ratePct', 'tenureYears', 'rent', 'vacancyPct', 'maintenance', 'apprecPct', 'holdYears'],
};
/* WHICH THREE, AND WHICH LEAD: the objective's (PROPERTY_OBJECTIVES,
   70-property.js) — the first two the decision (L1), the third its context
   (L2). With none chosen, the three /property has always opened on. The
   objective decides what leads and nothing else: the columns below keep
   their order, and nothing is ranked. */
const labTileSet = (d) => dealObjective(d).tiles.map((key, i) => ({ key, level: i < 2 ? 1 : 2, rests: LAB_TILE_RESTS[key] }));
/* A tile's label where the chain's is a sentence long. */
const LAB_TILE_LABEL = { valueLessLoanAtExit: (d) => `Value less loan, year ${normHoldYears(d?.holdYears)}` };
const LAB_TILE_NOTE = { valueLessLoanAtExit: (m) => (isNum(m.valueLessLoanAtExit) ? 'before selling costs' : null) };
function labTileKind(d, rests) {
  const keys = rests.filter(k => propertyInputApplies(d, k));
  if (keys.some(k => inputIsSeeded(d, k))) return { kind: 'illustrative_default', words: evidenceOf('illustrative_default').label };
  const weakest = keys.filter(k => evidenceDriversFor(d).includes(k)).map(k => evidenceOf(shownEvidence(d, k))).sort((a, b) => a.rank - b.rank)[0];
  return weakest ? { kind: weakest.id, words: weakest.label } : { kind: 'user', words: evidenceOf('user').label };
}
/* A result's kind (D6): the badge of its weakest input on the EVIDENCE
   ladder (KIND_OF_EVIDENCE), linking to /data-sources#kinds, with the
   ladder's own word kept beside it ("Illustrative default", "Yours · you
   supplied") — the evidence id stays the tag's data-kind. `fees`: the
   figure carries fee lines nobody has checked (the cash required's
   unverified lines), so a Placeholder outranks a weaker kind (N6). */
const labTag = (kind, { fees = false } = {}) => {
  const base = kind.kind === 'unavailable' ? 'unavailable' : KIND_OF_EVIDENCE[kind.kind] || 'unavailable';
  const k = fees ? kindFirst([base, 'placeholder']) : base;
  return kindWithFine(k, k === base ? kind.words : 'fee lines unchecked',
    /* No link: on a phone the Lab's every target is 44px, and a 20px pill
       is not one (the definitions are in its title, and on /data-sources). */
    { cls: `lab-tile-kind ls-badge${kind.kind === 'illustrative_default' ? ' is-default' : ''}`, attrs: { 'data-kind': kind.kind }, link: false });
};
/* A deal's result, as cardHead's badge: { kind, fine } — the weakest input
   it rests on (all of the deal's, or `rests`), Placeholder where `fees`
   and the cash carries fee lines nobody has checked, and `also` (the
   model's own step, Modelled; a rulebook figure, Placeholder) in the
   precedence (KIND_ORDER). */
function dealKind(d, m = null, { rests = null, fees = false, also = [] } = {}) {
  if (!d || !(num0(d.price) > 0)) return { kind: 'unavailable', fine: 'Needs a purchase price' };
  const ev = labTileKind(d, rests || evidenceDriversFor(d));
  const base = KIND_OF_EVIDENCE[ev.kind] || 'unavailable';
  const kinds = [base, ...(fees && m?.unconfirmedCost > 0 ? ['placeholder'] : []), ...also];
  const kind = kindFirst(kinds);
  return { kind, fine: kind === base ? ev.words : kind === 'placeholder' ? 'Fee lines unchecked' : KIND_BADGES[kind].word };
}
function labTiles(P, lab) {
  const d = labSubjectInputs(lab);
  const run = d && num0(d.price) > 0 ? pmCompareRun(d) : null;
  const rec = lab.model ? pmFind(lab.model) : null;
  const grid = el('div', { class: 'lab-tiles', role: 'list', 'aria-label': rec ? `“${rec.name}” as saved` : 'The deal on the calculator' });
  for (const t of labTileSet(labAnswerInputs(lab) || d)) {
    const f = LAB_FIGURES.find(x => x.key === t.key);
    const v = run ? f.read(run.m, d) : null;
    const kind = d ? labTileKind(d, t.rests) : { kind: 'unavailable', words: 'Unavailable' };
    /* THE SYSTEM'S METRIC CARD (37-layout-system.js): the cash and the
       month are the decision (L1, the card-metric size); the yield
       qualifies them (L2, medium). */
    const card = lsMetricCard({ label: (LAB_TILE_LABEL[t.key] || f.label)(d), value: LAB_FORMATS[f.fmt](v), badge: labTag(kind, { fees: t.key === 'safeCashRequired' && run?.m?.unconfirmedCost > 0 }), level: t.level,
      sub: run ? ((LAB_TILE_NOTE[t.key] || f.note)(run.m, d) || '') : 'Needs a purchase price', tone: f.neg && isNum(v) && v < 0 ? 'neg' : null,
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
    act = el('button', { type: 'button', class: 'lab-next-go', id, onclick: () => labNaming(P, lab, labGuidedNaming(lab, 'identity')) }, 'Save this property');
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
  /* "Not saved" and "Saved" are the property's state, not a figure's kind:
     they keep the plain tag. */
  const tag = EVIDENCE.some(e => e.id === kind.kind) ? labTag(kind)
    : el('span', { class: 'lab-tag lab-tile-kind ls-badge', 'data-kind': kind.kind }, kind.words);
  const card = lsActionCard({ title: 'Next step', line: sub, cta: act, badge: tag, cls: 'lab-tile lab-tile-next',
    attrs: { role: 'listitem', 'data-tile': 'next', 'data-kind': kind.kind } });
  card.querySelector('.ls-card-hd').classList.add('lab-tile-hd');
  card.querySelector('.ls-card-label').classList.add('lab-tile-label');
  card.querySelector('.ls-card-act').classList.add('lab-tile-val', 'lab-next-what');
  card.querySelector('.ls-card-sub').classList.add('lab-tile-sub');
  return card;
}

/* ------------------------------------------- the questions (P1) and the price (P2) */
/* THE TWO QUESTIONS AND THE OBJECTIVE (83-property-decision.js), as the
   columns hold them: an answer given here is a move of every column, so
   they read from the column the sliders move. Its summary is the identity
   line's on a phone (labIdentity), so the block carries none of its own. */
const labAnswerInputs = (lab) => labActive(lab)?.work || labSubjectInputs(lab);
function labQuestions(P, lab) {
  const d = labAnswerInputs(lab);
  if (!d) return null;
  const box = propertyQuestions({ d, prefix: P.idPrefix, summary: !!P.compact, answer: (k, v) => labAnswer(P, lab, k, v) });
  /* The sliders on another property's column (P6): the answers are that
     property's, and said so above them. */
  const col = labActive(lab);
  if (col?.prop) box.querySelector('.pq-body')?.prepend(el('p', { class: 'pq-note pq-for', 'data-note': 'for' }, `Answers for ${col.key} — ${col.name}: they move ${col.key}’s property’s columns only, a what-if until saved.`));
  return box;
}
/* SAVING IS THE ONLY WRITE (the owner's decision, 9 Oct 2026). What is
   bought, how, the objective and the price's target are answers about the
   property, so one answer moves every column at once — A, B and C stay one
   property — and the figures follow at the next paint. Like any move it is
   kept in this tab's memory and written nowhere: not the calculator's deal,
   not a saved property, not the address. It is written when the reader
   saves: the guided Save of an unsaved deal saves the property with its
   answers (labSaveProperty); a saved property's Save beside its name
   writes them to it (labSaveAnswers); and a scenario saved, or a column
   opened in the calculator, carries them as it carries its other moves.
   lab.answers holds what was answered, for those saves. */
/* ONE PROPERTY'S ANSWERS STAY ITS OWN (P6): an answer moves the columns of
   the property the sliders' column is of — the subject's A, B and C, or
   another property's column and its copies — and no other property's.
   Only the subject's are kept in lab.answers, for its Save; another
   property's are moves of its columns, kept by saving that column. */
function labAnswer(P, lab, k, v) {
  const write = pqWriter(k, v, { touch: false });
  const prop = labPropOf(labActive(lab));
  let changed = false;
  for (const col of lab.cols) {
    if (labPropOf(col) !== prop) continue;
    const next = pmCopy(col.work);
    if (!write(next)) continue;
    for (const key of new Set([...Object.keys(next), ...Object.keys(col.work)])) {
      if (PM_POINTERS.includes(key) || pmCanon(next[key]) === pmCanon(col.work[key])) continue;
      labWrite(col, key, next[key]);
      changed = true;
    }
  }
  if (!changed) return;
  if (prop === 'own') lab.answers = { ...(lab.answers || {}), ...(isRecord(k) ? k : { [k]: v }) };
  const focus = document.activeElement?.id || null;
  for (const Q of [...LAB_PANELS]) if (Q.key === lab.key && Q.node.isConnected) labDraw(Q, focus);
  labAfterStructure(P, lab, { address: false });
}
/* The answers given here, as a writer of a deal — the class marked as the
   reader's, as a commit marks a moved figure. */
const labAnswersWriter = (lab) => pqWriter(lab.answers || {}, null);
/* Whether the answers would change what is saved: the property as saved,
   or the deal on the calculator. */
function labAnswersPending(lab) {
  if (!lab.answers || !Object.keys(lab.answers).length) return false;
  const d = labSubjectInputs(lab);
  if (!d) return false;
  const copy = pmCopy(d);
  return labAnswersWriter(lab)(copy) && pmCanon(pmBare(copy)) !== pmCanon(pmBare(d));
}
const labSaveAnswersWords = (lab) => `Save what and how you are buying to “${pmFind(lab.model)?.name || 'this property'}”`;
/* A saved property's answers, written to it on Save — and to the
   calculator's copy of it where that is the one open there, so it does not
   read as changed. Its columns read the property again, the answers no
   longer moves of theirs; a lab variant, which reads nothing, takes them on
   its base as the property did (labFact). */
function labSaveAnswers(P, lab) {
  const rec = lab.model ? pmFind(lab.model) : null;
  if (!rec) return false;
  const write = labAnswersWriter(lab);
  if (!pmAnswerRecord(rec.id, write)) return false;
  if (State.deal?.modelId === rec.id && write(State.deal)) saveDeal();
  for (const col of lab.cols) if (col.source === 'variant' && !col.prop) labFact(col, write);
  lab.answers = {};
  if (!labRebase(lab)) return false;
  for (const Q of [...LAB_PANELS]) if (Q.key === lab.key && Q.node.isConnected) labDraw(Q, [labId(Q, 'id-save'), labId(Q, 'next-go')]);
  labAfterStructure(P, lab, { address: true });
  toast(`Saved what and how you are buying to “${rec.name}”: ${pqSummaryText(pmInputsOf(pmFind(rec.id)))}.`);
  return true;
}
function labFact(col, write) {
  const base = pmCopy(col.baseInputs), work = pmCopy(col.work);
  write(base); write(work);
  const moves = {};
  for (const k of Object.keys(col.moves)) if (pmCanon(work[k]) !== pmCanon(base[k])) moves[k] = work[k];
  Object.assign(col, { baseInputs: base, work, moves, cur: null, ref: labRun(base), ver: (col.ver || 0) + 1 });
}

/* THE PRICE, AGAINST THE READER'S EVIDENCE (P2): the price gap and the
   price that makes this work, for the column the sliders move — a what-if
   moved in B is set against the same comparables and the same target. The
   inputs it reads are the property's (the asking price, the comparables
   named, the target), entered in the calculator and, for the target, here. */
function labPriceSection(P, lab) {
  const card = el('section', { class: 'card ls-section lab-pe', id: labId(P, 'pe'), 'aria-labelledby': labId(P, 'pe-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'pe-h') }, 'The price, against your evidence'));
  const route = el('p', { class: 'metaline pe-route', id: labId(P, 'pe-route') });
  const cards = el('div', { class: 'pe-cards-wrap', id: labId(P, 'pe-cards') });
  const d = labAnswerInputs(lab);
  const target = d ? priceTargetControls({ d, prefix: P.idPrefix, answer: (k, v) => labAnswer(P, lab, k, v) }) : null;
  const tryBox = el('div', { class: 'pe-try', id: labId(P, 'pe-try') });
  /* THE EVIDENCE, HERE (the guided evidence flow, 9 Oct 2026): the asking
     price and the comparables from the reader's register, named in the Lab
     as answers of the property — every column, a what-if until Save. */
  const askId = labId(P, 'pe-asking');
  const ask = d ? el('div', { class: 'pe-ask' }, [
    el('label', { for: askId, class: 'pe-ask-label' }, 'Asking price (RM)'),
    el('input', { class: 'input input-inline pe-ask-input', id: askId, type: 'number', inputmode: 'decimal', min: '0', step: '1000',
      value: isNum(d.askingPrice) ? String(d.askingPrice) : '', placeholder: 'not entered',
      onchange: (e) => { const raw = String(e.target.value).trim(); labAnswer(P, lab, 'askingPrice', raw === '' ? null : raw); } }),
  ]) : null;
  const pick = d ? comparablesPick({ d, prefix: P.idPrefix, legend: 'Comparables this price is set against — from your register', toggle: (ids) => labAnswer(P, lab, 'comparableIds', ids) }) : null;
  card.append(route, cards, target, tryBox, ask, pick);
  P.els.pe = { card, route, cards, tryBox, sig: null };
  return card;
}
/* Its figures, at a paint. The gap is arithmetic on a few records, worked
   out at once; the solve is twenty-odd runs of the model, so a drag waits
   for the slider to rest (140ms) and the figure shown until then is the
   last one solved, for the figures it names. The first drawing solves at
   once, so the served page carries it. */
const LAB_PE_WAIT = 140;
function labPricePaint(P, lab, { initial = false } = {}) {
  const pe = P.els?.pe;
  if (!pe || !pe.card.isConnected && !initial) return;
  const col = labActive(lab), d = col.work;
  const key = pmRunKey(d);
  if (!P.peSolve || P.peSolve.key !== key) {
    if (initial || !P.peSolve) P.peSolve = { key, s: solveDealPrice(d) };
    else {
      clearTimeout(P.peTimer);
      P.peTimer = setTimeout(() => {
        const L = LAB[P.key];
        if (!L || !P.node.isConnected) return;
        const c = labActive(L);
        P.peSolve = { key: pmRunKey(c.work), s: solveDealPrice(c.work) };
        labPricePaint(P, L);
      }, LAB_PE_WAIT);
    }
  }
  const s = P.peSolve.s, g = priceGap(d);
  const routeNote = PROPERTY_ROUTES[dealRoute(d)].coming || '';
  const sig = JSON.stringify([col.key, g.status, g.value, g.asking, g.price, g.comps.map(c => [c.id, c.implied]), s, num0(d.price), routeNote]);
  if (pe.sig === sig) return;
  pe.sig = sig;
  labText(pe.route, routeNote);
  pe.route.hidden = !routeNote;
  /* Where the missing figures are entered: the calculator, where it holds
     the property this column is of (P6: another property's column is
     entered as that property). */
  const onCalc = col.prop ? !!labColRecId(lab, col) && State.deal?.modelId === labColRecId(lab, col) : !lab.model || State.deal?.modelId === lab.model;
  pe.cards.replaceChildren(priceEvidenceCards({ d, g, s, prefix: P.idPrefix,
    gapWhy: () => lsOpenEvidence(pe.gapEv), solveWhy: () => lsOpenEvidence(pe.solveEv),
    enter: onCalc ? '/property/calculator#d-askingPrice' : '/property/models',
    setTarget: () => { const r = document.getElementById(`${P.idPrefix}-q-target-monthly`); if (r) { r.closest('.pe-target')?.scrollIntoView({ block: 'center' }); r.focus({ preventScroll: true }); } } }));
  /* The solved price, tried in the column the sliders move — as a move,
     a what-if like any other, kept in this tab until saved. */
  const solved = s.status === 'solved' && Math.round(num0(d.price)) !== s.price;
  pe.tryBox.replaceChildren(...(solved ? [el('button', { type: 'button', class: 'btn btn-ghost btn-sm pe-try-btn', id: labId(P, 'pe-try-btn'),
    onclick: () => {
      const L = LAB[P.key], c = labActive(L);
      labWrite(c, 'price', s.price);
      labSchedule();
      liveSay(`${c.key}’s price set to ${labMoney(s.price)}, a move kept in this tab until saved.`);
    } }, `Try ${labMoney(s.price)} in ${col.key}`)] : []));
  if (pe.gapText) labText(pe.gapText, priceGapFormula(g));
  if (pe.solveText) labText(pe.solveText, priceSolveFormula(s, d));
}

/* THE AUCTION RISK MODE (the decision layer, P3; 83-property-decision.js),
   in the price section's place once Auction is answered. A what-if until
   Save, as every answer here is: what is entered — the Proclamation's
   terms, the comparables, the estimates, the checks ticked — is a move of
   every column (labAnswer), A, B and C staying one property, and is
   written only by Save. The winning bid is the Price slider: the column it
   moves is the one worked through. The inputs and the checklist are drawn
   with the page; the figures follow each paint (labAuctionPaint). */
function labAuctionSection(P, lab) {
  const d = labAnswerInputs(lab);
  const card = el('section', { class: 'card ls-section lab-au au', id: labId(P, 'au'), 'aria-labelledby': labId(P, 'au-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'au-h') }, 'The auction, worked through'));
  card.append(el('p', { class: 'metaline au-route' }, `${AUCTION_LEAD} A what-if of every column until you save it.`));
  const figs = el('div', { class: 'au-figs', id: labId(P, 'au-figs') });
  card.append(figs);
  if (d) {
    const answer = (k, v) => labAnswer(P, lab, k, v);
    const named = priceGap(d).comps.length;
    card.append(auctionInputs({ d, prefix: P.idPrefix, answer,
      extra: { market: el('div', {}, [
        el('p', { class: 'au-note' }, named ? `${named} comparable${named === 1 ? '' : 's'} named from your register count${named === 1 ? 's' : ''} as well, with ${named === 1 ? 'its' : 'their'} source and date.` : 'Transacted prices from your register, named below, count as well.'),
        comparablesPick({ d, prefix: P.idPrefix, legend: 'Comparables from your register', toggle: (ids) => answer('comparableIds', ids) })]) } }));
    card.append(auctionChecklist({ d, prefix: P.idPrefix, answer }));
  }
  P.els.au = { card, figs, sig: null };
  return card;
}
function labAuctionPaint(P, lab) {
  const au = P.els?.au;
  if (!au) return;
  const col = labActive(lab), d = col.work;
  const a = auctionModel(d, col.cur?.m || dealModel(d));
  const sig = JSON.stringify([col.key, a.steps.map(s => [s.id, s.amount, s.kind]), a.forfeiture, a.checksOpen, a.trueDiscount]);
  if (au.sig === sig) return;
  au.sig = sig;
  au.figs.replaceChildren(auctionResults({ a, prefix: P.idPrefix, why: { wf: () => lsOpenEvidence(au.wfEv), fx: () => lsOpenEvidence(au.fxEv) },
    toChecklist: () => lsGoTo(document.getElementById(labId(P, 'au-checks')), document.querySelector(`#${labId(P, 'au-checks')} input:not(:checked)`)) }));
  if (au.wfText) labText(au.wfText, auctionWaterfallFormula(a));
  if (au.fxText) labText(au.fxText, auctionForfeitureFormula(a));
}

/* THE DEVELOPER PREMIUM MODEL (the decision layer, P4; 83-property-
   decision.js), in the price section's place once New development is
   answered. A what-if until Save, as every answer here is: the comparable,
   the dates, the schedule and the rebates entered are a move of every
   column (labAnswer), A, B and C staying one property, written only by
   Save. The SPA price is the Price slider, and the rent at completion the
   Rent slider: the column they move is the one worked through. The inputs
   are drawn with the page; the figures follow each paint (labNewDevPaint),
   the rent that would cover the premium — runs of the model — once a drag
   rests, as the solved price does (LAB_PE_WAIT). */
function labNewDevSection(P, lab) {
  const d = labAnswerInputs(lab);
  const card = el('section', { class: 'card ls-section lab-nd au nd', id: labId(P, 'nd'), 'aria-labelledby': labId(P, 'nd-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'nd-h') }, 'The new development, worked through'));
  card.append(el('p', { class: 'metaline au-route' }, `${ND_LEAD} A what-if of every column until you save it.`));
  const figs = el('div', { class: 'au-figs', id: labId(P, 'nd-figs') });
  card.append(figs);
  if (d) {
    const answer = (k, v) => labAnswer(P, lab, k, v);
    card.append(ndInputs({ d, prefix: P.idPrefix, answer,
      extra: { comp: comparablesPick({ d, prefix: P.idPrefix, legend: 'Completed comparables from your register', toggle: (ids) => answer('comparableIds', ids) }) },
      where: { rent: 'The Rent slider.', vacancy: 'Set in the calculator.', furnishing: 'The Renovation slider.' } }));
  }
  P.els.nd = { card, figs, sig: null };
  return card;
}
function labNewDevPaint(P, lab, { initial = false } = {}) {
  const nd = P.els?.nd;
  if (!nd) return;
  const col = labActive(lab), d = col.work;
  const m = col.cur?.m || dealModel(d);
  const key = pmRunKey(d);
  if (!P.ndSolve || P.ndSolve.key !== key) {
    if (initial || !P.ndSolve) P.ndSolve = { key, n: ndModelOf(d, m) };
    else {
      clearTimeout(P.ndTimer);
      P.ndTimer = setTimeout(() => {
        const L = LAB[P.key];
        if (!L || !P.node.isConnected) return;
        const c = labActive(L);
        P.ndSolve = { key: pmRunKey(c.work), n: ndModelOf(c.work, c.cur?.m || dealModel(c.work)) };
        labNewDevPaint(P, L);
      }, LAB_PE_WAIT);
    }
  }
  /* Every figure but the solved rent at once; the rent the last solved,
     for the figures it names, until the drag rests. */
  const n = ndModelOf(d, m, { solve: false });
  if (P.ndSolve.key === key) n.rentNeeded = P.ndSolve.n.rentNeeded;
  const sig = JSON.stringify([col.key, n.premium, n.paid, n.comp, n.cash, n.build.status, n.build.idc, n.build.missing, n.vpMonthly, n.exits.map(e => e.value), n.rentNeeded, n.growthNeeded, n.premiumKind, n.rentKind]);
  if (nd.sig === sig) return;
  nd.sig = sig;
  nd.figs.replaceChildren(ndResults({ n, d, prefix: P.idPrefix,
    why: { premium: () => lsOpenEvidence(nd.premiumEv), idc: () => lsOpenEvidence(nd.idcEv), exit: () => lsOpenEvidence(nd.exitEv), needed: () => lsOpenEvidence(nd.neededEv) } }));
  if (nd.premiumText) labText(nd.premiumText, ndPremiumFormula(n));
  if (nd.idcText) labText(nd.idcText, ndConstructionFormula(n));
  if (nd.exitText) labText(nd.exitText, ndExitFormula(n));
  if (nd.neededText) labText(nd.neededText, ndNeededFormula(n));
}

/* THE COMMERCIAL MODELS (the decision layer, P5; 83-property-decision.js),
   after the price section once Commercial is answered. A what-if until
   Save, as every answer here is: the tenancy, its contract rent, the
   asking rent, the achieved rents named, the lease and the unit are a move
   of every column (labAnswer), A, B and C staying one property, written
   only by Save. The model rent is the Rent slider, and the price the Price
   slider: the column they move is the one worked through. The inputs are
   drawn with the page; the figures follow each paint (labCommercialPaint). */
function labCommercialSection(P, lab) {
  const d = labAnswerInputs(lab);
  const card = el('section', { class: 'card ls-section lab-cm au cm', id: labId(P, 'cm'), 'aria-labelledby': labId(P, 'cm-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'cm-h') }, 'The commercial rents, worked through'));
  card.append(el('p', { class: 'metaline au-route' }, `${CM_LEAD} A what-if of every column until you save it.`));
  const figs = el('div', { class: 'au-figs', id: labId(P, 'cm-figs') });
  card.append(figs);
  if (d) {
    const answer = (k, v) => labAnswer(P, lab, k, v);
    card.append(cmInputs({ d, prefix: P.idPrefix, answer, fold: true,
      extra: { rents: cmRentPick({ d, prefix: P.idPrefix, legend: 'Achieved rents from your register', toggle: (ids) => answer('rentComparableIds', ids) }) },
      where: { model: 'The Rent slider.' } }));
  }
  P.els.cm = { card, figs, sig: null };
  return card;
}
function labCommercialPaint(P, lab) {
  const cm = P.els?.cm;
  if (!cm) return;
  const col = labActive(lab), d = col.work;
  const c = commercialModel(d, col.cur?.m || dealModel(d));
  const sig = JSON.stringify([col.key, c.rents.map(r => [r.value, r.kind]), c.observed, c.sustain, c.yields, c.lease.scenarios, c.lease.missing, c.lease.reserveKind, c.lease.start, c.lease.burn, c.lease.fitOut]);
  if (cm.sig === sig) return;
  cm.sig = sig;
  cm.figs.replaceChildren(cmResults({ c, d, prefix: P.idPrefix,
    why: { rents: () => lsOpenEvidence(cm.rentsEv), sustain: () => lsOpenEvidence(cm.sustainEv), yields: () => lsOpenEvidence(cm.yieldsEv), lease: () => lsOpenEvidence(cm.leaseEv) },
    toRents: () => lsGoTo(document.getElementById(labId(P, 'cm-rent-comps')), document.querySelector(`#${labId(P, 'cm-rent-comps')} input, #${labId(P, 'cm-register')}`)) }));
  if (cm.rentsText) labText(cm.rentsText, cmRentsFormula(c));
  if (cm.sustainText) labText(cm.sustainText, cmSustainFormula(c));
  if (cm.yieldsText) labText(cm.yieldsText, cmYieldFormula(c));
  if (cm.leaseText) labText(cm.leaseText, cmLeaseDownFormula(c));
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
  if (lab.model && labAnswersPending(lab)) return { aria: labSaveAnswersWords(lab), run: () => labSaveAnswers(P, lab) };
  if (col.prop && labCanSave(lab, col)) return { aria: `Save ${col.key} as a scenario`, run: () => labNaming(P, lab, labScenarioNaming(lab, col, 'identity')) };
  /* The same guided save as the identity line's: the property's name and,
     where the column holds figures a scenario would keep, its own. */
  if (!lab.model) return { aria: labGuidedWords(lab, col), run: () => labNaming(P, lab, labGuidedNaming(lab, 'identity')) };
  if (labCanSave(lab, col)) return { aria: `Save ${col.key} as a scenario`, run: () => labNaming(P, lab, labScenarioNaming(lab, col, 'identity')) };
  return { aria: 'Saved in this browser', disabled: true, said: `Saved in this browser — move a figure to save ${col.key} as a scenario.` };
}
function labBarActions() {
  const s = labBarSave();
  return [
    { id: 'ls-act-analyse', label: 'Analyse', icon: 'chart', path: '/property/calculator', aria: 'Analyse this property in the calculator' },
    { id: 'ls-act-compare', label: 'Compare', icon: 'scale', aria: 'Compare A, B and C', onclick: () => {
      const P = labPagePanel();
      /* Columns of other properties: their comparison across routes, at
         its lens (P6); else A, B and C side by side. */
      const r = P && (P.node.querySelector(`input[name="${labId(P, 'lens')}"]:checked`) || P.node.querySelector(`input[name="${labId(P, 'by')}"]:checked`));
      if (r) lsGoTo(r.closest('.lab-xr, .lab-cmp-card'), r);
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
     opens, straight after the knob's tags, closed at first — AND AT EVERY
     WIDTH since the 9 Oct audit (#5): a span's basis and a knob's notes are
     its method, the evidence of the slider, one tap away on a desk as on a
     phone. Nothing is reworded or dropped: the
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
     slider moves — at every width now that the whole note is in "About"
     at every width (the 9 Oct audit, #5). */
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
  /* Where every figure comes from — the page's lede said it until the 9 Oct
     audit (#5) asked the lede to be a label's length. */
  const model = el('p', { class: 'metaline lab-from-model' }, 'Every figure here is worked out by the calculator’s own model, on each column’s figures.');
  const rest = lsEvidenceSection({ id: labId(P, 'ev-rests'), summary: 'What these figures rest on', body: [model, movedBy, ctx, rests] });
  const formula = el('p', { class: 'lab-formula', id: labId(P, 'ev-formula-text') }, '');
  const fhead = el('p', { class: 'ls-ev-k', id: labId(P, 'ev-formula-k') }, '');
  const how = lsEvidenceSection({ id: labId(P, 'ev-formula'), cls: 'ls-ev-wide', summary: 'How a figure is worked out', body: [fhead, formula] });
  how.addEventListener('toggle', () => { if (how.open) labPaintPanel(P); });
  P.els.grade.why = why;
  P.els.grade.whyBody = why.querySelector('.lab-grade-why-body');
  P.els.context = ctx; P.els.rests = rests; P.els.movedBy = movedBy;
  P.els.how = { node: how, head: fhead, formula };
  /* THE CASH REQUIRED BY KIND (the fee rulebook 1.1.0; the owner's decision
     of 9 Oct 2026): statutory charges, scale fees, quotations, optional
     products, estimates and the buyer's own money, with what rests on
     estimates — and mortgage protection, optional and out until included,
     included here as an answer of the property (a move of every column,
     written only by Save), as the questions are. */
  const ad = labAnswerInputs(lab);
  const feeText = el('p', { class: 'lab-formula lab-fee-split', id: labId(P, 'ev-fees-text') }, '');
  const quoted = ad && isNum(ad.mrtaPremium) && ad.mrtaPremium > 0;
  const included = !!ad && !quoted && ad.mortgageProtection === 'included';
  const mrtaBtn = ad && !quoted ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm lab-mrta-btn', id: labId(P, 'mrta'), 'aria-pressed': included ? 'true' : 'false',
    onclick: () => labAnswer(P, lab, 'mortgageProtection', included ? null : 'included') },
    included ? 'Leave mortgage protection out' : `Include mortgage protection — ${labMoney(FEE_TABLE.lines.mortgageProtection.fixed)} estimate`) : null;
  const mrtaSay = el('p', { class: 'metaline lab-mrta-say' }, quoted
    ? `Mortgage protection: the ${labMoney(ad.mrtaPremium)} premium you were quoted is in the cash required, marked Quoted.`
    : included ? `Mortgage protection is optional; included, it is carried at the rulebook’s ${labMoney(FEE_TABLE.lines.mortgageProtection.fixed)} estimate until you enter a quote in the calculator — a what-if until you save.`
      : 'Optional: mortgage protection — not included in the cash required. Include it here, or enter the premium you were quoted in the calculator.');
  const fees = lsEvidenceSection({ id: labId(P, 'ev-fees'), summary: 'What the cash required is made of', body: [feeText, mrtaSay, mrtaBtn].filter(Boolean) });
  fees.addEventListener('toggle', () => { if (fees.open) labPaintPanel(P); });
  P.els.fees = { node: fees, text: feeText };
  /* How the price gap and the solved price are worked out (P2) — above
     "How a figure is worked out", which a row pressed from 1440px writes
     into and so grows: below it, these moved with every row pressed
     (coverage-frames). */
  const pe = [];
  if (P.els.pe) {
    const gapText = el('p', { class: 'lab-formula', id: labId(P, 'ev-gap-text') }, '');
    const solveText = el('p', { class: 'lab-formula', id: labId(P, 'ev-solve-text') }, '');
    P.els.pe.gapEv = lsEvidenceSection({ id: labId(P, 'ev-gap'), summary: 'How the price gap is worked out', body: [gapText] });
    P.els.pe.solveEv = lsEvidenceSection({ id: labId(P, 'ev-solve'), summary: 'How the price is solved', body: [solveText] });
    P.els.pe.gapText = gapText; P.els.pe.solveText = solveText;
    pe.push(P.els.pe.gapEv, P.els.pe.solveEv);
  }
  /* The auction's working and the checklist's source (P3), in the same
     place, for the same reason. */
  if (P.els.au) {
    const wfText = el('p', { class: 'lab-formula', id: labId(P, 'ev-au-wf-text') }, '');
    const fxText = el('p', { class: 'lab-formula', id: labId(P, 'ev-au-fx-text') }, '');
    P.els.au.wfEv = lsEvidenceSection({ id: labId(P, 'ev-au-wf'), summary: 'How the waterfall is worked out', body: [wfText] });
    P.els.au.fxEv = lsEvidenceSection({ id: labId(P, 'ev-au-fx'), summary: 'How the forfeiture exposure is worked out', body: [fxText] });
    P.els.au.srcEv = lsEvidenceSection({ id: labId(P, 'ev-au-src'), summary: 'Where the checklist comes from', body: [auctionGuidanceList()] });
    P.els.au.wfText = wfText; P.els.au.fxText = fxText;
    pe.push(P.els.au.wfEv, P.els.au.fxEv, P.els.au.srcEv);
  }
  /* The new development's working and its sources (P4), there too. */
  if (P.els.nd) {
    const nd = P.els.nd, sec = (k, summary) => { const t = el('p', { class: 'lab-formula', id: labId(P, `ev-nd-${k}-text`) }, ''); nd[`${k}Text`] = t; nd[`${k}Ev`] = lsEvidenceSection({ id: labId(P, `ev-nd-${k}`), summary, body: [t] }); return nd[`${k}Ev`]; };
    pe.push(sec('premium', 'How the premium is worked out'), sec('idc', 'How construction interest is worked out'), sec('exit', 'How the exit values are worked out'),
      sec('needed', 'How the rent and growth needed are found'));
    nd.srcEv = lsEvidenceSection({ id: labId(P, 'ev-nd-src'), summary: 'Where the template comes from', body: [ndSourcesList()] });
    pe.push(nd.srcEv);
  }
  /* The commercial working (P5), there too. */
  if (P.els.cm) {
    const cm = P.els.cm, sec = (k, summary) => { const t = el('p', { class: 'lab-formula', id: labId(P, `ev-cm-${k}-text`) }, ''); cm[`${k}Text`] = t; cm[`${k}Ev`] = lsEvidenceSection({ id: labId(P, `ev-cm-${k}`), summary, body: [t] }); return cm[`${k}Ev`]; };
    pe.push(sec('rents', 'How the four rents are kept apart'), sec('sustain', 'How rent sustainability is worked out'), sec('yields', 'How the yields are worked out'),
      sec('lease', 'How the lease-down is worked out'));
  }
  return lsEvidence({ id: labId(P, 'evidence'), title: 'Evidence', sections: [why, rest, fees, ...pe, how] });
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
    sub: `${q.slice(0, 3).map(x => x.label.toLowerCase()).join(', ')}${q.length > 3 ? ` and ${q.length - 3} more` : ''}.`,
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
  const cross = labCrossRoute(lab);
  const row = (c) => ({ key: c.key, name: cross ? labXrName(lab, c) : c.name, chip: LAB_SOURCE_CHIP[labSourceKind(c)], active: c.key === lab.active, m: c.cur?.m || null, g: c.cur?.g || null, d: c.work });
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
        `${labMoney(r.m.unconfirmedCost)} on unverified or unknown fee lines`].filter(Boolean).join(' · '),
      table: { form: 'stacked', title: 'Cash required: to complete, renovation and set-up, and the reserve' } }));
    vm.words.push('Each bar, from nought: what completion takes, then renovation and set-up (the stronger shade), then the reserve (outlined).');
    vm.twin = { caption: 'Show every figure in this view', headers: ['Column', 'To complete', 'Renovation and set-up', 'Reserve', 'Cash required', 'On unverified or unknown fee lines'],
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
    /* What is compared and in which order is said to the ear; the eye has
       the switch and the rows A, B, C (the 9 Oct audit, #5). */
    table.append(el('caption', { class: ti === 0 ? 'lab-cmp-cap' : 'lab-cmp-cap lab-cmp-sub' }, ti === 0 ? [el('span', { class: 'sr-only' }, `${vm.caption} `), `${t.title}.`] : `${t.title}.`));
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
  /* What B and C can show besides (P6): another of the reader's saved
     properties, or the sample — each named with its route and asset. */
  const others = labOtherSources(lab);
  const list = el('ul', { class: 'lab-cols' });
  for (const c of lab.cols) {
    const li = el('li', { class: `lab-col-row lab-c-${c.key}${c.key === lab.active ? ' is-active' : ''}` });
    li.append(el('span', { class: 'lab-col-name' }, [labLetter(c.key), el('strong', {}, ` ${c.key} — ${c.name}`), ' ', el('span', { class: 'lab-cmp-chip' }, LAB_SOURCE_CHIP[labSourceKind(c)]),
      labMoveCount(c) ? el('span', { class: 'lab-tag lab-tag-whatif' }, `${labMoveCount(c)} move${labMoveCount(c) === 1 ? '' : 's'} not saved`) : null]));
    const acts = el('span', { class: 'lab-col-acts' });
    /* Column A is the property opened: only its own figures. */
    const own = offered.map(o => [o.id, o.id === 'base' ? 'As saved' : o.short]);
    const more = c.key === 'A' ? [] : others.map(o => [o.id, o.label]);
    if (own.length || more.length) {
      const sid = labId(P, `shows-${c.key}`);
      const sel = el('select', { class: 'select select-sm', id: sid, 'aria-label': `What column ${c.key} shows`, onchange: (e) => {
        const v = e.target.value;
        const o = offered.find(x => x.id === v);
        const made = o ? labCol(c.key, o.id === 'base' ? 'base' : o.id === 'current' ? 'current' : `sc:${o.id}`, o.id === 'base' ? 'As saved' : o.short, o.inputs)
          : labForeignCol(c.key, v, lab.model);
        if (!made) return;
        const i = lab.cols.indexOf(c);
        lab.cols[i] = made;
        if (rec) pmCompareSelect(rec.id, labOwnIds(lab));
        labDraw(P, sid);
        labAfterStructure(P, lab, { address: true, say: `Column ${c.key} shows ${lab.cols[i].name}${made.prop ? `, ${labRouteAsset(made.work)}` : ''}. Order ${lab.cols.map(x => x.key).join(', ')}.` });
      } });
      const now = c.prop ? c.source : c.source === 'base' ? 'base' : c.source === 'current' ? 'current' : String(c.source).startsWith('sc:') ? c.source.slice(3) : '';
      if (!now || (c.prop && !more.some(([id]) => id === now))) sel.append(el('option', { value: '', selected: '' }, `${c.name} (not saved)`));
      const opts = (xs) => xs.map(([id, label]) => el('option', { value: id, selected: id === now ? '' : null }, label));
      if (own.length && more.length) sel.append(el('optgroup', { label: 'This property' }, opts(own)), el('optgroup', { label: 'Another property' }, opts(more)));
      else sel.append(...opts(own.length ? own : more));
      acts.append(el('label', { class: 'sr-only', for: sid }, `What column ${c.key} shows`), sel);
    }
    if (labMoveCount(c)) acts.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: labId(P, `clear-${c.key}`),
      onclick: () => labClear(P, lab, c) }, `Clear ${c.key}’s moves`));
    if (c.key !== 'A') acts.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: labId(P, `remove-${c.key}`),
      onclick: () => {
        lab.cols = lab.cols.filter(x => x !== c);
        if (lab.active === c.key) lab.active = lab.cols[lab.cols.length - 1].key;
        if (rec && c.source !== 'variant') pmCompareSelect(rec.id, labOwnIds(lab));
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
    /* A column is added where its letter falls: A, B, C stay in their
       order whatever is in them. */
    const put = (c, said) => {
      lab.cols.push(c);
      lab.cols.sort((a, b) => LAB_LETTERS.indexOf(a.key) - LAB_LETTERS.indexOf(b.key));
      lab.active = c.key;
      labDraw(P, labId(P, `col-${c.key}`));
      labAfterStructure(P, lab, { address: !!c.prop, say: `${said} Sliders move ${c.key}. Order ${lab.cols.map(x => x.key).join(', ')}.` });
    };
    /* The copy carries the moves it was made with, so a commit of it marks
       them as the reader's as a commit of the column it copied would — and
       the property it is of. */
    const copy = () => put(labCol(free, 'variant', `Copy of ${act.key}`, act.work, { of: act.key, prop: act.prop, inherited: pmCopy({ ...(act.inherited || {}), ...act.moves }) }),
      `Column ${free} added, a copy of ${act.key}.`);
    if (!others.length) card.append(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: labId(P, 'add'), onclick: copy }, `Add a column — a copy of ${act.key}`));
    else {
      /* Or another property's (P6): chosen, then added. */
      const fid = labId(P, 'add-from');
      const from = el('select', { class: 'select select-sm', id: fid },
        [el('option', { value: '' }, `A copy of ${act.key}`), el('optgroup', { label: 'Another property' }, others.map(o => el('option', { value: o.id }, o.label)))]);
      card.append(el('div', { class: 'lab-add' }, [el('label', { class: 'lab-add-label', for: fid }, `Add column ${free} from`), from,
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: labId(P, 'add'), onclick: () => {
          if (!from.value) { copy(); return; }
          const c = labForeignCol(free, from.value, lab.model);
          if (c) put(c, `Column ${free} added: ${c.name}, ${labRouteAsset(c.work)}.`);
        } }, `Add ${free}`)]));
    }
  }
  const saved = labComparisonsBlock(P, lab);
  if (saved) card.append(saved);
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
  /* The property the column is of (P6): the subject's, another saved one's,
     or none — the calculator's unsaved deal, or the sample. */
  const rec = labColRec(lab, col);
  const sample = col.prop === 'sample';
  const n = labMoveCount(col);
  const kind = labSourceKind(col);
  const scOf = kind === 'sc' || (kind === 'pm' && !!labPmRef(col.source)?.sc);
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
    if (scOf && n) acts.append(el('button', { type: 'button', class: 'btn btn-ghost', id: labId(P, 'update'), onclick: () => labUpdateScenario(P, lab) },
      `Update scenario “${col.name}”${yours}`));
  } else if (!sample) {
    /* The guided save: one action, both names (labGuidedNaming). */
    acts.append(el('button', { type: 'button', class: `btn ${keepCls}`, id: labId(P, 'save-first'),
      onclick: () => labNaming(P, lab, labGuidedNaming(lab)) }, labGuidedWords(lab, col)));
  }
  acts.append(el('button', { type: 'button', class: 'btn btn-ghost', id: labId(P, 'open'), onclick: () => labOpenInCalculator(P, lab) },
    `Open ${col.key} in the calculator${yours}`));
  acts.append(el('button', { type: 'button', class: 'btn btn-quiet', id: labId(P, 'clear'), disabled: n ? null : '', onclick: () => labClear(P, lab, col) },
    `Clear ${col.key}’s moves`));
  card.append(acts);
  /* The name is asked for where its Save was pressed: here, or under the
     identity line (labIdentity). */
  if (lab.naming && lab.naming.at !== 'identity') card.append(labNameForm(P, lab, col));
  /* ONE LINE IN SIGHT, THE REST ONE TAP AWAY (the 9 Oct audit, #5: the Lab
     "repeatedly explains … saving prerequisites"). What Save does, in a
     line; why a scenario needs a property, what a commit marks as the
     reader's and why the grade can stay U, under "How saving works" (L3,
     closed) — every word of it kept. */
  const line = sample ? `${col.key} is the sample deal — open it in the calculator to save it as a property of yours.`
    : !rec ? (labScenarioAfterProperty(lab, col) ? `One Save keeps the property and ${col.key} as its scenario.` : `Save keeps the property — and ${col.key}, once moved, as its scenario.`)
    : canSave ? `Saving makes ${col.key}’s moved figures yours.`
    : differs ? `${col.key} is saved as “${col.name}” — move a figure to save again.`
    : `${col.key} is the property as saved — move a figure first.`;
  const why = [];
  if (sample) why.push(`The sample deal is the tool’s, not a property saved here, so ${col.key} has no property to keep a scenario of. Opened in the calculator, its figures become a deal of yours to save there.`);
  else if (!rec) why.push(labScenarioAfterProperty(lab, col)
    ? `A scenario belongs to a saved property, so this Save asks for two names: the property’s, and ${col.key}’s as its scenario. It saves the deal on the calculator as a property, then ${col.key}, its moves kept, as a scenario of it.`
    : `A scenario belongs to a saved property. Save keeps the deal on the calculator as a property; move a figure of ${col.key} and the same Save keeps ${col.key} as its scenario too.`);
  else if (!canSave) why.push(differs ? `${col.key} is saved already, as “${col.name}” — move a figure to save a new scenario, or to update this one.`
    : `${col.key} holds the property as saved — move a figure first: a scenario with nothing changed is the property twice.`);
  why.push(`Saving or opening ${col.key} makes the moved figures yours, as typing them in the calculator does: a moved price or rent stops being an illustrative default. `
    + 'Until then nothing moved here is saved or marked as yours. The grade stays U while any figure that drives it — the built-up area and the maintenance too — is still the tool’s starting figure.');
  card.append(el('p', { class: 'metaline lab-commit-line', id: labId(P, 'commit-line') }, line));
  /* Open stays open while the card is drawn again under a move. */
  const more = el('details', { class: 'pc-more ls-l3 lab-commit-more', id: labId(P, 'commit-more'), open: P.saveMoreOpen ? '' : null }, [
    el('summary', { class: 'pc-more-sum' }, 'How saving works'),
    el('p', { class: 'pc-more-body lab-commit-why' }, why.join(' '))]);
  more.addEventListener('toggle', () => { P.saveMoreOpen = more.open; });
  card.append(more);
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
  for (const k of labMarked(col)) if (!DEAL_ANSWER_KEYS.includes(k)) markTouched(next, k);
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
  /* The guided save's second name: the column the sliders move now, as its
     scenario — asked for again if another column was picked meanwhile, and
     not at all where that column holds nothing a scenario would keep. */
  let sc = null;
  if (isProp) {
    if (!labScenarioAfterProperty(lab, col)) lab.naming.scenario = null;
    else if (!lab.naming.scenario || lab.naming.scenario.key !== col.key) lab.naming.scenario = labGuidedScenario(lab, col);
    sc = lab.naming.scenario;
  }
  const form = el('form', { class: 'lab-name-form', onsubmit: (e) => {
    e.preventDefault();
    if (!isProp) { labCommitScenario(P, lab, input.value); return; }
    labSaveProperty(P, lab, input.value, sc && sc.on ? { name: scInput.value } : null);
  } });
  const input = el('input', { type: 'text', class: 'input', id: fid, maxlength: '80', value: lab.naming.value || '', autocomplete: 'off',
    oninput: (e) => { lab.naming.value = e.target.value; } });
  form.append(el('label', { for: fid, class: 'lab-name-label' }, isProp ? 'Name this property' : `Name ${col.key} as a scenario of “${labColRec(lab, col)?.name || ''}”`), input);
  let scInput = null;
  if (sc) {
    const sid = labId(P, 'scenario-name'), cid = labId(P, 'name-with-sc');
    scInput = el('input', { type: 'text', class: 'input', id: sid, maxlength: '80', value: sc.value || '', autocomplete: 'off', disabled: sc.on ? null : '',
      oninput: (e) => { sc.value = e.target.value; } });
    const check = el('input', { type: 'checkbox', id: cid, checked: sc.on ? '' : null, onchange: (e) => {
      sc.on = e.target.checked; scInput.disabled = !sc.on;
    } });
    form.append(el('div', { class: 'lab-name-sc' }, [
      el('label', { for: cid, class: 'checkline lab-name-check' }, [check, el('span', {}, `Also save ${col.key} as its scenario — ${col.key}’s moves become yours`)]),
      el('label', { for: sid, class: 'lab-name-label' }, `Name ${col.key} as a scenario of this property`), scInput]));
  }
  form.append(
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
/* `scenario`: the guided save's second half ({ name }) — the active
   column, once on the property, saved as its scenario (labCommitScenario),
   in the same action. */
function labSaveProperty(P, lab, name, scenario = null) {
  const fromId = lab.naming?.at === 'identity';
  /* The answers given here are the property's: saved with it. */
  const answered = lab.answers && Object.keys(lab.answers).length ? labAnswersWriter(lab) : null;
  const before = answered ? pmCopy(State.deal) : null;
  if (answered) answered(State.deal);
  const rec = saveActiveProperty({ name: String(name || '').trim() || pmNameOf(State.deal) });
  if (!rec) { if (before) State.deal = before; return; }
  const moved = lab.cols.map(c => ({ key: c.key, moves: { ...c.moves }, name: c.name, source: c.source, of: c.of, prop: c.prop, baseInputs: c.baseInputs, inherited: c.inherited || {} }));
  delete LAB[lab.key];
  const next = labEnsure({ kind: 'model', id: rec.id, cols: ['base'] });
  next.lens = lab.lens || LAB_LENS_DEFAULT;
  next.metric = lab.metric || 'yield';
  next.cols = moved.map(m => {
    /* Another property's column stays as it was, its moves kept: the
       answers saved here are this property's, not its (P6). */
    const c = m.prop ? labCol(m.key, m.source, m.name, m.baseInputs, { prop: m.prop, of: m.of, inherited: pmCopy(m.inherited) })
      : m.source === 'deal' ? labCol(m.key, 'base', 'As saved', pmInputsOf(rec))
      : labCol(m.key, 'variant', m.name, answered ? (() => { const b = pmCopy(m.baseInputs); answered(b); return b; })() : m.baseInputs, { of: m.of, inherited: pmCopy(m.inherited) });
    for (const [k, v] of Object.entries(m.moves)) labWrite(c, k, v);
    return c;
  });
  next.active = lab.active;
  if (P.key === lab.key) P.key = next.key;
  if (labSubject === lab.key) labSubject = next.key;
  /* The second half of the guided save: the column the sliders move, its
     moves now moves on the property, kept as a scenario of it. Its own
     drawing, address and toast follow (labCommitScenario); the property is
     saved whatever becomes of it, and a refusal is said. */
  if (scenario) {
    next.naming = { kind: 'scenario', at: fromId ? 'identity' : null };
    if (labCommitScenario(P, next, scenario.name, { withProperty: rec })) return;
    next.naming = null;
  }
  /* The keyboard on the next thing to do with the column, which the
     property's save leaves enabled — beside the identity line where the
     save was asked for there. */
  labDraw(P, [...(fromId ? [labId(P, 'id-save'), labId(P, 'next-go')] : []), labId(P, 'save'), labId(P, 'open')]);
  labAfterStructure(P, next, { address: true });
}
function labCommitScenario(P, lab, name, { withProperty = null } = {}) {
  const col = labActive(lab);
  /* A scenario of the property the column is of (P6). */
  const rec = labColRec(lab, col);
  if (!rec) { toast('That property is no longer saved in this browser'); return null; }
  const next = labNext(col);
  const overrides = pmDiff(next, pmInputsOf(rec));
  if (!Object.keys(overrides).filter(k => k !== 'touched').length) { toast(`${col.key} holds the inputs “${rec.name}” is saved with — move a figure first.`); return null; }
  const yours = labYoursWords(col);
  const fromId = lab.naming?.at === 'identity';
  const sc = pmAddScenario(rec.id, overrides, String(name || '').trim() || `Scenario ${(rec.scenarios || []).length + 1}`);
  if (!sc) { toast(STORE_REFUSED); return null; }
  /* The calculator's comparison shows it beside the columns already here
     — the subject's own; another property's column becomes that
     property's scenario, and the subject's comparison is not told. */
  const shown = labOwnIds(lab);
  const fresh = pmFind(rec.id);
  const i = lab.cols.indexOf(col);
  if (col.prop) lab.cols[i] = labCol(col.key, `pm:${rec.id}/${sc.id}`, `${fresh.name} — ${sc.name}`, pmSavedInputs(fresh, pmScenario(fresh, sc.id)), { prop: col.prop });
  else {
    lab.cols[i] = labCol(col.key, `sc:${sc.id}`, sc.name, pmSavedInputs(fresh, pmScenario(fresh, sc.id)));
    pmCompareSelect(rec.id, [...shown, sc.id]);
  }
  lab.naming = null;
  /* Saved, the button that saved it is disabled: the keyboard goes to the
     next thing to do with the column, not to <body>. */
  labDraw(P, [...(fromId ? [labId(P, 'id-save'), labId(P, 'next-go')] : []), labId(P, 'open'), labId(P, `col-${col.key}`)]);
  labAfterStructure(P, lab, { address: true });
  toast(withProperty
    ? `Saved “${rec.name}” and ${col.key} as its scenario “${sc.name}” — both are listed in My properties${yours}.${labGateWords(next)}`
    : `Saved ${col.key} as the scenario “${sc.name}” of “${rec.name}”${yours}.${labGateWords(next)}`);
  return sc;
}
function labUpdateScenario(P, lab) {
  const col = labActive(lab);
  const rec = labColRec(lab, col);
  /* The subject's scenario ('sc:<id>'), or another property's ('pm:<id>/<sc>'). */
  const scId = labSourceKind(col) === 'sc' ? col.source.slice(3) : labPmRef(col.source)?.sc || null;
  if (!rec || !scId) return null;
  const next = labNext(col), yours = labYoursWords(col);
  const out = pmWriteScenario(rec.id, scId, pmDiff(next, pmInputsOf(rec)));
  if (!out) { toast(STORE_REFUSED); return null; }
  const fresh = pmFind(rec.id), sc = pmScenario(fresh, scId);
  const i = lab.cols.indexOf(col);
  lab.cols[i] = labCol(col.key, col.source, col.prop ? `${fresh.name} — ${sc.name}` : sc.name, pmSavedInputs(fresh, sc), { prop: col.prop });
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
  /* Another property's column opens as that property (or its scenario);
     the sample, as a deal of no property (P6). */
  const ref = labPmRef(col.source);
  const scId = k === 'sc' ? col.source.slice(3) : k === 'current' ? State.deal?.scenarioId || null : ref?.sc || null;
  const modelId = col.prop ? labColRecId(lab, col) : lab.model || null;
  const kept = propertyLoad(next, { modelId: modelId && pmFind(modelId) ? modelId : null, scenarioId: modelId ? scId : null });
  /* With the calculator's own deal as the subject, the column's moves are
     the calculator's now: it starts from the figures it handed over, with
     nothing left to call "not saved", and the deal's column — read again on
     the way back — is the calculator's deal as it is now. Kept as moves,
     Back found them still "not saved" beside a deal column named "Sample
     deal" that held them (the verification of 4 Oct 2026, F2). */
  if (!lab.model && !col.prop) {
    col.baseInputs = pmNormalInputs(next);
    col.moves = {}; col.inherited = {};
    col.work = pmCopy(col.baseInputs);
    col.ref = labRun(col.baseInputs);
    col.cur = null;
  }
  navigate('/property/calculator');
  toast(`The calculator now holds ${col.key}${yours}.${labGateWords(next)}${pmKeptNote(kept)}`);
}

/* -------------------------------------------- across routes and assets (P6) */
/* COMPARE ACROSS ROUTES AND ASSETS (the decision layer, P6; the owner's
   decisions of 7 Oct 2026). Columns from different properties — a subsale
   condominium, an auction condominium, a subsale shoplot — each worked
   through on its own route and asset's model (auctionModel, newDevModel,
   commercialModel, priceGap: 75-property-grade.js and 70-property.js), on
   its own figures and nothing of another column's, each figure with its
   own kind badge (D6) and its own Unavailable and "Not final" states.
   - THE ROWS: each route's lead figures — the subsale's price gap; the
     auction's effective acquisition cost, true discount, forfeiture
     exposure and its checks, "Not final" while any is open; the new
     development's premium and construction interest; the commercial unit's
     net yield at the contract and at the model rent and its 12-month
     lease-down reserve — and the figures every column has: cash required,
     the monthly position, the net yield, value less loan at the sale. A
     figure a column's route has not reads "Not for this route" (its asset,
     "Not for this asset"), never nought and never blank.
   - THE LENS (cash flow, growth, risk, liquidity) decides which rows lead
     (the first two, L1) and the chart's form and scale. It NEVER reorders
     or sorts the columns: A, B and C stand in the reader's order whatever
     the lens or the figures; nothing says which is the more attractive,
     and no colour marks one — the columns keep their series colours.
   - SAVED ONLY ON SAVE: which property stands in which column, and the
     lens, kept in this browser (labComparisons) when the reader saves the
     comparison — never a move not saved. */
const LAB_LENSES = [
  { id: 'cashflow', label: 'Cash flow', chart: 'monthly',
    order: ['monthly', 'netYield', 'cmYieldC', 'cmYieldM', 'cash', 'auEffective', 'ndIdc', 'cmReserve', 'priceGap', 'auDiscount', 'ndPremium', 'auForfeit', 'auChecks', 'vll'] },
  { id: 'growth', label: 'Growth', chart: 'vll',
    order: ['vll', 'priceGap', 'auDiscount', 'ndPremium', 'netYield', 'cmYieldM', 'cmYieldC', 'monthly', 'cash', 'auEffective', 'ndIdc', 'cmReserve', 'auForfeit', 'auChecks'] },
  { id: 'risk', label: 'Risk', chart: 'occupancy',
    order: ['cmReserve', 'auForfeit', 'auChecks', 'auDiscount', 'auEffective', 'ndIdc', 'ndPremium', 'priceGap', 'monthly', 'cash', 'netYield', 'cmYieldC', 'cmYieldM', 'vll'] },
  { id: 'liquidity', label: 'Liquidity', chart: 'cash',
    order: ['cash', 'auForfeit', 'cmReserve', 'ndIdc', 'auEffective', 'monthly', 'auChecks', 'auDiscount', 'ndPremium', 'priceGap', 'netYield', 'cmYieldC', 'cmYieldM', 'vll'] },
];
const LAB_LENS_IDS = LAB_LENSES.map(x => x.id);
const LAB_LENS_DEFAULT = 'cashflow';
const LAB_LENS_BY_ID = Object.fromEntries(LAB_LENSES.map(x => [x.id, x]));
/* A deal's route and asset, as a column is labelled: "Auction · Residential". */
function labRouteAsset(d) {
  const sub = dealCommercialSubtype(d);
  return `${PROPERTY_ROUTES[dealRoute(d)].label} · ${PROPERTY_CLASSES[propertyClassOf(d)].label}${sub ? ` — ${COMMERCIAL_SUBTYPES[sub].label.toLowerCase()}` : ''}`;
}
/* What a column can show besides the subject's own: the reader's other
   saved properties, and the sample — not where the sample is the deal the
   lab is open on already. */
function labOtherSources(lab) {
  const out = pmAll().filter(r => r.id !== lab.model).map(r => ({ id: `pm:${r.id}`, label: `${r.name} — ${labRouteAsset(pmInputsOf(r))}` }));
  if (lab.model || propertyStatus(State.deal).kind !== 'sample') out.push({ id: 'sample', label: 'Sample deal — not a real listing' });
  return out;
}
/* A column as the comparison across properties names it: by its property —
   "Tabuan condo", "Tabuan condo — Rent 2,000" — where "As saved" alone
   would not say which. */
const labXrName = (lab, c) => {
  const rec = !c.prop && lab.model ? pmFind(lab.model) : null;
  return rec && labSourceKind(c) !== 'variant' ? `${rec.name}${c.name === 'As saved' ? '' : ` — ${c.name}`}` : c.name;
};
/* Whether the columns differ in property, route or asset: the comparison
   across routes is drawn only then. */
const labCrossRoute = (lab) => lab.cols.some(c => c.prop) || new Set(lab.cols.map(c => `${dealRoute(c.work)}|${propertyClassOf(c.work)}`)).size > 1;

/* A COLUMN'S FIGURES BY ITS OWN MODEL — its route's and its asset's, run
   on its own inputs and its own run of the calculator's model, and kept
   until either changes. */
function labXrFacts(col) {
  const run = col.cur;
  if (!run?.m) return null;
  const k = col.xrKept;
  if (k && k.run === run && k.ver === col.ver && k.obs === State.observations) return k.f;
  const d = col.work, m = run.m, route = dealRoute(d), cls = propertyClassOf(d);
  const f = { d, m, route, cls, letting: m.letsToTenant !== false,
    gap: route === 'subsale' ? priceGap(d) : null,
    au: route === 'auction' ? auctionModel(d, m) : null,
    nd: route === 'newdev' ? newDevModel(d, m, { solve: false }) : null,
    cm: cls === 'commercial' ? commercialModel(d, m) : null };
  col.xrKept = { run, ver: col.ver, obs: State.observations, f };
  return f;
}
const labR4 = (v) => Math.round(v * 1e4) / 1e4;
const labXrUnavailable = (why) => ({ value: null, text: 'Unavailable', kind: 'unavailable', sub: why });
/* THE ROWS. `only`: the route ('subsale', 'auction', 'newdev') or asset
   ('commercial') a row belongs to — none, every column has it; `applies`,
   whether a column has it; `cell`, its figure from the column's facts. */
const LAB_XR_ROWS = [
  { id: 'cash', label: 'Cash required', cell: (f) => ({ value: f.m.safeCashRequired, text: labMoney(f.m.safeCashRequired),
      kind: dealKind(f.d, f.m, { rests: LAB_TILE_RESTS.safeCashRequired, fees: true }).kind,
      sub: [(f.m.missingCostLines || []).length ? 'so far' : null, f.m.unconfirmedCost > 0 ? `${labMoney(f.m.unconfirmedCost)} on unverified lines` : null].filter(Boolean).join(' · ') }) },
  { id: 'monthly', label: 'Monthly position', neg: true, cell: (f) => (isNum(f.m.cashflowMonthly)
      ? { value: f.m.cashflowMonthly, text: labMoney(f.m.cashflowMonthly), kind: dealKind(f.d, f.m, { rests: LAB_TILE_RESTS.cashflowMonthly }).kind,
          sub: f.m.taxComputed && isNum(f.m.path?.[0]?.cf) ? `after tax on the rent: ${labMoney(f.m.path[0].cf / 12)}` : 'before tax on the rent' }
      : labXrUnavailable('the loan has no schedule of repayments')) },
  { id: 'netYield', label: 'Net yield', asset: true, applies: (f) => f.letting, cell: (f) => ({ value: labR4(f.m.netYield), text: fmtPct(f.m.netYield, 2),
      kind: dealKind(f.d, f.m, { rests: LAB_TILE_RESTS.netYield }).kind, sub: isNum(f.m.grossYield) ? `gross ${fmtPct(f.m.grossYield, 2)}` : '' }) },
  { id: 'vll', label: 'Value less loan at the sale', cell: (f) => (isNum(f.m.valueLessLoanAtExit)
      ? { value: f.m.valueLessLoanAtExit, text: labMoney(f.m.valueLessLoanAtExit), kind: dealKind(f.d, f.m, { rests: LAB_TILE_RESTS.valueLessLoanAtExit }).kind,
          sub: `year ${normHoldYears(f.d.holdYears)}, before selling costs` }
      : labXrUnavailable('the loan has no schedule of repayments')) },
  { id: 'priceGap', label: 'Price gap', only: 'subsale', cell: (f) => {
      const g = f.gap;
      if (g.status !== 'ok') return labXrUnavailable(g.status === 'no-comparables' ? 'needs comparables named from your register' : 'needs the asking price');
      return { value: g.askingGap.amount, text: priceGapWords(g).figure,
        kind: kindFirst([KIND_OF_EVIDENCE[f.d.evidence?.askingPrice || 'user'] || 'yours', ...g.comps.map(c => KIND_OF_EVIDENCE[c.evidence] || 'yours')]) || 'derived',
        sub: `the asking price against the ${pqMoney(g.value)} your ${g.comps.length === 1 ? 'comparable implies' : `${g.comps.length} comparables imply`}` };
    } },
  { id: 'auEffective', label: 'Effective acquisition cost', only: 'auction', cell: (f) => {
      const a = f.au;
      if (!isNum(a.effective)) return labXrUnavailable('needs the winning bid you expect');
      return { value: a.effective, text: auMoney(a.effective), kind: a.effectiveKind, notFinal: !a.final,
        sub: a.notEntered.length ? `${a.notEntered.length} of ${a.adds.length} costs not entered, not counted` : 'every cost entered' };
    } },
  { id: 'auDiscount', label: 'True discount', only: 'auction', cell: (f) => {
      const a = f.au, td = a.trueDiscount;
      if (!td) return { ...labXrUnavailable('needs comparable prices'), notFinal: !a.final };
      return { value: labR4(td.pct), text: `${td.amount < 0 ? '−' : ''}${auPct(td.pct)}`, kind: kindFirst([a.marketKind, a.effectiveKind]) || 'derived', notFinal: !a.final,
        sub: `${auMoney(Math.abs(td.amount))} ${td.amount >= 0 ? 'under' : 'over'} the market value your comparables imply` };
    } },
  { id: 'auForfeit', label: 'Forfeiture exposure', only: 'auction', cell: (f) => {
      const a = f.au, x = a.forfeiture;
      if (x.status !== 'ok') return { ...labXrUnavailable(`enter ${auList(x.missing)} — never assumed`), notFinal: !a.final };
      return { value: x.atRisk, text: auMoney(x.atRisk), kind: 'yours', notFinal: !a.final,
        sub: `the deposit, if the balance is not paid within ${x.days} day${x.days === 1 ? '' : 's'}` };
    } },
  { id: 'auChecks', label: 'Auction checks', only: 'auction', cell: (f) => {
      const a = f.au, n = AUCTION_CHECK_IDS.length;
      return { plain: true, value: a.checksOpen.length, text: a.final ? `All ${n} ticked` : `${a.checksOpen.length} of ${n} open`, notFinal: !a.final,
        sub: 'the Malaysian Bar’s checklist' };
    } },
  { id: 'ndPremium', label: 'Developer premium', only: 'newdev', cell: (f) => {
      const n = f.nd, p = n.premium;
      if (!p) return labXrUnavailable('needs a completed comparable');
      return { value: Math.round(p.amount), text: `${pqSigned(p.amount)} · ${ndPctWords(p.pct)}`, kind: n.premiumKind,
        sub: `${p.amount >= 0 ? 'over' : 'under'} the completed comparable you entered` };
    } },
  { id: 'ndIdc', label: 'Construction interest', only: 'newdev', cell: (f) => {
      const n = f.nd, b = n.build;
      if (b.status !== 'ok' && b.status !== 'no-loan') return labXrUnavailable(`enter ${auList(b.missing)} — never assumed`);
      return { value: b.idc ?? 0, text: pqMoney(b.idc ?? 0), kind: n.idcKind,
        sub: b.status === 'no-loan' ? 'no loan, so nothing is charged' : `until vacant possession, ${b.vpMonths} months after signing` };
    } },
  { id: 'cmYieldC', label: 'Net yield at the contract rent', only: 'commercial', cell: (f) => {
      const c = f.cm, y = c.yields;
      if (!isNum(y.contract)) return labXrUnavailable(c.vacant ? 'vacant — no contract rent' : 'needs the contract rent');
      return { value: labR4(y.contract), text: cmPct(y.contract), kind: y.contractKind, sub: `at ${pqMoney(c.contract)} a month, the tenancy’s` };
    } },
  { id: 'cmYieldM', label: 'Net yield at the model rent', only: 'commercial', cell: (f) => {
      const c = f.cm, y = c.yields;
      if (!isNum(y.model)) return labXrUnavailable('needs a model rent');
      return { value: labR4(y.model), text: cmPct(y.model), kind: y.modelKind, sub: `at ${pqMoney(c.model)} a month, your model rent` };
    } },
  { id: 'cmReserve', label: '12-month lease-down reserve', only: 'commercial', cell: (f) => {
      const c = f.cm, r = c.lease.scenarios.find(s => s.months === 12);
      if (!r || r.status === 'unavailable') return labXrUnavailable(`enter ${auList(c.lease.missing)} — never assumed`);
      return { value: r.reserve, text: pqMoney(r.reserve), kind: c.lease.reserveKind,
        sub: `12 months × ${pqMoney(c.lease.burn)} with no rent${isNum(c.lease.fitOut) ? `, + ${pqMoney(c.lease.fitOut)} of fit-out` : ''}` };
    } },
];
const LAB_XR_ROW_BY_ID = Object.fromEntries(LAB_XR_ROWS.map(r => [r.id, r]));
/* Whether a column has a row's figure. */
const labXrApplies = (r, f) => (r.only === 'commercial' ? f.cls === 'commercial' : r.only ? f.route === r.only : r.applies ? r.applies(f) : true);
/* One column's cell of a row: its figure, or why there is none. */
function labXrCell(r, f) {
  if (!f) return { plain: true, value: null, text: 'Needs a purchase price' };
  if (!labXrApplies(r, f)) return { na: true, value: null, text: r.only === 'commercial' || r.asset ? 'Not for this asset' : 'Not for this route' };
  return r.cell(f);
}
/* THE LENS'S CHART: one figure every column has, its form and its scale
   the lens's — bars about nought, bars from nought, bars against a line,
   or a stack. */
const LAB_XR_CHARTS = {
  monthly: { title: 'Monthly position, about nought', form: 'diverging', read: (f) => f.m.cashflowMonthly, fmt: (v) => labMoney(v) },
  vll: { title: 'Value less loan at the sale, before selling costs', form: 'bars', read: (f) => f.m.valueLessLoanAtExit, fmt: (v) => labMoney(v),
    note: (f) => `year ${normHoldYears(f.d.holdYears)}` },
  occupancy: { title: 'Break-even occupancy, against 100%', form: 'against-line', refs: [100], read: (f) => (f.letting ? f.m.breakEvenOccupancy : null), fmt: (v) => fmtPct(v, 1),
    na: (f) => (f.letting ? null : 'Not for this asset') },
  cash: { title: 'Cash required: to complete, renovation and set-up, and the reserve', form: 'stacked', read: (f) => f.m.safeCashRequired, fmt: (v) => labMoney(v),
    parts: (f) => [f.m.transactionCash, f.m.improvementCash, ...(isNum(f.m.reserveCash) ? [f.m.reserveCash] : [])] },
};
/* What the card shows, for the columns as they are: the rows in the lens's
   order (only those some column has), every column's cell, and the chart. */
function labXrView(lab) {
  const lens = LAB_LENS_BY_ID[lab.lens] || LAB_LENS_BY_ID[LAB_LENS_DEFAULT];
  const cols = lab.cols.map(c => ({ key: c.key, name: labXrName(lab, c), chip: LAB_SOURCE_CHIP[labSourceKind(c)], ra: labRouteAsset(c.work), active: c.key === lab.active, f: labXrFacts(c) }));
  const rows = lens.order.map(id => LAB_XR_ROW_BY_ID[id]).filter(r => !r.only || cols.some(x => x.f && labXrApplies(r, x.f)))
    .map((r, i) => ({ id: r.id, label: r.label, neg: !!r.neg, level: i < 2 ? 1 : 2, cells: cols.map(x => labXrCell(r, x.f)) }));
  const spec = LAB_XR_CHARTS[lens.chart];
  const bars = cols.map(x => {
    const na = x.f && spec.na ? spec.na(x.f) : null;
    const v = x.f && !na ? spec.read(x.f) : null;
    return { key: x.key, name: x.name, value: isNum(v) ? v : null, text: !x.f ? 'Needs a purchase price' : na || (isNum(v) ? spec.fmt(v) : 'Not computable'),
      parts: x.f && !na && spec.parts ? spec.parts(x.f).map(p => (isNum(p) ? p : 0)) : null, note: x.f && !na && spec.note ? spec.note(x.f) : null };
  });
  /* The scale, nought inside it, on clean ticks, as the comparison's. */
  const xs = [0, ...(spec.refs || [])];
  bars.forEach(b => { if (isNum(b.value)) xs.push(b.value); if (b.parts) { let s = 0; b.parts.forEach(p => { s += p; xs.push(s); }); } });
  const nt = niceTicks(Math.min(...xs), Math.max(...xs));
  let lo = nt.lo, hi = nt.hi > nt.lo ? nt.hi : nt.lo + 1;
  const step = nt.ticks.length > 1 ? nt.ticks[1] - nt.ticks[0] : hi - lo;
  if ((spec.refs || []).some(x => x >= hi)) hi += step;
  const chart = { title: spec.title, form: spec.form, refs: spec.refs || [], lo, hi, bars };
  const shape = JSON.stringify([lens.id, cols.map(x => [x.key, x.name, x.chip, x.ra, x.active]), rows.map(r => [r.id, r.cells.map(c => [!!c.na, !!c.plain, c.kind || null, !!c.notFinal, !!c.sub])]),
    chart.form, bars.map(b => [b.key, isNum(b.value), (b.parts || []).length, !!b.note])]);
  return { lens, cols, rows, chart, shape };
}
function labXrCard(P, lab) {
  const card = el('section', { class: 'card ls-section lab-xr', id: labId(P, 'xr'), 'aria-labelledby': labId(P, 'xr-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'xr-h') }, 'Across routes and assets'));
  card.append(el('p', { class: 'metaline lab-xr-lede' }, 'Each column on its own route and asset’s model, from the figures entered for it — what they imply. Not a valuation.'));
  const fs = el('fieldset', { class: 'lab-pick lab-pick-lens' });
  fs.append(el('legend', { class: 'lab-legend' }, 'Lens'));
  const seg = el('div', { class: 'lab-seg ls-chips', role: 'presentation' });
  for (const ln of LAB_LENSES) {
    const id = labId(P, `lens-${ln.id}`), on = lab.lens === ln.id;
    seg.append(el('label', { class: `lab-seg-opt${on ? ' is-on' : ''}`, for: id }, [
      el('input', { type: 'radio', class: 'lab-radio', name: labId(P, 'lens'), id, value: ln.id, checked: on ? '' : null,
        onchange: () => {
          lab.lens = ln.id;
          seg.querySelectorAll('.lab-seg-opt').forEach(o => o.classList.toggle('is-on', o.getAttribute('for') === id));
          labPaintPanel(P);
          const vm = P.els.xr?.vm;
          if (vm) liveSay(`Lens ${ln.label}: ${vm.rows[0]?.label || ''} and ${vm.rows[1]?.label || ''} lead; the chart shows ${vm.chart.title.split(':')[0].toLowerCase()}. Order ${lab.cols.map(c => c.key).join(', ')}.`);
          if (P.address) labAddressSoon(lab);
        } }),
      el('span', {}, ln.label)]));
  }
  fs.append(seg);
  const say = el('p', { class: 'metaline lab-xr-say', id: labId(P, 'xr-say') }, '');
  const chart = el('div', { class: 'lab-xr-chart-box', id: labId(P, 'xr-chart') });
  /* On a phone one column at a time, chosen here (the layout system: a
     phone sequences); from a 600px panel every column stands. */
  const show = el('fieldset', { class: 'lab-pick lab-xr-show' });
  show.append(el('legend', { class: 'lab-legend' }, 'Show'));
  const sseg = el('div', { class: 'lab-seg ls-chips', role: 'presentation' });
  const shown = lab.cols.some(c => c.key === P.xrShow) ? P.xrShow : lab.active;
  for (const c of lab.cols) {
    const id = labId(P, `xr-show-${c.key}`), on = c.key === shown;
    sseg.append(el('label', { class: `lab-seg-opt${on ? ' is-on' : ''}`, for: id }, [
      el('input', { type: 'radio', class: 'lab-radio', name: labId(P, 'xr-show'), id, value: c.key, checked: on ? '' : null, 'aria-label': `${c.key} — ${labXrName(lab, c)}`,
        onchange: () => {
          P.xrShow = c.key;
          sseg.querySelectorAll('.lab-seg-opt').forEach(o => o.classList.toggle('is-on', o.getAttribute('for') === id));
          grid.dataset.show = c.key;
        } }),
      labLetter(c.key), el('span', { class: 'lab-xr-show-name' }, labXrName(lab, c))]));
  }
  show.append(sseg);
  const grid = el('div', { class: 'lab-xr-grid', id: labId(P, 'xr-grid'), 'data-show': shown, style: `--xr-n:${lab.cols.length}` });
  card.append(fs, say, chart, show, grid);
  P.els.xr = { card, say, chart, grid, shape: null, vm: null };
  return card;
}
/* Drawn whole when what it shows changes shape — the lens, a column, a
   row, a cell's kind — and its figures written in place at every paint. */
function labXrPaint(P, lab, { initial = false } = {}) {
  const xr = P.els?.xr;
  if (!xr) return;
  const vm = labXrView(lab);
  xr.vm = vm;
  if (initial || vm.shape !== xr.shape || !xr.cells) labXrDraw(P, vm);
  else labXrUpdate(P, vm);
}
function labXrDraw(P, vm) {
  const xr = P.els.xr;
  const pre = labId(P, 'xr');
  /* The chart. */
  const t = vm.chart;
  const fig = el('figure', { class: 'lab-xr-chart', 'data-form': t.form, 'aria-labelledby': `${pre}-chart-h` });
  fig.append(el('figcaption', { class: 'lab-xr-chart-h', id: `${pre}-chart-h` }, [`${t.title}. `, el('span', { class: 'sr-only' }, `Order: ${vm.cols.map(c => c.key).join(', ')}.`)]));
  const barEls = [];
  const list = el('div', { class: 'lab-xr-bars' });
  t.bars.forEach(b => {
    const v = el('span', { class: 'lab-xr-bar-v num' }, b.text);
    const track = el('div', { class: 'lab-track', 'aria-hidden': 'true' });
    const be = { v, zero: el('span', { class: 'lab-zero' }), refs: [], fill: null, segs: [], note: null };
    track.append(be.zero);
    t.refs.forEach(() => { const s = el('span', { class: 'lab-ref' }); be.refs.push(s); track.append(s); });
    if (b.parts) b.parts.forEach((p, i) => { const s = el('span', { class: `lab-bar-seg lab-seg-${i + 1}` }); be.segs.push(s); track.append(s); });
    else if (isNum(b.value)) { be.fill = el('span', { class: 'lab-bar-fill' }); track.append(be.fill); }
    if (b.note) be.note = el('span', { class: 'metaline lab-xr-bar-note' }, b.note);
    be.row = el('div', { class: `lab-xr-bar lab-c-${b.key}`, 'data-col': b.key, 'data-value': isNum(b.value) ? String(b.value) : '' }, [
      el('p', { class: 'lab-xr-bar-hd' }, [labLetter(b.key), el('span', { class: 'lab-xr-bar-name' }, ` ${b.key} — ${b.name}`), v]), track, be.note]);
    list.append(be.row);
    barEls.push(be);
  });
  fig.append(list);
  if (t.form === 'stacked') fig.append(el('p', { class: 'metaline lab-xr-key' }, 'Each bar, from nought: what completion takes, then renovation and set-up (the stronger shade), then the reserve (outlined).'));
  xr.chart.replaceChildren(fig);
  /* The rows: a header over each, then a cell a column. */
  const grid = xr.grid;
  grid.style.setProperty('--xr-n', String(vm.cols.length));
  const kids = [el('div', { class: 'lab-xr-row lab-xr-cols' }, vm.cols.map(c => el('div', { class: `lab-xr-colhd lab-c-${c.key}${c.active ? ' is-active' : ''}`, 'data-col': c.key }, [
    labLetter(c.key), el('strong', { class: 'lab-xr-colname' }, ` ${c.key} — ${c.name}`), el('span', { class: 'lab-xr-ra' }, c.ra), el('span', { class: 'lab-cmp-chip' }, c.chip)])))];
  const cells = {};
  vm.rows.forEach(r => {
    const hid = `${pre}-row-${r.id}`;
    const row = el('div', { class: `lab-xr-row is-l${r.level}`, role: 'group', 'aria-labelledby': hid, 'data-row': r.id });
    row.append(el('p', { class: 'lab-xr-rowhd', id: hid }, r.label));
    r.cells.forEach((c, i) => {
      const key = vm.cols[i].key;
      const v = el('span', { class: `lab-xr-v${c.na || c.plain && !isNum(c.value) ? '' : ' num'}${r.neg && isNum(c.value) && c.value < 0 ? ' neg' : ''}` }, c.text);
      const sub = c.sub ? el('span', { class: 'lab-xr-sub' }, c.sub) : null;
      const tags = c.kind || c.notFinal ? el('span', { class: 'lab-xr-tags' }, [c.kind ? kindBadge(c.kind, { link: false }) : null,
        c.notFinal ? el('span', { class: 'lab-xr-nf' }, 'Not final') : null]) : null;
      const cell = el('div', { class: `lab-xr-cell lab-c-${key}${c.na ? ' is-na' : ''}`, 'data-col': key, 'data-row': r.id, 'data-value': isNum(c.value) ? String(c.value) : '',
        'data-kind': c.na ? 'none' : c.kind || 'none', 'data-final': c.notFinal ? 'false' : null }, [
        el('span', { class: 'sr-only' }, `${key} — ${vm.cols[i].name}: `), v, tags, sub]);
      row.append(cell);
      cells[`${r.id}|${key}`] = { v, sub };
    });
    kids.push(row);
  });
  grid.replaceChildren(...kids);
  xr.cells = cells; xr.bars = barEls; xr.shape = vm.shape;
  labXrUpdate(P, vm);
}
function labXrUpdate(P, vm) {
  const xr = P.els.xr;
  const lead = vm.rows.slice(0, 2).map(r => r.label.toLowerCase());
  labText(xr.say, `${vm.lens.label} lens: ${lead.join(' and ')} lead. It moves no column and ranks nothing.`);
  vm.rows.forEach(r => r.cells.forEach((c, i) => {
    const ce = xr.cells[`${r.id}|${vm.cols[i].key}`];
    if (!ce) return;
    labText(ce.v, c.text);
    labAttr(ce.v.parentNode, 'data-value', isNum(c.value) ? String(c.value) : '');
    labClass(ce.v, 'neg', r.neg && isNum(c.value) && c.value < 0);
    if (ce.sub) labText(ce.sub, c.sub || '');
  }));
  const t = vm.chart, span = t.hi - t.lo;
  t.bars.forEach((b, i) => {
    const be = xr.bars[i];
    if (!be) return;
    labText(be.v, b.text);
    labAttr(be.row, 'data-value', isNum(b.value) ? String(b.value) : '');
    labStyle(be.zero, 'left', labLineAt(t, 0, 1));
    t.refs.forEach((x, j) => { if (be.refs[j]) labStyle(be.refs[j], 'left', labLineAt(t, x, 2)); });
    if (be.fill) labStyle(be.fill, 'transform', isNum(b.value) ? `translateX(${labR4(labX(t, 0) * 100)}%) scaleX(${labR4(b.value / span)})` : 'scaleX(0)');
    if (b.parts) {
      let at = 0;
      b.parts.forEach((p, j) => { if (be.segs[j]) labStyle(be.segs[j], 'transform', `translateX(${labR4(labX(t, at) * 100)}%) scaleX(${labR4(p / span)})`); at += p; });
    }
    if (be.note) labText(be.note, b.note || '');
  });
}

/* SAVED COMPARISONS, the reader's own, in this browser — written only by
   Save (the owner's decision, 9 Oct 2026): which property stands in which
   column, in the reader's order, and the lens; never a move not saved. A
   column is kept as the saved figures it reads: the property as saved, a
   scenario of it, another property, the sample. A lab copy or unsaved
   changes read no saved figures and are left out, said so — column A, the
   property opened, is kept as that property as saved. */
const labComparisons = () => { const v = store.read('labComparisons', []); return Array.isArray(v) ? v.filter(x => isRecord(x) && typeof x.id === 'string' && typeof x.model === 'string' && Array.isArray(x.cols)) : []; };
const labComparisonOf = (id) => labComparisons().find(x => x.id === id) || null;
function labComparisonRefs(lab) {
  const refs = [], left = [];
  for (const c of lab.cols) {
    const k = labSourceKind(c);
    const ref = k === 'base' ? `pm:${lab.model}` : k === 'sc' ? `pm:${lab.model}/${c.source.slice(3)}` : k === 'pm' || k === 'sample' ? c.source
      : c.key === 'A' ? `pm:${lab.model}` : null;
    if (ref && !refs.includes(ref)) refs.push(ref); else left.push(c.key);
  }
  return { refs, left, moved: lab.cols.filter(c => labMoveCount(c)).map(c => c.key) };
}
/* A saved comparison's columns, named as they are now. */
const labRefName = (ref) => {
  if (ref === 'sample') return 'Sample deal';
  const r = labPmRef(ref), rec = r && pmFind(r.id), sc = rec && r.sc ? pmScenario(rec, r.sc) : null;
  return !rec ? 'no longer saved' : sc ? `${rec.name} — ${sc.name}` : r.sc ? `${rec.name} — a scenario no longer saved` : rec.name;
};
function labSaveComparison(P, lab, name) {
  if (!lab.model || !pmFind(lab.model)) return null;
  const { refs, left, moved } = labComparisonRefs(lab);
  const at = new Date().toISOString();
  const rec = { id: `lc-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, name: String(name || '').trim().slice(0, 80) || refs.map(labRefName).join(' · ').slice(0, 80),
    model: lab.model, cols: refs, lens: lab.lens || LAB_LENS_DEFAULT, metric: lab.metric || 'yield', createdAt: at };
  if (!store.write('labComparisons', [rec, ...labComparisons()].slice(0, 30))) { toast(STORE_REFUSED); return null; }
  lab.cmpName = null;
  labDraw(P, [labId(P, 'cmp-open-0'), labId(P, 'cols-h')]);
  toast(`Saved the comparison “${rec.name}” in this browser: ${refs.length} column${refs.length === 1 ? '' : 's'} in this order and the ${LAB_LENS_BY_ID[rec.lens].label.toLowerCase()} lens`
    + `${left.length ? `; ${labList(left)} ${left.length === 1 ? 'is' : 'are'} not saved, so not kept` : ''}${moved.length ? '; moves not saved are not kept' : ''}.`);
  return rec;
}
function labComparisonsBlock(P, lab) {
  const saved = labComparisons();
  const cross = lab.cols.some(c => c.prop);
  if (!cross && !saved.length) return null;
  const box = el('div', { class: 'lab-cmps', id: labId(P, 'cmps') });
  if (cross && lab.model) {
    const { refs, left } = labComparisonRefs(lab);
    const fid = labId(P, 'cmp-name');
    const input = el('input', { type: 'text', class: 'input', id: fid, maxlength: '80', autocomplete: 'off', value: lab.cmpName ?? refs.map(labRefName).join(' · ').slice(0, 80),
      oninput: (e) => { lab.cmpName = e.target.value; } });
    box.append(el('form', { class: 'lab-name-form lab-cmp-form', onsubmit: (e) => { e.preventDefault(); labSaveComparison(P, lab, input.value); } }, [
      el('label', { for: fid, class: 'lab-name-label' }, 'Name this comparison'), input,
      el('div', { class: 'lab-name-acts' }, [el('button', { type: 'submit', class: 'btn btn-ghost btn-sm', id: labId(P, 'cmp-save') }, 'Save this comparison')]),
      el('p', { class: 'metaline lab-cmp-what' }, `Keeps which property stands in each column, in this order, and the lens — never a move not saved${left.length ? `; ${labList(left)} ${left.length === 1 ? 'is' : 'are'} not saved, so ${left.length === 1 ? 'is' : 'are'} left out` : ''}.`)]));
  } else if (cross) box.append(el('p', { class: 'metaline lab-cmp-what' }, 'To keep this comparison, save A as a property first — Save, beside its name.'));
  if (saved.length) {
    box.append(el('h3', { class: 'lab-cmps-h' }, 'Saved comparisons'));
    box.append(el('ul', { class: 'lab-cmps-list' }, saved.map((s, i) => el('li', { class: 'lab-cmps-row', 'data-cmp': s.id }, [
      el('span', { class: 'lab-cmps-name' }, [el('strong', {}, s.name), el('span', { class: 'metaline' }, ` ${s.cols.map((r, j) => `${LAB_LETTERS[j]} ${labRefName(r)}`).join(' · ')} · ${(LAB_LENS_BY_ID[s.lens] || LAB_LENS_BY_ID[LAB_LENS_DEFAULT]).label} lens`)]),
      el('span', { class: 'lab-col-acts' }, [
        el('a', { class: 'btn btn-ghost btn-sm', id: labId(P, `cmp-open-${i}`), href: href(`/property/lab?compare=${encodeURIComponent(s.id)}`), onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(`/property/lab?compare=${encodeURIComponent(s.id)}`);
        } }, ['Open', el('span', { class: 'sr-only' }, ` the comparison ${s.name}`)]),
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: labId(P, `cmp-del-${i}`), onclick: () => {
          if (!store.write('labComparisons', labComparisons().filter(x => x.id !== s.id))) { toast(STORE_REFUSED); return; }
          labDraw(P, labId(P, 'cols-h'));
          toast(`Deleted the comparison “${s.name}” — the properties in it are kept.`);
        } }, ['Delete', el('span', { class: 'sr-only' }, ` the comparison ${s.name}`)]),
      ])]))));
  }
  return box;
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
  /* The cash required by kind, written while open (and served whole). */
  if (P.els.fees && (initial || P.els.fees.node.open)) {
    labText(P.els.fees.text, !m ? '' : `${col.key}’s cash required, ${labMoney(m.safeCashRequired)}${(m.missingCostLines || []).length ? ' so far' : ''}. ${ledgerSplitWords(m, labMoney)} `
      + (m.unconfirmedCost > 0 ? `${labMoney(m.unconfirmedCost)} of it rests on unverified or unknown lines: ${feeUncertainWords(m, labMoney)}.` : 'No line in it rests on an estimate or an unknown rule.')
      + ` Fee rulebook ${FEE_TABLE.version}, checked ${feeDay(FEE_TABLE.checkedOn)}; every line’s source is on the data sources page.`);
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
      : 'Unsaved moves are lost on reload or close.';
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
  /* The price against the evidence (P2), the auction (P3) or the new development (P4). */
  labPricePaint(P, lab, { initial });
  labAuctionPaint(P, lab);
  labNewDevPaint(P, lab, { initial });
  /* And, answered Commercial, the four rents and the lease-down (P5). */
  labCommercialPaint(P, lab);
  /* Across routes and assets (P6). */
  labXrPaint(P, lab, { initial });
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
  /* The lede a label's length (the 9 Oct audit, #5: the Lab explained
     itself before it showed anything): where the figures come from — the
     calculator's own model — is the evidence's to say (labEvidence). */
  wrap.append(pageHead({ title: 'Scenario Lab', badge: toolBadge('lab'), cls: 'lab-page-hd',
    lede: 'Move a slider and every figure below follows.' }));
  for (const P of [...LAB_PANELS]) if (P.address) LAB_PANELS.delete(P);
  wrap.append(scenarioLabPanel(null, { idPrefix: 'lab', address: true }).node);
  /* A record the reader asked to use from the comparables register (the
     guided evidence flow): named once the page is up, as an answer. */
  const pend = State.labUseComparable;
  if (pend) { State.labUseComparable = null; setTimeout(() => labUseComparable(pend), 0); }
  return wrap;
};
/* "USE IT IN A SCENARIO" (the guided evidence flow, the owner's decision of
   9 Oct 2026): a record of the reader's register named in the Lab's
   comparables, as an answer of the property — every column, a what-if
   until Save, as anything answered here. A record of another town, or of
   a kind this property's price is not set against, is said, not used. */
function labUseComparable(id) {
  const P = [...LAB_PANELS].find(p => p.address && p.node.isConnected);
  const lab = P && LAB[P.key];
  const d = lab && labAnswerInputs(lab);
  const o = (State.observations || []).find(x => x && x.id === id);
  if (!d || !o) return false;
  /* An achieved rent (P5) is named among the observed comparable rents —
     an answer of every column, used by the commercial section; on a
     property answered otherwise it waits there, said so. */
  if (o.kind === 'let-rent') {
    if (!dealRentChoices(d).some(x => x.id === id)) {
      toast(`That record is in ${townName(o.city)}; the property in the Lab is in ${townName(d.city)} — it is set against records of its own town.`);
      return false;
    }
    labAnswer(P, lab, 'rentComparableIds', [...new Set([...(Array.isArray(d.rentComparableIds) ? d.rentComparableIds : []), id])]);
    const row = document.querySelector(`[data-rent-comp="${CSS.escape(id)}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('input')?.focus({ preventScroll: true }); }
    toast(propertyClassOf(d) === 'commercial'
      ? `${comparableName(o)} named among the observed comparable rents — a what-if of every column until you save.`
      : `${comparableName(o)} named among the observed comparable rents — they are used once you answer Commercial, a what-if until you save.`);
    return true;
  }
  const usable = [...dealComparableChoices(d), ...dealAskingChoices(d)].some(x => x.id === id);
  if (!usable) {
    toast(o.city !== d.city
      ? `That record is in ${townName(o.city)}; the property in the Lab is in ${townName(d.city)} — it is set against records of its own town.`
      : `That record is ${(OBS_BY_ID[o.kind]?.label || 'a record').toLowerCase()}: this property’s price is set against prices of its own kind.`);
    return false;
  }
  const ids = [...new Set([...(Array.isArray(d.comparableIds) ? d.comparableIds : []), id])];
  labAnswer(P, lab, 'comparableIds', ids);
  const row = document.querySelector(`[data-comp="${CSS.escape(id)}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('input')?.focus({ preventScroll: true }); }
  toast(`${comparableName(o)} named in the Lab’s comparables — a what-if of every column until you save.`);
  return true;
}
