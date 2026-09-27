/* ==========================================================================
   VALUATION STUDIO
   Sliders drive a real recomputation — the range, the sensitivity grid, the
   driver ranking and the bridge all re-derive from the model on every change.
   ========================================================================== */

const ASSUMPTIONS = {
  dcf: [
    { k:'fcf0',  label:'Starting free cash flow', min:null, max:null, step:0.01, unit:'bn', dp:2,
      note:'Latest reported free cash flow, or the five-year average where the model pack normalises for the cycle.' },
    { k:'g1',    label:'Year-1 free cash flow growth', min:-15, max:40, step:0.5, unit:'%', dp:1,
      note:'Fades linearly to the terminal rate across the explicit forecast period.' },
    { k:'gt',    label:'Terminal growth', min:0, max:6, step:0.1, unit:'%', dp:1,
      note:'Must stay below the discount rate. A perpetuity growing faster than its discount rate has no finite value.' },
    { k:'wacc',  label:'Discount rate (WACC)', min:4, max:18, step:0.1, unit:'%', dp:1,
      note:'Derived from a risk-free rate, an equity risk premium and a business-model beta, then blended for debt.' },
    { k:'years', label:'Explicit forecast years', min:3, max:10, step:1, unit:'yrs', dp:0,
      note:'Longer explicit periods move value out of the terminal assumption and into the forecast.' },
    { k:'hold', label:'Holding-company discount', min:0, max:45, step:1, unit:'%', dp:0, onlyIf:'sotp',
      note:'Applied to the equity value of a holding company. It is a judgement about how the market treats unlike businesses under one listing, not an observed quantity — so it is left as an input.' },
  ],
  ri: [
    { k:'bvps', label:'Book value per share', min:null, max:null, step:0.01, unit:'', dp:2,
      note:'Latest reported shareholders’ equity divided by shares in issue.' },
    { k:'roe',  label:'Sustainable return on equity', min:2, max:24, step:0.1, unit:'%', dp:1,
      note:'A through-the-cycle rate, not the latest reported figure — the default applies a small haircut to the reported ROE.' },
    { k:'coe',  label:'Cost of equity', min:5, max:18, step:0.1, unit:'%', dp:1,
      note:'Risk-free rate plus beta times the equity risk premium for this market.' },
    { k:'g',    label:'Long-run growth', min:0, max:8, step:0.1, unit:'%', dp:1,
      note:'Must stay below the cost of equity. Sustainable growth is bounded by retained earnings times ROE.' },
  ],
  insurer: [
    { k:'bvps', label:'Book value per share', min:null, max:null, step:0.01, unit:'', dp:2,
      note:'Latest reported shareholders’ equity divided by shares in issue. It carries the company’s own reserve estimate.' },
    { k:'roe',  label:'Sustainable return on equity', min:2, max:28, step:0.1, unit:'%', dp:1,
      note:'A through-the-cycle rate. Underwriting results are lumpier than banking, so the default haircuts the reported figure.' },
    { k:'coe',  label:'Cost of equity', min:5, max:18, step:0.1, unit:'%', dp:1,
      note:'Risk-free rate plus beta times the equity risk premium for this market.' },
    { k:'g',    label:'Long-run growth', min:0, max:8, step:0.1, unit:'%', dp:1,
      note:'Must stay below the cost of equity, and below what retained earnings can fund.' },
  ],
  early: [
    { k:'pSuccess', label:'Probability the success case happens', min:0, max:100, step:1, unit:'%', dp:0,
      note:'The single most important input, and the one nobody can observe. The result is this probability applied to the success case and the remainder to the downside floor.' },
    { k:'rev0', label:'Starting revenue', min:null, max:null, step:0.01, unit:'bn', dp:2,
      note:'Latest reported revenue.' },
    { k:'revCagr', label:'Revenue CAGR in the success case', min:0, max:60, step:1, unit:'%', dp:0,
      note:'Faded toward the terminal rate across the forecast period.' },
    { k:'termMargin', label:'Terminal operating margin', min:0, max:35, step:0.5, unit:'%', dp:1,
      note:'Margin ramps from zero to this level across the forecast. The business has never earned it, so it is an assumption in the fullest sense.' },
    { k:'fcfConv', label:'Cash conversion at maturity', min:20, max:120, step:5, unit:'%', dp:0,
      note:'Free cash flow as a percentage of operating profit once the business is mature.' },
    { k:'burn', label:'Annual cash burn until break-even', min:0, max:12, step:0.05, unit:'bn', dp:2,
      note:'Drives the financing need, and therefore the dilution applied to the success case.' },
    { k:'cash', label:'Cash on hand', min:0, max:40, step:0.1, unit:'bn', dp:2,
      note:'Cash available to fund the burn before new capital is required.' },
    { k:'wacc', label:'Discount rate', min:8, max:25, step:0.5, unit:'%', dp:1,
      note:'Higher than a mature business, because the cash flows are further away and far less certain.' },
    { k:'gt', label:'Terminal growth', min:0, max:6, step:0.1, unit:'%', dp:1,
      note:'Must stay below the discount rate.' },
    { k:'years', label:'Years to maturity', min:5, max:15, step:1, unit:'yrs', dp:0,
      note:'How long the ramp to the terminal margin takes.' },
  ],
  scenario: [
    { k:'rev0', label:'Starting revenue', min:null, max:null, step:0.01, unit:'bn', dp:2,
      note:'Latest reported revenue. The whole model is built forward from this line rather than from cash flow.' },
    { k:'revCagr', label:'Revenue CAGR', min:-5, max:45, step:0.5, unit:'%', dp:1,
      note:'Applied in year one and faded linearly toward the terminal rate across the forecast period.' },
    { k:'termMargin', label:'Terminal operating margin', min:0, max:60, step:0.5, unit:'%', dp:1,
      note:'The margin the business settles at. This is usually the single largest driver of the answer — the default holds the current margin rather than assuming expansion.' },
    { k:'fcfConv', label:'Cash conversion', min:10, max:170, step:1, unit:'%', dp:0,
      note:'Free cash flow as a percentage of operating profit. Above 100% usually means large non-cash charges are being added back — check that it is durable.' },
    { k:'wacc', label:'Discount rate (WACC)', min:5, max:20, step:0.1, unit:'%', dp:1,
      note:'Derived from a risk-free rate, an equity risk premium and a business-model beta, then blended for debt.' },
    { k:'gt', label:'Terminal growth', min:0, max:6, step:0.1, unit:'%', dp:1,
      note:'Must stay below the discount rate.' },
    { k:'years', label:'Explicit forecast years', min:5, max:12, step:1, unit:'yrs', dp:0,
      note:'High-growth businesses need a longer explicit period before a perpetuity is defensible.' },
    { k:'dilution', label:'Annual share issuance', min:-5, max:10, step:0.1, unit:'%', dp:1,
      note:'Compounded over the forecast period and applied to the share count, so issuance reduces value per share instead of being ignored.' },
  ],
  ddm: [
    { k:'dpu',  label:'Distribution per unit', min:null, max:null, step:0.001, unit:'', dp:3,
      note:'Latest reported distribution. Check that it is not inflated by a one-off item before extrapolating.' },
    { k:'g',    label:'Distribution growth', min:-3, max:10, step:0.1, unit:'%', dp:1,
      note:'Driven by rent reversion, occupancy and acquisitions net of unit issuance.' },
    { k:'req',  label:'Required return', min:5, max:16, step:0.1, unit:'%', dp:1,
      note:'The return a unitholder requires — typically the long bond yield plus a property risk premium.' },
  ],
};

function studioInputs(r) {
  if (!State.valuation[r.c.id]) State.valuation[r.c.id] = { ...r.inputs };
  return State.valuation[r.c.id];
}

function tabValuation(r) {
  const { c, d } = r;
  const inputs = studioInputs(r);

  /* A model that could not be built has no assumptions to edit, so there is no
     Studio to render — ASSUMPTIONS has no entry for it, and it should not, since
     a form of editable inputs for a valuation that does not exist would invite
     the reader to tune their way to a number the statements cannot support.
     What belongs here is the reason. */
  if (!ASSUMPTIONS[inputs.model] || r.val?.err) {
    const gone = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
    const card = el('div', { class: 'card' });
    card.append(cardHead('No valuation is available for this company',
      'Not a low estimate, and not a wide range — no estimate at all.'));
    card.append(el('p', { class: 'body', style: 'font-size:13px' },
      r.val?.err || 'The statements held for this company do not support any of the models in the router.'));
    card.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:10px' },
      'Everything else on this company still works: the reported statements, the scorecard over the inputs that could be computed, and the risk flags. Only the valuation is absent, and it is absent rather than approximated because a discounted-cash-flow estimate built on a substituted cash flow would be an opinion about the substitution rather than about the company.'));
    /* Two gap shapes reach here. The SEC ingest writes {line, missingYears[]}
       and {line, reason}; the Malaysian one writes {field, missingYears,
       ofYears}. This read only the second and printed "undefined — absent in
       undefined of undefined years" for every filed company that landed on
       this card. Tag-drift warnings are a third shape and belong to the source
       drawer, not to a list of lines that were not reported. */
    const gaps = (c.gaps || []).filter(g => g.missingYears != null || g.reason);
    if (gaps.length) {
      card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Statement lines not reported'));
      const ul = el('ul', { class: 'ticklist' });
      const nYears = yearsOf(c).length;
      gaps.forEach(g => {
        const line = g.line || g.field;
        const text = Array.isArray(g.missingYears)
          ? `${line} — absent in ${g.missingYears.length} of ${nYears} years retrieved (${g.missingYears.join(', ')})`
          : isNum(g.missingYears) ? `${line} — absent in ${g.missingYears} of ${g.ofYears ?? nYears} years retrieved`
          : `${line} — ${g.reason}`;
        ul.append(el('li', {}, text));
      });
      card.append(ul);
    }
    gone.append(card);
    return gone;
  }

  const wrap = el('div', { class: 'studio-layout' });

  /* Free sees the full valuation output and the assumptions that produced it —
     it just cannot change them. Showing the range but hiding the reasoning
     would be exactly the opaque product this is meant not to be. */
  const editable = lim('valuationEditable');

  /* ---------- assumptions rail ---------- */
  const rail = el('div', { class: 'card rail-sticky' });
  rail.append(cardHead('Assumptions',
    editable ? 'Every input is yours to change. Nothing is silently substituted if you clear a value.'
             : 'Every assumption behind the range is shown. Editing them is part of Equities Research — the numbers are not hidden, only the controls.',
    editable ? el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { State.valuation[c.id] = { ...r.inputs }; render(); toast('Reset to derived defaults'); } }, 'Reset')
             : el('span', { class: 'chip chip-bronze' }, 'Read-only')));

  const out = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md);min-width:0' });

  const redraw = () => out.replaceChildren(...studioOutputs(r, inputs, redraw));

  ASSUMPTIONS[inputs.model].filter(a => !a.onlyIf || a.onlyIf === r.val.pack.id).forEach(a => {
    const row = el('div', { class: 'assumption' });
    const lab = el('label', { for: `as-${a.k}` }, a.label);
    row.append(lab);
    /* A cleared field is an absent input, not the previous one. Ignoring the
       empty value kept the range, the grid and the bridge computed from a
       number the field no longer showed, under a rail that promises nothing is
       silently substituted. The value becomes null and the outputs say which
       input is missing instead of producing an estimate. A half-typed entry
       ("-", "1e") reads as empty too, and fills in again on the next key. */
    const num = el('input', { class: 'input input-inline', id: `as-${a.k}`, type: 'number', step: a.step,
      value: Number.isFinite(inputs[a.k]) ? Number(inputs[a.k]).toFixed(a.dp) : '', style: 'text-align:right', disabled: editable ? null : '',
      oninput: e => { const v = parseFloat(e.target.value); inputs[a.k] = Number.isFinite(v) ? v : null; syncRange(); redraw(); } });
    row.append(num);
    let rng = null;
    if (a.min != null && editable) {
      rng = el('input', { class: 'a-range', type: 'range', min: a.min, max: a.max, step: a.step, value: inputs[a.k],
        'aria-label': a.label,
        oninput: e => { inputs[a.k] = +e.target.value; num.value = Number(inputs[a.k]).toFixed(a.dp); redraw(); } });
      row.append(rng);
    }
    const syncRange = () => { if (rng && Number.isFinite(inputs[a.k])) rng.value = inputs[a.k]; };
    row.append(el('p', { class: 'a-note' }, a.note));
    rail.append(row);
  });
  if (!editable) rail.append(el('div', { style: 'margin-top:var(--md)' },
    upsell('Change these assumptions', 'Equities Research makes every input above editable, and recomputes the range, the sensitivity grid and the driver ranking live as you change them.')));

  /* fixed inputs shown for transparency */
  const fixed = el('div', { class: 'sunk', style: 'margin-top:var(--md)' });
  fixed.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Fixed inputs'));
  const kv = el('dl', { class: 'kv' });
  const fixedRows = inputs.model === 'insurer'
    ? [['Combined ratio', isNum(inputs.combined) ? fmtPct(inputs.combined, 1) : 'not reported'], ['Solvency, times required', isNum(inputs.solvency) ? fmtX(inputs.solvency, 2) : 'not reported'],
       ['Payout ratio', inputs.payoutAssumed ? `${fmtPct(inputs.payout, 0)} — assumed, not reported` : fmtPct(inputs.payout, 0)], ['Reporting currency', c.ccy]]
    : inputs.model === 'early'
    ? [['Shares in issue today', `${fmtNum(inputs.shares, 3)}bn`], ['Share price used for the raise', fmtMoney(inputs.price, c.ccy)],
       ['Net debt', fmtCap(inputs.netDebt, c.ccy)], ['Reporting currency', c.ccy]]
    : inputs.model === 'scenario'
    ? [['Starting operating margin', fmtPct(inputs.margin0)], ['Net debt', fmtCap(inputs.netDebt, c.ccy)],
       ['Shares in issue today', `${fmtNum(inputs.shares, 3)}bn`], ['Reporting currency', c.ccy]]
    : inputs.model === 'dcf'
    ? [['Net debt', fmtCap(inputs.netDebt, c.ccy)], ['Shares in issue', `${fmtNum(inputs.shares, 3)}bn`], ['Reporting currency', c.ccy]]
    : inputs.model === 'ri'
    ? [['Payout ratio', inputs.payoutAssumed ? `${fmtPct(inputs.payout, 0)} — assumed, not reported` : fmtPct(inputs.payout, 0)], ['Shares in issue', `${fmtNum(last(d.sh), 3)}bn`], ['Reporting currency', c.ccy]]
    : [['NAV per unit', fmtMoney(inputs.navps, c.ccy)], ['Gearing', fmtPct(inputs.gearing)], ['Capitalisation rate', fmtPct(inputs.cap)]];
  fixedRows.forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, v)); });
  fixed.append(kv);
  rail.append(fixed);

  rail.append(el('button', { class: 'btn btn-primary btn-sm', style: 'width:100%;margin-top:var(--md)',
    onclick: () => saveValuationRun(r, inputs) }, 'Save this valuation run'));
  rail.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'A saved run stores the inputs, the figures they produced, the model version and the as-of date, so replaying it later can be checked against what was saved.'));
  wrap.append(rail);

  redraw();
  wrap.append(out);
  return wrap;
}

/* The editable assumptions the reader has emptied. The model would otherwise
   run on null — NaN through every formula, or a number coerced from nothing —
   so an empty input stops the estimate rather than feeding it. */
function blankAssumptions(r, inputs) {
  return (ASSUMPTIONS[inputs.model] || [])
    .filter(a => (!a.onlyIf || a.onlyIf === r.val.pack.id) && !Number.isFinite(inputs[a.k]));
}

function studioOutputs(r, inputs, redraw) {
  const { c, d } = r;
  const blank = blankAssumptions(r, inputs);
  if (blank.length) {
    const names = blank.map(a => a.label);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return [el('div', { class: 'guardrail',
      html: `<span style="color:var(${SEV_STYLE.critical.v})">${icon('alert')}</span><span>${esc(
        `${list} ${names.length === 1 ? 'is' : 'are'} empty — no estimate. The model is not run on a missing input and the previous value is not reused. Enter a value, or use Reset to return to the derived defaults.`)}</span>` })];
  }
  const run = valuationRun(c, d, inputs);
  const nodes = [];

  /* ---------- guardrails ---------- */
  const warnings = [];
  if (run.err) warnings.push({ sev:'critical', text: run.err });
  /* A bear or bull case its published shift pushed out of bounds. The base
     case still stands, so this is serious rather than critical. */
  (run.caseNotes || []).forEach(text => warnings.push({ sev:'serious', text }));
  if (!run.err && run.base.equityWipedOut && inputs.model !== 'early')
    warnings.push({ sev:'critical', text:'The enterprise value does not cover net debt, so the modelled equity is nil, not negative — a shareholder cannot owe more than the holding. Treat this as a restructuring outcome, not a valuation range.' });
  if (inputs.payoutAssumed)
    warnings.push({ sev:'warning', text:`No payout ratio is reported for the latest year, so the default long-run growth assumes ${fmtPct(inputs.payout, 0)} of earnings is paid out. That figure is an assumption, not a reading — set the growth from your own view of what retained earnings can fund.` });
  if (inputs.dilutionAssumed)
    warnings.push({ sev:'warning', text:'Annual share issuance is assumed at 0.0%: the reported rate was withheld because the share series crosses a corporate action, so the default is an assumption of no issuance rather than a reading. Set it from your own reading of the share count.' });
  if (inputs.model === 'dcf') {
    if (inputs.gt >= inputs.wacc - 0.5 && inputs.gt < inputs.wacc)
      warnings.push({ sev:'serious', text:'Terminal growth is within half a point of the discount rate. The terminal value dominates and the output is unstable — treat the result as indicative only.' });
    if (!run.err && run.base.terminalShare > 78)
      warnings.push({ sev:'warning', text:`${fmtPct(run.base.terminalShare, 0)} of the enterprise value sits in the terminal value. Most of the answer is an assumption about the far future, not a forecast.` });
    if (inputs.g1 > 25)
      warnings.push({ sev:'warning', text:'A year-one growth rate above 25% is being extrapolated. Check that it is supported by the revenue and margin history rather than by a single strong year.' });
  }
  if (inputs.model === 'scenario') {
    if (!run.err && run.base.terminalShare > 78)
      warnings.push({ sev:'warning', text:`${fmtPct(run.base.terminalShare, 0)} of the enterprise value sits in the terminal value. Most of the answer is an assumption about the far future, not a forecast.` });
    if (inputs.margin0 > 0 && inputs.termMargin > inputs.margin0 * 2)
      warnings.push({ sev:'serious', text:`The terminal operating margin of ${fmtPct(inputs.termMargin)} is more than double the current ${fmtPct(inputs.margin0)}. Margin expansion on that scale needs a specific reason, not an extrapolation.` });
    if (inputs.fcfConv > 120)
      warnings.push({ sev:'warning', text:`Cash conversion above 100% means free cash flow exceeds operating profit — usually large non-cash add-backs such as share-based compensation. Check that it persists once the share count effect is accounted for.` });
    if (inputs.revCagr > 30)
      warnings.push({ sev:'warning', text:'A revenue CAGR above 30% is being sustained across the whole explicit period. Very few businesses compound at that rate for this long.' });
    if (inputs.dilution > 2)
      warnings.push({ sev:'warning', text:`Share count is assumed to grow ${fmtPct(inputs.dilution)} a year, which compounds to ${fmtPct((Math.pow(1 + inputs.dilution / 100, inputs.years) - 1) * 100, 0)} more shares by the terminal year.` });
  }
  if (inputs.model === 'insurer') {
    /* Only on a reported figure — a filed insurer carries neither, and `null < 1.5` is true. */
    if (isNum(inputs.combined) && inputs.combined >= 100)
      warnings.push({ sev:'serious', text:`A combined ratio of ${fmtPct(inputs.combined, 1)} means the book loses money on underwriting before investment income. A sustainable return on equity above the cost of equity then depends entirely on the investment portfolio.` });
    if (isNum(inputs.solvency) && inputs.solvency < 1.5)
      warnings.push({ sev:'serious', text:`Solvency of ${fmtX(inputs.solvency, 2)} times required capital leaves little headroom. Capital strain constrains both growth and the dividend.` });
    if (inputs.roe - inputs.coe > 10)
      warnings.push({ sev:'warning', text:'The assumed return on equity exceeds the cost of equity by more than ten points in perpetuity. Insurance pricing cycles rarely allow a spread that wide to persist.' });
  }
  if (inputs.model === 'early') {
    if (!run.err && run.base.equityWipedOut)
      warnings.push({ sev:'critical', text:`Even in the success case the enterprise value does not cover the debt — the modelled equity value is nil, not merely low. Every scenario below is bounded at zero because a shareholder cannot owe more than the holding. Treat this as a restructuring outcome, not a valuation range.` });
    if (inputs.burn > 0 && inputs.cash / inputs.burn < 2)
      warnings.push({ sev:'critical', text:`Cash covers only ${fmtNum(inputs.cash / inputs.burn, 1)} years at the current burn. A raise is required well inside the forecast period, and the dilution assumed here prices it at today's share price — a real raise would very likely price lower.` });
    if (last(r.d.eq) < 0)
      warnings.push({ sev:'critical', text:'Shareholders’ funds are negative. Equity is a residual claim behind the creditors, and a restructuring could leave it worth nothing regardless of what the operating model produces.' });
    if (r.c.flags?.pn17)
      warnings.push({ sev:'critical', text:'This company is classified under PN17. It is subject to a regularisation plan, and the outcome of that plan — not the discounted cash flows — determines what the equity is worth.' });
    if (inputs.pSuccess > 60)
      warnings.push({ sev:'warning', text:`A ${fmtPct(inputs.pSuccess, 0)} probability of success is an optimistic prior for a business that has not yet demonstrated positive cash flow.` });
    if (inputs.termMargin > 20)
      warnings.push({ sev:'warning', text:`A terminal operating margin of ${fmtPct(inputs.termMargin)} has never been earned by this business. It should be justified against a mature peer, not assumed.` });
  }
  if (inputs.model === 'ri') {
    if (inputs.roe - inputs.coe > 8)
      warnings.push({ sev:'warning', text:'The assumed return on equity exceeds the cost of equity by more than eight points in perpetuity. Competition normally erodes a spread that wide.' });
    if (inputs.g > inputs.roe * (1 - (inputs.payout || 50) / 100) + 0.5)
      warnings.push({ sev:'warning', text:'Long-run growth is above what retained earnings can fund at this return on equity and payout ratio. The bank would need to raise capital to grow at this rate.' });
  }
  if (inputs.model === 'ddm') {
    if (isNum(r.m.dpuCover) && r.m.dpuCover < 100)
      warnings.push({ sev:'serious', text:`Recurring income covers only ${fmtPct(r.m.dpuCover, 0)} of the current distribution. Modelling growth from an uncovered base overstates the value.` });
    if (inputs.gearing > 45)
      warnings.push({ sev:'warning', text:'Gearing is close to the regulatory ceiling, which limits debt-funded acquisition — a constraint on the growth assumption.' });
  }
  /* Unit, sign and per-share base checks run for every pack. */
  warnings.push(...consistencyWarnings(c, d, inputs));

  /* Without a market price the cost of capital is weighted on BOOK equity,
     which for a leveraged balance sheet tilts the blend toward cheap debt and
     lowers the discount rate — inflating the value. Too consequential to leave
     in a code comment. */
  if (inputs.waccFromBook)
    warnings.push({ sev:'serious', text:`No market price is attached, so the cost of capital is weighted using book equity of ${fmtCap(last(d.eq), c.ccy)} against debt of ${fmtCap(last(d.debt), c.ccy)} rather than market value. That pulls the discount rate to ${fmtPct(inputs.wacc)} and materially raises the value. Enter a price to weight it properly.` });

  if (r.m.coverage < 80)
    warnings.push({ sev:'warning', text:`Data completeness for this company is ${r.m.coverage}%. Confidence is reduced accordingly rather than the gaps being filled in.` });

  if (warnings.length) {
    const g = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    warnings.forEach(w => g.append(el('div', { class: 'guardrail', style: w.sev === 'critical' ? '' : `background:color-mix(in srgb, var(${SEV_STYLE[w.sev].v}) 10%, transparent);border-color:color-mix(in srgb, var(${SEV_STYLE[w.sev].v}) 32%, transparent)`,
      html: `<span style="color:var(${SEV_STYLE[w.sev].v})">${icon('alert')}</span><span>${esc(w.text)}</span>` })));
    nodes.push(g);
  }
  if (run.err) return nodes;

  /* ---------- headline range ---------- */
  const head = el('div', { class: 'card' });
  head.append(cardHead(`${run.pack.name} — value per share`, run.pack.why,
    el('div', { style: 'text-align:right' }, [
      el('div', { class: 'row', style: 'gap:6px;justify-content:flex-end' }, [
        el('span', { class: 'chip' }, `${run.confBand} confidence`),
        el('span', { class: 'chip' }, `${run.conf}/100`),
      ]),
    ])));
  head.append(rangeStrip(run.vals.bear, run.vals.base, run.vals.bull, c.px.p, c.ccy));
  const grid = el('div', { class: 'grid g-4', style: 'margin-top:var(--lg)' });
  [['Bear', run.vals.bear, run.mos?.bear], ['Base', run.vals.base, run.mos?.base], ['Bull', run.vals.bull, run.mos?.bull]].forEach(([label, v, mos]) => {
    const p = el('div', { class: 'panel' });
    p.append(el('div', { class: 'stat-label' }, `${label} case`));
    p.append(el('div', { class: 'num', style: 'font-size:20px;font-weight:700;margin:2px 0' }, fmtMoney(v, c.ccy)));
    p.append(el('div', { class: 'num ' + diffClass(mos), style: 'font-size:12px;font-weight:600' },
        !isNum(v) ? 'not computable — see above' : isNum(mos) ? `${withSign(mos, 1)} vs price` : 'no price to compare'));
    grid.append(p);
  });
  const pp = el('div', { class: 'panel', style: 'border-color:color-mix(in srgb, var(--s2) 40%, transparent)' });
  pp.append(el('div', { class: 'stat-label' }, c.pricePersonal ? 'Price (your note)' : c.px?.manual ? 'Price (entered by you)' : c.real ? 'Market price' : 'Sample price'));
  pp.append(el('div', { class: 'num', style: 'font-size:20px;font-weight:700;margin:2px 0;color:var(--s2-text)' }, fmtMoney(c.px.p, c.ccy)));
  /* The same stamp the provenance strip uses, so one page cannot date a
     price two ways — and a filed company with no price no longer gets a
     "close" under a dash. */
  pp.append(el('div', { class: 'metaline' }, priceAsOfLabel(c)));
  grid.append(pp);
  head.append(grid);

  /* Both shifts printed as they are applied. The bull case was described as
     "the mirror image" of the bear, but SCENARIO_SHIFT sets it smaller on the
     rate inputs (a discount rate −1.0 against +1.2, for one) — so the
     published construction misstated what the model does. */
  const shiftText = (s) => Object.entries(s).map(([k, v]) => `${k} ${withSign(v, 1, '')}`).join(', ');
  head.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `Scenario construction is published, not hidden: the bear case applies ${shiftText(run.shift.bear)} to the base assumptions, and the bull case applies ${shiftText(run.shift.bull)}.`));
  nodes.push(head);

  /* ---------- driver impact ---------- */
  const drivers = driverImpact(c, d, inputs);
  const dr = el('div', { class: 'card' });
  dr.append(cardHead('Which assumptions actually move the answer',
    'Each bar is the change in the base-case model estimate per share when that one assumption is stepped up and down, holding the others fixed. Ranked by the size of the effect.'));
  const dh = el('div', { style: 'width:100%' });
  dr.append(dh);
  dr.append(el('div', { class: 'legend', style: 'margin-top:var(--sm)' }, [
    el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(--up-4)"></span>Increases value` }),
    el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(--dn-4)"></span>Decreases value` }),
  ]));
  dr.append(tableTwin('Show the table view', ['Assumption', 'Step', 'Value if higher', 'Value if lower'],
    drivers.map(x => [x.label, x.unit === 'pp' ? `±${fmtNum(x.step, 2)} pp` : `±${x.unit}`, withSign(x.hi, 1), withSign(x.lo, 1)])));
  nodes.push(dr);
  queueMicrotask(() => tornadoChart(dh, { drivers }));

  /* ---------- sensitivity ---------- */
  const ax = SENS_AXES[inputs.model];
  const grid2 = sensitivityGrid(inputs);
  const sens = el('div', { class: 'card' });
  sens.append(cardHead('Sensitivity',
    `Value per share across ${ax.x.label.toLowerCase()} and ${ax.y.label.toLowerCase()}. The outlined cell is the current base case; the fill shows the implied premium or discount to the market price.`));
  const sh2 = el('div', { style: 'width:100%;overflow-x:auto' });
  sens.append(sh2);
  /* The same bounded axis values the grid was computed on (sensAxis). */
  const xAxis = sensAxis(ax.x, inputs), yAxis = sensAxis(ax.y, inputs);
  const xSteps = xAxis.values.map(ax.x.fmt);
  const ySteps = yAxis.values.map(ax.y.fmt);
  sens.append(tableTwin('Show the table view', [ax.y.label + ' \\ ' + ax.x.label, ...xSteps],
    grid2.map((row, i) => [ySteps[i], ...row.map(v => isNum(v) ? fmtMoney(v, c.ccy) : 'n/a')])));
  nodes.push(sens);
  queueMicrotask(() => matrixChart(sh2, { grid: grid2, xSteps, ySteps, xLabel: ax.x.label, yLabel: ax.y.label, baseCol: xAxis.baseIndex, baseRow: yAxis.baseIndex,
    base: run.vals.base, price: c.px.p, fmt: v => fmtMoney(v, c.ccy, c.px.p < 20 ? 2 : 0) }));

  /* ---------- value bridge ---------- */
  const bridge = el('div', { class: 'card' });
  bridge.append(cardHead('What makes up the base-case model estimate',
    'The composition of the value per share. It shows where the answer comes from — which is usually more useful than the answer.'));
  const bh = el('div', { style: 'width:100%' });
  bridge.append(bh);
  let steps;
  if (inputs.model === 'dcf') {
    const sh3 = inputs.shares;
    steps = [
      { short:'Forecast', label:`Present value of the ${inputs.years}-year explicit forecast`, value:run.base.pvExplicit / sh3 },
      { short:'Terminal', label:'Present value of the terminal value', value:run.base.pvTerminal / sh3 },
      { short:'Net debt', label:'Less net debt', value:-run.base.netDebt / sh3 },
      ...(run.base.hold ? [{ short:'Holdco', label:`Less the ${run.base.hold}% holding-company discount`, value:-run.base.holdDiscount / sh3 }] : []),
      { short:'Base', label:'Base-case model estimate per share', value:run.vals.base, total:true },
    ];
  } else if (inputs.model === 'scenario') {
    const sh4 = run.base.shares;
    steps = [
      { short:'Forecast', label:`Present value of the ${inputs.years}-year explicit forecast`, value:run.base.pvExplicit / sh4 },
      { short:'Terminal', label:'Present value of the terminal value', value:run.base.pvTerminal / sh4 },
      { short:'Net debt', label:'Less net debt', value:-run.base.netDebt / sh4 },
      { short:'Dilution', label:`Effect of ${fmtPct(inputs.dilution)} annual share issuance over ${inputs.years} years`,
        value:run.vals.base - run.base.undilutedPerShare },
      { short:'Base', label:'Base-case model estimate per share', value:run.vals.base, total:true },
    ];
  } else if (inputs.model === 'early') {
    steps = [
      { short:'Success', label:`Success case before dilution, at ${fmtPct(inputs.pSuccess, 0)} probability`, value:run.base.equity / run.base.shares },
      { short:'Dilution', label:`Less dilution from raising ${fmtCap(run.base.need, c.ccy)}`, value:run.base.successPerShare - run.base.equity / run.base.shares },
      { short:'Weighted', label:'Probability-weighted against the downside floor', value:run.vals.base - run.base.successPerShare },
      { short:'Base', label:'Base-case model estimate per share', value:run.vals.base, total:true },
    ];
  } else if (inputs.model === 'insurer' || inputs.model === 'ri') {
    steps = [
      { short:'Book', label:'Book value per share', value:run.base.bvps },
      { short:'Excess', label:'Present value of returns above the cost of equity', value:run.base.riPremium },
      { short:'Base', label:'Base-case model estimate per share', value:run.vals.base, total:true },
    ];
  } else {
    const noGrowth = inputs.dpu / (inputs.req / 100);
    steps = [
      { short:'Income', label:'Current distribution capitalised with no growth', value:noGrowth },
      { short:'Growth', label:'Value added by the distribution growth assumption', value:run.vals.base - noGrowth },
      { short:'Base', label:'Base-case model estimate per unit', value:run.vals.base, total:true },
    ];
  }
  bridge.append(tableTwin('Show the table view', ['Component', 'Per share'],
    steps.map(s => [s.label, fmtMoney(s.total ? s.value : s.value, c.ccy)])));
  if (inputs.model === 'dcf' || inputs.model === 'scenario') bridge.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `${fmtPct(run.base.terminalShare, 0)} of the enterprise value sits in the terminal value.`));
  nodes.push(bridge);
  queueMicrotask(() => waterfallChart(bh, { steps, fmt: v => fmtMoney(v, c.ccy, c.px.p < 20 ? 2 : 0), ccy: c.ccy }));

  /* ---------- forecast table & model notes ---------- */
  if (inputs.model === 'scenario') {
    const ft = el('div', { class: 'card' });
    ft.append(cardHead('Explicit forecast', 'Revenue, the margin applied to it, and the cash flow the model is actually discounting.'));
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Year', 'Revenue growth', `Revenue (${c.ccy}bn)`, 'Operating margin', `Free cash flow (${c.ccy}bn)`, 'Discount factor', `Present value (${c.ccy}bn)`].map(h => el('th', {}, h)))));
    t.append(el('tbody', {}, run.base.flows.map(f => el('tr', {}, [
      el('td', { class: 'ident' }, `Year ${f.t}`), el('td', {}, fmtPct(f.g, 2)), el('td', {}, fmtNum(f.rev, 2)),
      el('td', {}, fmtPct(f.mgn, 1)), el('td', {}, fmtNum(f.fcf, 2)),
      el('td', {}, (1 / Math.pow(1 + inputs.wacc / 100, f.t)).toFixed(3)), el('td', {}, fmtNum(f.pv, 2)),
    ]))));
    tw.append(t); ft.append(tw);
    ft.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `Share count grows from ${fmtNum(run.base.shares, 3)}bn to ${fmtNum(run.base.dilutedShares, 3)}bn over the forecast at the assumed issuance rate.`));
    nodes.push(ft);
  }

  if (inputs.model === 'dcf') {
    const ft = el('div', { class: 'card' });
    ft.append(cardHead('Explicit forecast', 'The cash flows the model is actually discounting.'));
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Year', 'Growth applied', `Free cash flow (${c.ccy}bn)`, 'Discount factor', `Present value (${c.ccy}bn)`].map(h => el('th', {}, h)))));
    t.append(el('tbody', {}, run.base.flows.map(f => el('tr', {}, [
      el('td', { class: 'ident' }, `Year ${f.t}`), el('td', {}, fmtPct(f.g, 2)), el('td', {}, fmtNum(f.fcf, 2)),
      el('td', {}, (1 / Math.pow(1 + inputs.wacc / 100, f.t)).toFixed(3)), el('td', {}, fmtNum(f.pv, 2)),
    ]))));
    tw.append(t); ft.append(tw);
    nodes.push(ft);
  }

  /* ---------- the nine methods ---------- */
  const nm = nineMethods(r);
  const applicable = nm.filter(x => isNum(x.value));
  const nineCard = el('div', { class: 'card' });
  nineCard.append(cardHead(`All nine methods — ${applicable.length} applicable to ${c.tk}`,
    'The router selects one primary model, but every method is computed. Where a method does not fit this business it says so rather than producing a number. Wide disagreement between methods is information, not an error.'));
  const ntw = el('div', { class: 'tablewrap' });
  const nt = el('table', { class: 'dt' });
  nt.append(el('thead', {}, el('tr', {}, ['#', 'Method', 'Value per share', 'vs price', 'Basis'].map(h => el('th', {}, h)))));
  nt.append(el('tbody', {}, nm.map(x => {
    const mos = isNum(x.value) ? (x.value - c.px.p) / c.px.p * 100 : null;
    /* The engine marks the primary row; matching on the pack's name missed every
       pack that is a variant of its method (holding company, insurer, early stage). */
    const isPrimary = x.primary && isNum(x.value);
    return el('tr', isPrimary ? { style: 'background:color-mix(in srgb, var(--brand) 7%, transparent)' } : {}, [
      el('td', { class: 'ident' }, String(x.n)),
      el('td', { style: 'text-align:left;white-space:normal', class: 'ident' },
        x.primary ? `${x.name} · primary` : x.name),
      el('td', { html: isNum(x.value) ? fmtMoney(x.value, c.ccy) : NA }),
      el('td', { class: diffClass(mos), html: isNum(mos) ? withSign(mos, 0) : '<span class="caption">—</span>' }),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal;max-width:320px' }, x.why),
    ]);
  })));
  ntw.append(nt); nineCard.append(ntw);
  if (applicable.length >= 3) {
    const vals = applicable.map(x => x.value);
    nineCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      /* No price clause without a price: "against a market price of —" read
         as a sentence about a price that does not exist. */
      `Applicable methods span ${fmtMoney(Math.min(...vals), c.ccy)} to ${fmtMoney(Math.max(...vals), c.ccy)}, with a median of ${fmtMoney(median(vals), c.ccy)}${isNum(c.px?.p) ? ` against a market price of ${fmtMoney(c.px.p, c.ccy)}` : ''}. A spread this wide is normal — the methods answer different questions.`));
  }
  nodes.push(nineCard);

  const notes = el('div', { class: 'card' });
  notes.append(cardHead('Model pack, cross-checks and limitations', null));
  notes.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Secondary checks that should agree'));
  const sec = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:var(--md)' });
  run.pack.secondary.forEach(s2 => sec.append(el('span', { class: 'chip' }, s2)));
  notes.append(sec);
  const cross = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  const crossRows = inputs.model === 'insurer'
    ? [['Combined ratio', isNum(inputs.combined) ? fmtPct(inputs.combined, 1) : 'not reported'],
       ['Underwriting result', !isNum(inputs.combined) ? 'Not known — no combined ratio is reported' : inputs.combined < 100 ? 'Profitable before investment income' : 'Loss-making before investment income'],
       ['Solvency, times required capital', isNum(inputs.solvency) ? fmtX(inputs.solvency, 2) : 'not reported'],
       ['Justified price / book', fmtX(run.base.justifiedPB, 2)],
       ['Current price / book', fmtX(r.m.pb, 2)],
       ['ROE less cost of equity', `${withSign(run.base.spread, 1)} points`]]
    : inputs.model === 'early'
    ? [['Success case per share', fmtMoney(run.base.successPerShare, c.ccy)],
       ['Downside floor per share', fmtMoney(run.base.floor, c.ccy)],
       ['Financing needed before break-even', fmtCap(run.base.need, c.ccy)],
       ['Implied dilution', fmtPct(run.base.dilution, 1)],
       ['Years to positive cash flow', String(run.base.yearsToBreakeven)],
       ['Cash runway at the current burn', inputs.burn > 0 ? `${fmtNum(inputs.cash / inputs.burn, 1)} years` : 'n/a']]
    : inputs.model === 'ri'
    ? [['Justified price / book', fmtX(run.base.justifiedPB, 2)], ['Current price / book', fmtX(r.m.pb, 2)],
       ['ROE less cost of equity', `${withSign(run.base.spread, 1)} points`], ['Reported ROE', fmtPct(r.m.roe)]]
    : inputs.model === 'ddm'
    ? [['Implied distribution yield at base-case model estimate', fmtPct(run.base.impliedYield, 2)], ['Current distribution yield', fmtPct(r.m.dy, 2)],
       ['Implied price / NAV', fmtX(run.base.pnav, 2)], ['Portfolio capitalisation rate', fmtPct(inputs.cap)]]
    : inputs.model === 'scenario'
    ? [['Implied EV / revenue at base-case model estimate', fmtX(run.base.ev / last(d.rev), 1)],
       ['Current EV / revenue', isNum(r.m.ev) && last(d.rev) > 0 ? fmtX(r.m.ev / last(d.rev), 1) : 'n/a — no enterprise value without a price'],
       ['Terminal-year revenue', fmtCap(run.base.terminalRevenue, c.ccy)],
       ['Base-case EV against terminal-year operating profit', fmtX(run.base.ev / (run.base.terminalRevenue * inputs.termMargin / 100), 1)],
       ['Revenue CAGR assumed vs last four years', `${fmtPct(inputs.revCagr)} vs ${isNum(r.m.rev5) ? fmtPct(r.m.rev5) : 'n/m'}`]]
    : [['Implied EV / EBIT at base-case model estimate', fmtX((run.base.ev) / last(d.ebit), 1)], ['Current EV / EBIT', isNum(r.m.evebit) ? fmtX(r.m.evebit) : 'n/a'],
       ['Implied price / earnings', isNum(r.m.eps) && r.m.eps > 0 ? fmtX(run.vals.base / r.m.eps) : 'n/m'], ['Current free cash flow yield', fmtPct(r.m.fcfy, 2)]];
  crossRows.forEach(([k, v]) => { cross.append(el('dt', {}, k)); cross.append(el('dd', {}, v)); });
  notes.append(cross);
  notes.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Limitations of this pack'));
  const lim = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  run.pack.limits.forEach(l => lim.append(el('div', { class: 'evidence counter', style: 'font-size:13px' }, l)));
  notes.append(lim);
  notes.append(el('div', { style: 'margin-top:var(--md)' }, provenance(r, [`<b>Run</b> ${MODEL_VERSION.split('·')[2].trim()}`])));
  nodes.push(notes);

  return nodes;
}

function saveValuationRun(r, inputs) {
  const blank = blankAssumptions(r, inputs);
  if (blank.length) { toast(`${blank[0].label} is empty — a run with a missing input cannot be saved`); return; }
  const runs = store.read('runs', []);
  /* The output is stored with the inputs. A run that kept only its inputs
     could claim to reproduce its output but never check it: the replay had
     nothing to be compared with. With the figures kept, the drawer compares
     them instead of asserting it. */
  const out = valuationRun(r.c, r.d, inputs);
  const run = { runId: `run-${r.c.id}-${runs.length + 1}`, id:r.c.id, ticker:r.c.tk,
                inputs:{ ...inputs }, pack:r.val.pack.name,
                vals: out.vals ? { ...out.vals } : null,
                asOf:AS_OF, model:MODEL_VERSION, saved:new Date().toISOString().slice(0, 10) };
  runs.unshift(run);
  store.write('runs', runs.slice(0, 50));

  /* A thesis is supposed to reference a saved run rather than a remembered
     number, so attaching is offered at the moment the run is saved. */
  const t = State.theses.find(x => x.ticker === r.c.id);
  if (t) {
    t.runRef = run.runId;
    saveTheses();
    toast(`Saved and attached to your ${r.c.tk} thesis — reproducible from these inputs`);
  } else {
    toast(`Saved — ${r.c.tk} valuation run, reproducible from these inputs`);
  }
  render();
}

/* Re-run a saved run's stored inputs through the current model and compare
   the result with the figures saved alongside them. If they differ, the
   drawer shows both — which is exactly what Epic E asks the product to be
   able to show. */
function openSavedRun(t) {
  const run = (store.read('runs', []) || []).find(x => x.runId === t.runRef);
  const r = BY_ID.get(t.ticker);
  const body = el('div');
  if (!run || !r) {
    body.append(el('p', { class: 'body' }, !run ? 'The saved run this thesis referenced is no longer in local storage.'
      : `The saved run names ${t.ticker}, which is not in the universe loaded now, so it cannot be replayed.`));
    openDrawer('Saved valuation run', body); return;
  }
  const replay = valuationRun(r.c, r.d, run.inputs);
  body.append(el('h3', { class: 'h-section', style: 'margin-bottom:2px' }, `${run.ticker} — ${run.pack}`));
  body.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' },
    `Run ${run.runId} · saved ${run.saved} · as of ${run.asOf} · ${run.model}`));

  /* Replayed figures beside the saved ones, and the comparison made rather
     than asserted. Runs saved before the output was stored have nothing to
     compare with, and say so. */
  const saved = run.vals && typeof run.vals === 'object' ? run.vals : null;
  const same = (a, b) => isNum(a) && isNum(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const reproduced = !!(saved && replay.vals && ['bear', 'base', 'bull'].every(k => same(replay.vals[k], saved[k])));
  const g = el('div', { class: 'grid g-3', style: 'margin-bottom:var(--md)' });
  [['Bear', 'bear'], ['Base', 'base'], ['Bull', 'bull']].forEach(([l, k]) => {
    const v = replay.vals?.[k];
    g.append(el('div', { class: 'panel' }, statTile(`${l} · replayed`, isNum(v) ? fmtMoney(v, r.c.ccy) : '—',
      { sub: saved ? `Saved ${isNum(saved[k]) ? fmtMoney(saved[k], r.c.ccy) : '—'}` : 'Not stored with this run' })));
  });
  body.append(g);

  body.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Stored inputs'));
  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  Object.entries(run.inputs).filter(([k]) => k !== 'model').forEach(([k, v]) => {
    kv.append(el('dt', {}, k)); kv.append(el('dd', {}, isNum(v) ? fmtNum(v, 2) : String(v)));
  });
  body.append(kv);

  const modelNote = run.model === MODEL_VERSION ? ''
    : ` It was saved under ${run.model}; the current version is ${MODEL_VERSION}.`;
  body.append(el('div', { class: reproduced ? 'evidence support' : 'guardrail', style: 'font-size:13px' },
    reproduced
      ? `Replaying the stored inputs through the current model gives the saved figures exactly — compared figure by figure, not assumed.${modelNote}`
      : saved
      ? `Replaying the stored inputs gives different figures from the ones saved with this run.${modelNote || ' The model version is the same, so the difference is not explained by a model change.'}`
      : `This run was saved without its output figures, so the replay above cannot be checked against what was originally shown.${modelNote}`));
  /* The replay reuses the stored inputs, so a newer data date does not change
     it — but the inputs were derived from the older data, and the Studio's
     defaults for this company today would not be the same. */
  if (run.asOf !== AS_OF)
    body.append(el('div', { class: 'guardrail', style: 'font-size:13px;margin-top:8px' },
      `The inputs were derived from data as of ${run.asOf}; the data loaded now is as of ${AS_OF}. The replay uses the stored inputs unchanged, so it does not reflect anything reported since.`));

  body.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:var(--md)',
    onclick: () => { State.valuation[t.ticker] = { ...run.inputs }; closeDrawer(); openResearch(t.ticker, 'valuation'); } },
    'Load these inputs into the Studio'));
  openDrawer('Saved valuation run', body);
}

/* ==========================================================================
   THESIS — builder, monitor, decision journal
   ========================================================================== */

function seedTheses() {
  return [
    { id:'t1', ticker:'MAYBANK', oneLine:'A low-cost deposit franchise that should sustain a mid-teens return on equity while paying most of it out.',
      quality:'CASA of 36.5% funds the book below peers, and the domestic branch network is not economically replicable at current returns.',
      valCase:'Residual income on a 12.5% sustainable ROE against a 9.0% cost of equity supports a justified price-to-book above the current multiple.',
      catalysts:['Net interest margin stabilising as the rate cycle turns', 'Loan growth returning to nominal GDP', 'Credit costs normalising below the guided range'],
      risks:['Regional credit variance from the Indonesian book', 'Payout near the top of policy leaves less retained capital'],
      conds:[
        { type:'metric', k:'roe', op:'<', v:10, label:'Return on equity falls below 10%' },
        { type:'metric', k:'npl', op:'>', v:2.2, label:'Gross impaired loans rise above 2.2%' },
        { type:'metric', k:'cet1', op:'<', v:13.5, label:'CET1 falls below 13.5%' },
        { type:'val', op:'>', v:15, label:'Price moves more than 15% above the base-case model estimate' },
      ],
      horizon:'3–5 years', review:'2026-10-30', conf:'Medium',
      questions:['How much of the margin improvement is structural rather than cyclical?', 'What is the through-cycle credit cost for the Indonesian book?'],
      created:'2026-05-14' },
    { id:'t2', ticker:'AXREIT', oneLine:'Industrial rent reversion is real, but unit issuance has been absorbing most of it — the test is distribution per unit, not total distributions.',
      quality:'Logistics demand supports positive reversion; the assets themselves are replicable, so the moat rating is deliberately low.',
      valCase:'Distribution discount model on a 2% growth assumption against a required return near 8% leaves little difference to model estimate at the current unit price.',
      catalysts:['A full year without a placement', 'Occupancy recovering above 96%'],
      risks:['Continued unit issuance diluting distribution per unit', 'Gearing rising toward the ceiling'],
      conds:[
        { type:'metric', k:'dilution', op:'>', v:3, label:'Unit count grows more than 3% a year' },
        { type:'metric', k:'gearing', op:'>', v:40, label:'Gearing exceeds 40%' },
        { type:'metric', k:'occ', op:'<', v:92, label:'Occupancy falls below 92%' },
      ],
      horizon:'2–3 years', review:'2026-08-15', conf:'Low',
      questions:['Is distribution per unit growing once issuance is accounted for?'],
      created:'2026-06-02' },
  ];
}
if (!State.theses) { State.theses = seedTheses(); store.write('theses', State.theses); }

function saveTheses() { store.write('theses', State.theses); }

/* A condition state, never an action. "Holding" was the previous label for a
   condition inside its threshold, which reads as a hold recommendation and
   contradicts this product's own terminology — and section 2 forbids buy, hold
   and sell language in the public research interface regardless of what the
   surrounding paragraph says. */
/* Within a tenth of the threshold, on the side that would breach it. */
const APPROACH_MARGIN = 0.10;

/* The rule each label follows, carried on the label itself rather than left in
   the code. A reader shown "Approaching threshold" against an ROE of 10.3% on a
   10% floor can see it is 0.3 points away and that 0.3 is inside a tenth of the
   threshold — without that, the label is a judgement they cannot check. */
const CONDITION_STATES = {
  breached:    { label:'Breached',              sev:'serious',
                 rule:'The condition evaluates true on the current value.' },
  approaching: { label:'Approaching threshold', sev:'warning',
                 rule:`Not breached, but within ${Math.round(APPROACH_MARGIN * 100)}% of the threshold value, measured as |actual − threshold| ÷ |threshold|.` },
  within:      { label:'Within threshold',      sev:'good',
                 rule:`Not breached, and further than ${Math.round(APPROACH_MARGIN * 100)}% of the threshold value away from it.` },
  unavailable: { label:'Data unavailable',      sev:'muted',
                 rule:'The condition is bound to no metric this build carries, so it has no source and is never treated as passing.' },
  awaiting:    { label:'Awaiting update',       sev:'muted',
                 rule:'The metric exists in this build but has no current value. Not treated as passing.' },
  stale:       { label:'Data stale',            sev:'warning',
                 rule:'A value exists and was evaluated, but the statements behind it are old enough that a newer report should already have been published. Not treated as passing.' },
};

/* How far behind the accounts are.
   ---------------------------------------------------------------------------
   A condition can be evaluated against a real figure and still be answering
   last year's question. Bursa gives listed issuers four months from year end to
   publish an annual report and the SEC gives large filers sixty days, so a
   company whose most recent fiscal year ended more than eighteen months ago is
   not merely un-updated — a newer report exists somewhere and this build does
   not have it. Eighteen months is that publishing deadline plus a full year,
   which is the point at which "not yet filed" stops being the explanation. */
const STALE_AFTER_MONTHS = 18;

/* How old a company's statements are, in months. Per company: the age of
   Apple's September year-end is not the age of Microsoft's June one, and a
   universe-wide "newest fiscal year anywhere" put every thesis at 0 months
   old the moment ten filers carried FY2026. With no company given — the
   rule table's universe-wide sentence — the OLDEST statements loaded, which
   is the conservative figure for a sentence about all of them. */
function dataAgeMonths(c = null) {
  const ageOf = (co) => {
    const fy = latestFy(co);
    if (!Number.isFinite(fy)) return null;
    /* The recorded year-end where the ingest kept it; otherwise the end of
       the calendar year, approximate by construction, and the threshold is
       wide enough that the approximation cannot decide the answer. */
    const iso = fyEndOf(co, fy);
    const end = iso ? new Date(iso + 'T00:00:00Z') : new Date(Date.UTC(fy, 11, 31));
    const months = (Date.now() - end.getTime()) / (86400000 * 30.44);
    return Number.isFinite(months) ? Math.max(0, Math.round(months)) : null;
  };
  if (c) return ageOf(c);
  const ages = U.map(r => ageOf(r.c)).filter(isNum);
  return ages.length ? Math.max(...ages) : null;
}

/* The proximity itself, so the label can be inspected rather than trusted.
   Returns null where there is nothing to measure — no value, or a zero
   threshold, against which a relative distance is undefined rather than
   infinite. */
function conditionDistance(cd) {
  if (!isNum(cd.actual) || !isNum(cd.v) || cd.v === 0) return null;
  const abs = cd.actual - cd.v;
  return { abs, rel: Math.abs(abs) / Math.abs(cd.v) };
}

/* The gap between two percentages is measured in percentage POINTS, not in
   percent. The distance cell used to print both meanings with the same sign —
   "0.3% · 2.7% of threshold" — where the first is 0.3 points of ROE and the
   second is a proportion of the threshold. Two different quantities wearing one
   symbol, in a cell whose whole job is to let a reader check a label.

   Detected from the formatter's own output rather than from a flag on the
   field, so a metric added later is covered without anyone remembering to mark
   it. A multiple or a count keeps its own formatting: the distance between 4.3x
   and 5.0x is 0.7x, not 0.7 points. */
function formatConditionGap(magnitude, fmt) {
  const sample = String(fmt(magnitude));
  return /%\s*$/.test(sample) ? `${sample.replace(/%\s*$/, '')}pp` : sample;
}

function conditionState(cd) {
  if (cd.actual == null) {
    /* A condition bound to a metric this build carries, but with no current
       value, is waiting for data. One bound to nothing never had a source. */
    return (cd.k || cd.type === 'val') ? CONDITION_STATES.awaiting : CONDITION_STATES.unavailable;
  }
  /* A breach is reported even on old statements — it is the one answer that
     does not become safer for being out of date. Everything short of a breach
     is reported as stale instead, because "within threshold" on an eighteen-
     month-old figure is a claim about a period that has since closed. */
  if (cd.hit) return CONDITION_STATES.breached;
  const age = dataAgeMonths(cd.c || null);
  if (isNum(age) && age > STALE_AFTER_MONTHS) return CONDITION_STATES.stale;
  const dist = conditionDistance(cd);
  if (dist && dist.rel <= APPROACH_MARGIN) return CONDITION_STATES.approaching;
  return CONDITION_STATES.within;
}

function evaluateThesis(t) {
  const r = BY_ID.get(t.ticker);
  if (!r) return { breaches: [], ok: [] };
  const breaches = [], ok = [];
  t.conds.forEach(cd => {
    let actual, label = cd.label;
    /* No model difference — every unpriced filer — is no value, not a value
       of nought: `?? 0` reported "within threshold, 0.0%" on a condition that
       could not be evaluated, and fired the opposite condition as breached. */
    /* The premium of the price over the base-case estimate, measured against
       the estimate — which is what "X% above the estimate" says. It was read
       as −mos.base, which divides by the price: a price exactly 15% above the
       estimate scored 13.0% and the condition breached only at 17.6%. */
    if (cd.type === 'val') {
      const base = r.val.vals?.base, price = r.val.price;
      actual = isNum(base) && base > 0 && isNum(price) ? (price - base) / base * 100 : null;
    }
    else actual = r.m[cd.k];
    if (!isNum(actual)) { ok.push({ ...cd, actual: null, c: r.c, note: 'Input not available — condition cannot be evaluated, and is not treated as passing.' }); return; }
    const hit = cd.op === '<' ? actual < cd.v : actual > cd.v;
    (hit ? breaches : ok).push({ ...cd, actual, c: r.c });
  });
  return { breaches, ok, row: r };
}

function addToThesis(id) {
  const existing = State.theses.find(t => t.ticker === id);
  if (existing) { go('thesis'); toast(`${id} already has a thesis — opened`); return; }
  const r = BY_ID.get(id);
  State.theses = [...State.theses, {
    id: 't' + Date.now(), ticker: id, oneLine: '', quality: '', valCase: '',
    catalysts: [], risks: r.flags.filter(f => f.sev !== 'good').slice(0, 2).map(f => f.title),
    conds: [{ type:'val', op:'>', v:15, label:'Price moves more than 15% above the base-case model estimate' }],
    /* Ninety days from creation. A fixed '2026-10-30' became a review date
       already in the past for any thesis started after it. */
    horizon: '3–5 years', review: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), conf: 'Low', questions: [],
    created: new Date().toISOString().slice(0, 10),
  }];
  saveTheses();
  go('thesis');
  toast(`Draft thesis created for ${r.c.tk}`);
}

/* An original seven-step review. Each step reports a status computed from the
   work actually done in the product, so it tracks progress rather than acting
   as a checklist the reader ticks themselves.

   Each Go navigates to the tab's address, as a tab click does. Setting
   State.researchTab and re-rendering switched the panel while the address kept
   ?tab=thesis, so a reload, Back or a copied link went to the wrong tab. */
function sevenSteps(r, t) {
  const { c, d, m } = r;
  const wacc = isNum(r.inputs.wacc) ? r.inputs.wacc : null;
  const moatRead = (c.moat.support?.length || 0) + (c.moat.counter?.length || 0);
  return [
    { n:1, title:'Understand what the business sells',
      ok: (c.seg || []).length >= 2,
      note: (c.seg || []).length >= 2
        ? `${c.seg.length} reported segments, largest ${c.seg[0][0]} at ${c.seg[0][1]}% of revenue.`
        : 'Segment disclosure is thin for this company — the revenue mix cannot be broken down.',
      go: () => openResearch(c.id, 'business') },
    { n:2, title:'Check it can survive a bad year',
      ok: r.scores.strength.score >= 50,
      note: `Financial Strength ${r.scores.strength.score}/100${isNum(m.ndEbit) ? `, net debt ${fmtX(m.ndEbit)} EBIT` : ''}. ${r.flags.filter(f => f.sev === 'serious' || f.sev === 'critical').length} serious flag(s).`,
      go: () => openResearch(c.id, 'risks') },
    { n:3, title:'Judge the quality of the returns',
      ok: r.scores.quality.score >= 50,
      note: `Business Quality ${r.scores.quality.score}/100${isNum(m.roic) && isNum(wacc) ? `, return on invested capital ${fmtPct(m.roic)} against a ${fmtPct(wacc)} cost of capital` : ''}.`,
      go: () => openResearch(c.id, 'quality') },
    { n:4, title:'Test whether the advantage lasts',
      ok: moatRead >= 2 && c.moat.conf !== 'Low',
      note: `${c.moat.kind}, ${c.moat.conf.toLowerCase()} confidence, durability ${c.moat.dur.toLowerCase()}. ${c.moat.counter.length} piece(s) of counter-evidence.`,
      go: () => openResearch(c.id, 'moat') },
    { n:5, title:'Value it with a model that fits',
      ok: r.val.confBand !== 'Low' && !r.val.err,
      note: `${r.val.pack.name}, ${r.val.confBand.toLowerCase()} confidence${r.val.mos ? `, ${withSign(r.val.mos.base, 0)} against the base case` : ''}.`,
      go: () => openResearch(c.id, 'valuation') },
    { n:6, title:'Write down what would prove you wrong',
      ok: !!(t && t.conds?.length && t.oneLine),
      note: t ? `${t.conds.length} invalidation condition(s)${t.oneLine ? '' : ', but no investment case written yet'}.`
              : 'No thesis written for this company yet.',
      go: () => openResearch(c.id, 'thesis') },
    /* A review date that has passed is a check that was missed, not one that
       is scheduled — so it no longer satisfies the step. */
    { n:7, title:'Set when you will check again',
      ok: !!(t && t.review) && t.review >= new Date().toISOString().slice(0, 10),
      note: !t?.review ? 'No review date set.'
        : t.review < new Date().toISOString().slice(0, 10) ? `The review date ${t.review} has passed. Set the next one.`
        : `Next review ${t.review}, horizon ${t.horizon}.`,
      go: () => openResearch(c.id, 'thesis') },
  ];
}

function sevenStepCard(r, t) {
  const steps = sevenSteps(r, t);
  const done = steps.filter(s => s.ok).length;
  const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  card.append(cardHead(`Seven-step review — ${done} of 7 satisfied`,
    'An original review sequence. Each step reports a status computed from the work done in the product, so it reflects what has actually been checked rather than what has been ticked.'));
  const bar = el('div', { class: 'pillbar', style: 'height:8px;margin-bottom:var(--md)' });
  steps.forEach(s => bar.append(el('i', { style: `width:${100 / 7}%;background:var(${s.ok ? '--ok' : '--line-2'})`, title: s.title })));
  card.append(bar);
  const list = el('div');
  steps.forEach((s, i) => {
    const row = el('div', { class: 'row row-wrap', style: `gap:10px;padding:9px 0;${i ? 'border-top:1px solid var(--grid)' : ''}` });
    row.append(el('span', { style: `width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;font-weight:700;background:${s.ok ? 'color-mix(in srgb, var(--ok) 16%, transparent)' : 'var(--surface-sunk)'};color:${s.ok ? 'var(--ok-text)' : 'var(--ink-3)'}` }, String(s.n)));
    const body = el('div', { style: 'flex:1 1 260px;min-width:0' });
    body.append(el('div', { style: 'font-size:13px;font-weight:600' }, s.title));
    body.append(el('p', { class: 'caption', style: 'margin-top:1px' }, s.note));
    row.append(body);
    row.append(s.ok ? sevChip('good', 'Satisfied') : sevChip('warning', 'Open'));
    row.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: s.go }, 'Go'));
    list.append(row);
  });
  card.append(list);
  return card;
}

function tabThesisFor(r) {
  const t = State.theses.find(x => x.ticker === r.c.id);
  const wrap = el('div');
  wrap.append(sevenStepCard(r, t));
  if (!t) {
    const card = el('div', { class: 'card' });
    card.append(cardHead('No thesis yet', 'A thesis turns a piece of research into something that can be monitored and, later, reviewed. It records what you believe, what would prove you wrong, and when you will check.'));
    card.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => addToThesis(r.c.id) }, 'Start a thesis'));
    wrap.append(card);
    return wrap;
  }
  wrap.append(thesisCard(t, true));
  return wrap;
}

function thesisCard(t, expanded) {
  const r = BY_ID.get(t.ticker);
  const evalr = evaluateThesis(t);
  const card = el('div', { class: 'card' });
  const hd = el('div', { class: 'card-hd' });
  hd.append(el('div', {}, [
    el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:3px' }, [
      el('h3', { class: 'h-card' }, r.c.tk), marketChip(r.c.mkt),
      el('span', { class: 'chip' }, `${t.conf} confidence`),
      evalr.breaches.length ? sevChip('serious', `${evalr.breaches.length} condition breached`) : sevChip('good', 'No condition breached'),
    ]),
    el('p', { class: 'metaline' }, `Created ${t.created} · next review ${t.review} · horizon ${t.horizon}`),
  ]));
  hd.append(el('div', { class: 'row', style: 'gap:6px' }, [
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(t.ticker) }, 'Research'),
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openThesisEditor(t) }, 'Edit'),
  ]));
  card.append(hd);

  card.append(el('p', { class: 'body-lg', style: 'font-size:14px;color:var(--ink);margin-bottom:var(--md)' }, t.oneLine || 'No investment case written yet.'));

  const g = el('div', { class: 'grid g-2', style: 'margin-bottom:var(--md)' });
  const left = el('div');
  left.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Why the business'));
  left.append(el('p', { class: 'body', style: 'font-size:13px;margin-bottom:var(--md)' }, t.quality || '—'));
  left.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Catalysts'));
  const cl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  (t.catalysts.length ? t.catalysts : ['—']).forEach(x => cl.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  left.append(cl);
  g.append(left);

  const right = el('div');
  right.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Valuation case'));
  right.append(el('p', { class: 'body', style: 'font-size:13px;margin-bottom:8px' }, t.valCase || '—'));
  /* The blueprint's thesis template requires a link to the saved valuation run,
     so the case references a reproducible artefact rather than a remembered number. */
  const linkedRun = t.runRef ? (store.read('runs', []) || []).find(x => x.runId === t.runRef) : null;
  right.append(el('div', { style: 'margin-bottom:var(--md)' }, linkedRun
    ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openSavedRun(t) },
        `Linked run ${linkedRun.runId} · ${linkedRun.saved}`)
    : el('p', { class: 'metaline' },
        'No valuation run linked yet. Save a run in the Valuation Studio and it attaches to this thesis automatically.')));
  right.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Key risks'));
  const rl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  (t.risks.length ? t.risks : ['—']).forEach(x => rl.append(el('li', { class: 'evidence counter', style: 'font-size:13px' }, x)));
  right.append(rl);
  g.append(right);
  card.append(g);

  /* invalidation conditions, evaluated live */
  card.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Invalidation conditions — evaluated against the latest data'));
  const tw = el('div', { class: 'tablewrap' });
  const tab = el('table', { class: 'dt' });
  tab.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Condition'), el('th', {}, 'Threshold'), el('th', {}, 'Current'),
    el('th', {}, 'Distance'), el('th', {}, 'State')])));
  const tb = el('tbody');
  [...evalr.breaches.map(x => ({ ...x, hit: true })), ...evalr.ok.map(x => ({ ...x, hit: false }))].forEach(cd => {
    const fmt = cd.type === 'val' ? (v) => fmtPct(v, 1) : fmtFor(cd.k);
    const st = conditionState(cd);
    const dist = conditionDistance(cd);
    tb.append(el('tr', {}, [
      el('td', { class: 'ident', style: 'white-space:normal;max-width:280px' }, cd.label),
      el('td', {}, `${cd.op} ${fmt(cd.v)}`),
      el('td', { html: isNum(cd.actual) ? fmt(cd.actual) : NA }),
      /* The number the label was derived from. Without it, "Approaching" is a
         verdict the reader has to take on trust. */
      el('td', { class: 'num' }, dist
        ? `${formatConditionGap(Math.abs(dist.abs), fmt)} · ${fmtPct(dist.rel * 100, 1)} of threshold`
        : '—'),
      el('td', { title: st.rule || '' },
        st.sev === 'muted' ? el('span', { class: 'caption' }, st.label) : sevChip(st.sev, st.label)),
    ]));
  });
  tab.append(tb); tw.append(tab); card.append(tw);
  /* Every state and its rule, in the place the labels are read. A reader who
     can see "Approaching threshold" and its distance but not the rule that
     connects them is being asked to trust an arithmetic they could check. */
  const ruleBox = el('details', { style: 'margin-top:10px' });
  ruleBox.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
    'How each state is decided'));
  const ruleTable = el('table', { class: 'dt', style: 'margin-top:8px' });
  ruleTable.append(el('thead', {}, el('tr', {}, ['State', 'Rule'].map(h =>
    el('th', { style: 'text-align:left' }, h)))));
  const ruleBody = el('tbody');
  ['breached', 'approaching', 'within', 'stale', 'awaiting', 'unavailable'].forEach(k => {
    const st = CONDITION_STATES[k];
    ruleBody.append(el('tr', {}, [
      el('td', { style: 'text-align:left' },
        st.sev === 'muted' ? el('span', { class: 'caption' }, st.label) : sevChip(st.sev, st.label)),
      el('td', { style: 'text-align:left;white-space:normal' }, st.rule),
    ]));
  });
  ruleTable.append(ruleBody);
  ruleBox.append(el('div', { class: 'tablewrap' }, ruleTable));
  const age = dataAgeMonths();
  ruleBox.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `Distance is shown two ways: the absolute gap in the metric's own unit — percentage points where the metric is a percentage — and that gap as a proportion of the threshold, which is the figure the ${Math.round(APPROACH_MARGIN * 100)}% margin is measured against.`
    + (isNum(age) ? ` The oldest statements behind any condition are ${age} months old; a company's are treated as stale beyond ${STALE_AFTER_MONTHS}.` : '')));
  card.append(ruleBox);
  card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `A condition reads Breached when it evaluates true, Approaching threshold when it does not but sits within ${Math.round(APPROACH_MARGIN * 100)}% of the threshold value — |actual − threshold| ÷ |threshold| — and Within threshold beyond that. A condition with no current value, or one resting on stale statements, is never counted as passing.`));

  if (t.questions?.length) {
    card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Unanswered questions'));
    const ql = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
    t.questions.forEach(q => ql.append(el('li', { class: 'evidence', style: 'font-size:13px' }, q)));
    card.append(ql);
  }

  const foot = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);padding-top:var(--sm);border-top:1px solid var(--grid)' });
  const reviewCount = (store.read('reviews', {})[t.id] || []).length;
  foot.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openReview(t) },
    reviewCount ? `Decision reviews (${reviewCount})` : 'Run a decision review'));
  foot.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openResearch(t.ticker, 'valuation') }, 'Re-run valuation'));
  foot.append(el('span', { class: 'spacer' }));
  foot.append(el('span', { class: 'metaline' }, 'Alerts fire only when a condition above changes state — they describe the change, never an action.'));
  card.append(foot);
  return card;
}

function openThesisEditor(t) {
  const body = el('div');
  const field = (label, key, multiline, note) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    f.append(el('label', {}, label));
    const inp = multiline
      ? el('textarea', { class: 'input', oninput: e => { t[key] = e.target.value; saveTheses(); } }, t[key] || '')
      : el('input', { class: 'input', value: t[key] || '', oninput: e => { t[key] = e.target.value; saveTheses(); } });
    f.append(inp);
    if (note) f.append(el('p', { class: 'metaline' }, note));
    return f;
  };
  body.append(field('One-sentence investment case', 'oneLine', true, 'If it takes more than a sentence, the case is probably not clear yet.'));
  body.append(field('Why the business', 'quality', true));
  body.append(field('Valuation case', 'valCase', true, 'Reference the saved valuation run rather than a number you remember.'));
  const listField = (label, key, note) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    f.append(el('label', {}, label));
    f.append(el('textarea', { class: 'input', oninput: e => { t[key] = e.target.value.split('\n').filter(Boolean); saveTheses(); } }, (t[key] || []).join('\n')));
    f.append(el('p', { class: 'metaline' }, note || 'One per line.'));
    return f;
  };
  body.append(listField('Catalysts', 'catalysts'));
  body.append(listField('Key risks', 'risks'));
  body.append(listField('Unanswered questions', 'questions'));
  const row = el('div', { class: 'grid g-2', style: 'margin-bottom:var(--md)' });
  ['horizon', 'review'].forEach(k => {
    const f = el('div', { class: 'field' });
    f.append(el('label', {}, k === 'horizon' ? 'Intended holding horizon' : 'Next review date'));
    f.append(el('input', { class: 'input', type: k === 'review' ? 'date' : 'text', value: t[k], oninput: e => { t[k] = e.target.value; saveTheses(); } }));
    row.append(f);
  });
  body.append(row);
  const cf = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  cf.append(el('label', {}, 'Confidence'));
  const cs = el('select', { class: 'select', onchange: e => { t.conf = e.target.value; saveTheses(); } });
  ['Low', 'Medium', 'High'].forEach(v => cs.append(el('option', { value: v, selected: t.conf === v ? '' : null }, v)));
  cf.append(cs); body.append(cf);

  body.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => { saveTheses(); closeDrawer(); render(); toast('Thesis saved'); } }, 'Save'),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      if (!confirm('Delete this thesis? Its review history will be removed too.')) return;
      /* The dialog promises the review history goes with it; only the thesis
         was removed, and its reviews stayed in storage and in backups. */
      const reviews = store.read('reviews', {});
      if (reviews && t.id in reviews) { delete reviews[t.id]; store.write('reviews', reviews); }
      State.theses = State.theses.filter(x => x.id !== t.id); saveTheses(); closeDrawer(); render(); toast('Thesis deleted');
    } }, 'Delete'),
  ]));
  openDrawer('Edit thesis', body);
}

function openReview(t) {
  const r = BY_ID.get(t.ticker);
  const evalr = evaluateThesis(t);
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    'A review scores the process, not the outcome. A good decision can still lose money, and a bad one can still make it.'));
  const qs = [
    ['Was the original thesis supported by what actually happened?', evalr.breaches.length ? `${evalr.breaches.length} invalidation condition is currently breached.` : 'No invalidation condition is currently breached.'],
    /* driverImpact returns nothing for a company no model could be built for,
       and indexing [0].label threw — the review never opened for any thesis
       on such a company. */
    ['Which assumptions turned out to be wrong?', (() => {
      const top = r.val?.err ? null : driverImpact(r.c, r.d, r.inputs)[0];
      return top ? `The largest driver of the current valuation is ${top.label.toLowerCase()}.`
        : 'No valuation model could be built for this company, so there is no driver to name.';
    })()],
    ['Was the process good despite the outcome?', 'Check whether the evidence was gathered before the conclusion, or after it.'],
    /* The latest two years, not rows 3 and 4 of a five-row era — every
       company holds ten rows now, and fixed indices named FY2020's change as
       the current one. */
    ['Did you react to price rather than to evidence?', (() => {
      const n = r.d.ni.length, a = r.d.ni[n - 2], b = r.d.ni[n - 1], yrs = yearsOf(r.c);
      const mv = isNum(a) && isNum(b) && a !== 0 ? withSign((b - a) / Math.abs(a) * 100) : 'not computable';
      return `Price has moved ${isNum(r.c.px?.m12) ? withSign(r.c.px.m12) : 'an unobserved amount'} over twelve months; reported net profit moved ${mv} from FY${yrs[n - 2]} to FY${yrs[n - 1]}.`;
    })()],
    ['What reusable lesson should be recorded?', 'Write it as a rule you would apply to the next company, not as a comment about this one.'],
  ];
  /* Past reviews, so the journal accumulates rather than resetting each time. */
  const past = (store.read('reviews', {})[t.id] || []);
  if (past.length) {
    body.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, `${past.length} previous review${past.length === 1 ? '' : 's'}`));
    const pl = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:var(--lg)' });
    past.slice().reverse().forEach(rev => {
      const p = el('details', { class: 'panel' });
      p.append(el('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600' },
        `${rev.date} · ${rev.breaches} condition${rev.breaches === 1 ? '' : 's'} breached at the time`));
      rev.answers.forEach(a => {
        if (!a.answer) return;
        p.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, a.question));
        p.append(el('p', { class: 'body', style: 'font-size:13px' }, a.answer));
      });
      pl.append(p);
    });
    body.append(pl);
  }

  const fields = [];
  qs.forEach(([q, hint]) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    f.append(el('label', {}, q));
    f.append(el('p', { class: 'metaline', style: 'margin-bottom:4px' }, hint));
    const ta = el('textarea', { class: 'input', placeholder: 'Your note…' });
    f.append(ta);
    fields.push({ question: q, el: ta });
    body.append(f);
  });

  body.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    const answers = fields.map(f => ({ question: f.question, answer: f.el.value.trim() }));
    if (!answers.some(a => a.answer)) { toast('Nothing written yet — add at least one note'); return; }
    const all = store.read('reviews', {});
    all[t.id] = [...(all[t.id] || []), {
      date: new Date().toISOString().slice(0, 10),
      breaches: evalr.breaches.length,
      answers,
    }];
    store.write('reviews', all);
    closeDrawer(); render();
    toast('Review recorded against this thesis');
  } }, 'Record review'));
  openDrawer('Decision review', body);
}

VIEWS.thesis = () => {
  const wrap = el('div');
  wrap.append(mySubnav('thesis'));
  appendSampleBanner(wrap);
  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Thesis'),
    el('h1', {}, 'What you believe, and what would prove you wrong'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Conditions are evaluated against the latest data every time this page loads. A breach is reported as a changed fact with its source — never as an instruction to trade.'),
  ]));
  hd.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('discover', { tab: 'screener' }), html: `${icon('plus', 13)} New thesis from a screen` }));
  wrap.append(hd);

  const stats = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--lg)' });
  const evals = State.theses.map(t => ({ t, e: evaluateThesis(t) }));
  const breached = evals.filter(x => x.e.breaches.length).length;
  const dueSoon = State.theses.filter(t => new Date(t.review) <= new Date('2026-09-30')).length;
  /* Coverage is the watchlist entries that have a thesis, not the count of
     theses: a thesis on a company not on the watchlist raised it, and it
     could pass 100%. The linked-run line counts the links instead of claiming
     every thesis has one — a new thesis starts without. */
  const covered = State.watchlist.filter(id => State.theses.some(t => t.ticker === id)).length;
  const linked = State.theses.filter(t => t.runRef).length;
  [['Open theses', String(State.theses.length), `${linked} linked to a saved valuation run`],
   ['Conditions breached', String(breached), breached ? 'Read the evidence before acting' : 'Nothing has changed state'],
   ['Reviews due by 30 Sep', String(dueSoon), 'Review discipline is scored, not returns'],
   ['Watchlist coverage', `${covered}/${State.watchlist.length}`, 'Watchlist entries with a written thesis']]
   .forEach(([l, v, s]) => stats.append(el('div', { class: 'card' }, statTile(l, v, { sub: s }))));
  wrap.append(stats);

  if (!State.theses.length) { wrap.append(el('div', { class: 'card' }, emptyState('No thesis yet. Open any company and start one from the Thesis tab.'))); return wrap; }
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  State.theses.forEach(t => list.append(thesisCard(t)));
  wrap.append(list);
  return wrap;
};

/* ==========================================================================
   VIEW — COMPARE
   ========================================================================== */

VIEWS.compare = () => {
  const wrap = el('div');
  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Compare'),
    el('h1', {}, 'Economically comparable, not just same-sector'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Sector alone is not a peer group. Business model, capital intensity, maturity and market convention all change which metrics mean the same thing across two companies.'),
  ]));
  wrap.append(hd);

  /* picker */
  const pick = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  pick.append(cardHead('Selection',
    `Choose up to ${LIMITS.compare} companies — the universe carried here holds ${U.length}. Peer-mode presets pick an economically comparable set rather than a sector list.`));
  const presets = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:var(--sm)' });
  [['Malaysian banks', U.filter(r => r.c.mkt === 'MY' && r.c.type === 'bank').map(r => r.c.id)],
   ['Malaysian REITs', U.filter(r => r.c.mkt === 'MY' && r.c.type === 'reit').map(r => r.c.id)],
   /* By ticker, resolved against whatever record carries it now: the
      illustrative ids these once named are retired when the filed twins
      load, and the preset silently selected nothing. */
   ['US mega-cap technology', ['AAPL', 'MSFT', 'GOOGL', 'NVDA'].map(tk => U.find(r => r.c.tk === tk)?.c.id).filter(Boolean)],
   ['Commodity cyclicals', U.filter(r => r.c.type === 'cyclical').map(r => r.c.id)],
   ['Consumer staples, both markets', U.filter(r => r.c.sector === 'Consumer Staples').map(r => r.c.id)],
   /* No "Whole universe" preset. It was labelled with the full count and
      selected the first two or five companies — a comparison of the universe
      is not something a capped selection can do. Any preset larger than the
      cap says it was cut, rather than cutting silently. */
   ['My watchlist', State.watchlist]]
   .forEach(([label, ids]) => presets.append(el('button', { class: 'btn btn-ghost btn-sm',
     onclick: () => {
       /* saveCompare keeps the address in step with the selection (shell); the
          toast says when a preset held more than a comparison can (studio). */
       State.compare = ids.slice(0, LIMITS.compare); saveCompare(); render();
       if (ids.length > LIMITS.compare) toast(`Showing the first ${LIMITS.compare} of ${ids.length} — ${LIMITS.compare} is the most a comparison holds`);
     } }, label)));
  pick.append(presets);
  const chips = el('div', { class: 'row row-wrap', style: 'gap:5px' });
  U.forEach(r => {
    const on = State.compare.includes(r.c.id);
    chips.append(el('button', { class: 'chip' + (on ? ' chip-brand' : ''), style: 'cursor:pointer',
      onclick: () => {
        State.compare = on ? State.compare.filter(x => x !== r.c.id)
          : (State.compare.length >= LIMITS.compare ? (toast(`${LIMITS.compare} is the maximum`), State.compare) : [...State.compare, r.c.id]);
        saveCompare(); render();
      } }, r.c.tk + illusText(r.c)));
  });
  pick.append(chips);

  /* Gross vs illustrative net distributions (§7.5). Gross is the reported fact;
     the net column is a scenario the reader sets, and is labelled as such. */
  const wht = el('div', { class: 'sunk', style: 'margin-top:var(--md)' });
  wht.append(el('div', { class: 'row row-wrap', style: 'gap:var(--md);align-items:flex-end' }, [
    el('div', {}, [
      el('h4', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'Illustrative dividend withholding'),
      el('p', { class: 'metaline' }, 'Applied to the gross yield to produce the illustrative net row in the table below, and the net yield and income on the Portfolio page. Gross is always shown alongside it.'),
    ]),
    el('span', { class: 'spacer' }),
    ...['US', 'MY'].map(mkt => {
      const f = el('div', { class: 'field', style: 'width:110px' });
      f.append(el('label', { for: `wht-${mkt}` }, mkt === 'US' ? 'US listings' : 'Bursa listings'));
      f.append(el('input', { class: 'input input-inline', id: `wht-${mkt}`, type: 'number', min: 0, max: 40, step: 1,
        value: State.wht[mkt], style: 'text-align:right',
        onchange: e => { State.wht[mkt] = clamp(+e.target.value || 0, 0, 40); store.write('wht', State.wht); render(); } }));
      return f;
    }),
  ]));
  wht.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'These rates are yours to set and are illustrative only. The tax actually withheld depends on your residency, your account type and any applicable treaty — this is not tax advice and no rate is looked up for you.'));
  pick.append(wht);
  wrap.append(pick);

  const rows = State.compare.map(id => BY_ID.get(id)).filter(Boolean);
  if (!rows.length) { wrap.append(el('div', { class: 'card' }, emptyState('Select at least one company.'))); return wrap; }

  const mixedTypes = new Set(rows.map(r => r.c.type)).size > 1;
  const mixedMkts = new Set(rows.map(r => r.c.mkt)).size > 1;
  if (mixedTypes || mixedMkts) {
    const warn = el('div', { class: 'guardrail', style: 'background:color-mix(in srgb, var(--warn) 12%, transparent);border-color:color-mix(in srgb, var(--warn) 36%, transparent);margin-bottom:var(--md)' });
    warn.innerHTML = `<span style="color:var(--warn)">${icon('alert')}</span><span>${
      mixedTypes ? 'This selection mixes business models, so some rows are not comparable — return on invested capital and enterprise value are not meaningful for banks, and free cash flow is not meaningful for a deposit-taking balance sheet. ' : ''
    }${mixedMkts ? (State.compareCcy === 'local'
      /* The sentence follows the currency toggle. It said "converted" in
         Local-currency mode, above a row printing $ and RM side by side. */
      ? 'It also mixes reporting currencies; per-share figures and market capitalisation are shown in each company’s reporting currency and are not comparable across markets.'
      : `It also mixes reporting currencies; per-share figures are shown in the reporting currency and market capitalisation is converted to ${State.baseCcy}.`) : ''}</span>`;
    wrap.append(warn);
  }

  /* peer table */
  /* Currency, stated rather than assumed. A table mixing RM share prices with
     $ market capitalisations is not wrong so much as unreadable — the reader
     cannot tell which figures are comparable. Either everything sits in the
     currency it trades in, or everything is converted at a rate shown on the
     page. Share prices always stay local: converting a quoted price invents a
     number no exchange ever printed. */
  const showLocal = State.compareCcy === 'local';
  const mixedCcy = new Set(rows.map(r => r.c.ccy)).size > 1;
  const ccyBar = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  ccyBar.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:center' }, [
    el('span', { class: 'metaline' }, 'Show totals in'),
    el('div', { class: 'segmented' }, [
      el('button', { 'aria-selected': !showLocal ? 'true' : 'false',
        onclick: () => { State.compareCcy = 'common'; store.write('compareCcy', 'common'); render(); } },
        `Common currency (${State.baseCcy})`),
      el('button', { 'aria-selected': showLocal ? 'true' : 'false',
        onclick: () => { State.compareCcy = 'local'; store.write('compareCcy', 'local'); render(); } },
        'Local currency'),
    ]),
    mixedCcy && !showLocal
      ? el('span', { class: FX.source === 'sample' ? 'chip chip-bronze' : 'chip' },
          `USD/MYR ${FX.USDMYR.toFixed(4)} · ${FX.named || (FX.source === 'sample' ? 'indicative sample rate' : 'your price file')}${FX.asOf ? ' · ' + FX.asOf : ''}`)
      : null,
  ]));
  ccyBar.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    showLocal
      ? 'Each company is shown in the currency it trades in. Figures are not comparable across markets in this mode.'
      : `Market capitalisations are converted to ${State.baseCcy} at the rate above. Share prices stay in the currency they trade in — a converted quote is a number no exchange printed.`));
  if (mixedCcy) wrap.append(ccyBar);

  /* ==== comparison packs =============================================== */
  /* Which measures matter is decided by what the businesses are. A bank has no
     meaningful free cash flow and a REIT has no meaningful EV/EBIT, so putting
     either on a generic table produces a column of dashes that reads as missing
     data rather than as an inapplicable question. The pack is chosen from the
     selection: all banks gets the bank pack, all REITs the REIT pack, a mixed
     set falls back to the measures that survive across every model. */
  const kinds = [...new Set(rows.map(r => r.c.type))];
  const allAre = (t) => rows.length > 0 && kinds.length === 1 && kinds[0] === t;

  /* The withholding block above says it produces a net figure beside the gross
     one. No pack carried that row, so the rates changed nothing on this page
     and the control was dead where it sat. Every pack's gross yield row is now
     followed by the net one, labelled as the scenario it is. */
  const NET_DY = ['Dividend yield, illustrative net', r => isNum(r.m.dy)
    ? `<span title="Gross less the illustrative withholding of ${esc(String(State.wht[r.c.mkt] ?? 0))}% set above">${fmtPct(netYield(r.m.dy, r.c.mkt), 2)}</span>` : NA];

  const PACKS = {
    bank: { id:'bank', name:'Bank comparison',
      why:'Deposit takers are compared on the return they earn on equity, the quality of their funding and their loan book — free cash flow and EV multiples are not meaningful for a bank balance sheet.',
      rows: [
        ['— Returns —', null],
        ['Return on equity', r => fmtPct(r.m.roe), 'roe'],
        ['Net interest margin', r => isNum(r.c.bank?.nim) ? fmtPct(r.c.bank.nim, 2) : NA],
        ['Cost-to-income', r => isNum(r.c.bank?.cir) ? fmtPct(r.c.bank.cir, 1) : NA],
        ['— Funding and capital —', null],
        ['CASA ratio', r => isNum(r.c.bank?.casa) ? fmtPct(r.c.bank.casa, 1) : NA],
        ['Loan-to-deposit', r => isNum(r.c.bank?.ldr) ? fmtPct(r.c.bank.ldr, 1) : NA],
        ['CET1 ratio', r => isNum(r.c.bank?.cet1) ? fmtPct(r.c.bank.cet1, 1) : NA],
        ['— Asset quality —', null],
        ['Gross impaired loans', r => isNum(r.c.bank?.npl) ? fmtPct(r.c.bank.npl, 2) : NA],
        ['— Valuation and payout —', null],
        ['Price / book', r => fmtX(r.m.pb, 2), 'pb'],
        ['Price / earnings', r => isNum(r.m.pe) ? fmtX(r.m.pe) : NA, 'pe'],
        ['Dividend yield', r => fmtPct(r.m.dy, 2), 'dy'],
        NET_DY,
        ['Payout ratio', r => isNum(r.m.payout) ? fmtPct(r.m.payout, 0) : NA, 'payout'],
      ] },
    reit: { id:'reit', name:'REIT comparison',
      why:'Property trusts distribute most of what they earn, so the comparison is on the distribution, what backs it, and how much debt sits against the portfolio — not on earnings multiples.',
      rows: [
        ['— Distribution —', null],
        ['Dividend yield', r => fmtPct(r.m.dy, 2), 'dy'],
        NET_DY,
        ['Distribution growth (4y)', r => isNum(r.m.dps5) ? fmtPct(r.m.dps5) : NA, 'dps5'],
        ['Distribution cover', r => isNum(r.m.dpuCover) ? fmtPct(r.m.dpuCover, 0) : NA],
        ['— Portfolio —', null],
        ['Occupancy', r => isNum(r.c.reit?.occ) ? fmtPct(r.c.reit.occ, 1) : NA],
        ['Weighted average lease expiry', r => isNum(r.c.reit?.wale) ? `${fmtNum(r.c.reit.wale, 1)} yrs` : NA],
        ['Capitalisation rate', r => isNum(r.c.reit?.cap) ? fmtPct(r.c.reit.cap, 1) : NA],
        ['— Leverage —', null],
        ['Gearing', r => isNum(r.c.reit?.gearing) ? fmtPct(r.c.reit.gearing, 1) : NA],
        ['Interest cover', r => isNum(r.m.icov) ? fmtX(r.m.icov) : NA, 'icov'],
        ['— Valuation —', null],
        ['Price / NAV', r => isNum(r.m.pnav) ? fmtX(r.m.pnav, 2) : fmtX(r.m.pb, 2)],
      ] },
    general: { id:'general', name:'Operating business comparison',
      why:'Capital efficiency, margin, cash conversion and what the whole business costs including its debt.',
      rows: [
        ['— Returns —', null],
        ['Return on invested capital', r => isNum(r.m.roic) ? fmtPct(r.m.roic) : NA, 'roic'],
        ['Operating margin', r => fmtPct(r.m.om), 'om'],
        ['Free cash flow margin', r => isNum(r.m.fcfm) ? fmtPct(r.m.fcfm) : NA, 'fcfm'],
        ['— Growth —', null],
        ['Revenue CAGR (4y)', r => isNum(r.m.rev5) ? fmtPct(r.m.rev5) : NA, 'rev5'],
        ['Earnings CAGR (4y)', r => isNum(r.m.eps5) ? fmtPct(r.m.eps5) : r.m.shareSeriesBreak ? NA_SPLIT : NA, 'eps5'],
        ['— Balance sheet —', null],
        ['Net debt / EBIT', r => isNum(r.m.ndEbit) ? fmtX(r.m.ndEbit) : NA, 'ndEbit'],
        ['— Valuation —', null],
        ['EV / EBIT', r => isNum(r.m.evebit) ? fmtX(r.m.evebit) : NA, 'evebit'],
        ['Free cash flow yield', r => isNum(r.m.fcfy) ? fmtPct(r.m.fcfy, 2) : NA, 'fcfy'],
        ['Dividend yield', r => fmtPct(r.m.dy, 2), 'dy'],
        NET_DY,
      ] },
  };
  const pack = allAre('bank') ? PACKS.bank : allAre('reit') ? PACKS.reit : PACKS.general;

  const packNote = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  packNote.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
    el('span', { class: 'chip chip-brand' }, pack.name),
    el('p', { class: 'body', style: 'flex:1 1 320px;font-size:13px;margin:0' }, pack.why),
  ]));
  if (pack.id === 'general' && kinds.length > 1) packNote.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `The selection mixes ${kinds.join(', ')}. Only measures that mean the same thing across all of them are shown — select one business model to get its own comparison.`));
  wrap.append(packNote);

  const METRIC_ROWS = [
    ['Price', r => fmtMoney(r.c.px.p, r.c.ccy)],
    ['Market capitalisation', r => fmtCap(showLocal ? r.m.mcap : toBase(r.m.mcap, r.c.ccy), showLocal ? r.c.ccy : State.baseCcy), 'mcap'],
    ['Business model', r => r.c.type],
    ['Model pack', r => r.val.pack.name],
    ...pack.rows,
    ['— Valuation —', null],
    ['Base-case model estimate', r => isNum(r.val.vals?.base) ? fmtMoney(r.val.vals.base, r.c.ccy) : NA],
    ['Difference to price', r => isNum(r.val.mos?.base) ? `<span class="${diffClass(r.val.mos.base)}">${withSign(r.val.mos.base, 0)}</span>` : NA, 'mosBase'],
    ['Valuation confidence', r => r.val.confBand],
    ['— Scores —', null],
    ['Business Quality', r => scorePill(r.scores.quality.score, r.pct.quality)],
    ['Financial Strength', r => scorePill(r.scores.strength.score, r.pct.strength)],
    ['Capital Allocation', r => scorePill(r.scores.capital.score, r.pct.capital)],
    ['Risk grade', r => riskPill(r.risk.band)],
    ['Data completeness', r => `${r.m.coverage}%`],
  ];

  /* The comparison table is the page's primary content, so it is read by
     scrolling the page — the header row pins under the top bar instead. */
  const tcard = el('div', { class: 'card', style: 'padding:0;overflow:visible;margin-bottom:var(--md)' });
  const tw = el('div', { class: 'tablewrap', style: 'border:0;border-radius:var(--r-lg);overflow-x:auto' });
  const t = el('table', { class: 'dt dt-pagesticky' });
  const thr = el('tr');
  thr.append(el('th', { class: 'pin' }, 'Measure'));
  rows.forEach(r => thr.append(el('th', { html: `${esc(r.c.tk)}${r.c.real ? '' : ' <span class="illus" title="' + esc(ILLUS_TITLE) + '">illustrative</span>'}<br><span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink-3)">${esc(r.c.ccy)}</span>` })));
  t.append(el('thead', {}, thr));
  const tb = el('tbody');
  /* A row keyed to a screener field reads like a screener cell: present, it
     opens the source drawer for that measure; absent, it prints which of the
     five reasons applies, with the sentence as a title, and opens the same
     drawer, which names the line behind the absence. Rows on a bank's or a
     REIT's own disclosures (margin, CASA, occupancy) and on the model are not
     statement arithmetic, and keep their plain cell. */
  const sourcedCell = (r, get, k) => {
    const fld = FIELD_BY_K[k];
    const present = isNum(r.m[k]);
    const st = present ? null : metricStatus(r, k);
    const td = el('td', { class: 'cell-sourced', role: 'button', tabindex: '0',
      html: present ? get(r) : `<span class="caption cell-absent" title="${esc(st.text)}">${esc(st.label)}</span>` });
    /* Read off the cell, so a converted money figure is announced as shown. */
    td.setAttribute('aria-label', `${fld.label} for ${r.c.tk}: ${present ? td.textContent.trim() : `unavailable, ${st.reason}`} — show source`);
    td.addEventListener('click', () => openSourceDrawer(r, fld));
    td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSourceDrawer(r, fld); } });
    return td;
  };
  METRIC_ROWS.forEach(([label, get, k]) => {
    if (!get) {
      const tr = el('tr');
      tr.append(el('td', { class: 'pin ident', colspan: rows.length + 1,
        style: 'background:var(--surface-sunk);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:700' },
        label.replace(/—/g, '').trim()));
      tb.append(tr); return;
    }
    const tr = el('tr');
    tr.append(el('td', { class: 'pin ident' }, label));
    rows.forEach(r => tr.append(k && FIELD_BY_K[k] ? sourcedCell(r, get, k) : el('td', { html: get(r) })));
    tb.append(tr);
  });
  t.append(tb); tw.append(t); tcard.append(tw);
  tcard.append(el('p', { class: 'metaline', style: 'padding:var(--sm) var(--lg)' },
    'Select any measure computed from the statements for its source: the formula, the fiscal year, the lines it reads with their XBRL concepts, and the EDGAR record for a filer. An empty cell names its reason. Rows from a bank’s or REIT’s own disclosures, and the model rows, are not statement arithmetic and open nothing.'));
  wrap.append(tcard);

  /* quality / valuation matrix */
  const mx = el('div', { class: 'card' });
  mx.append(cardHead('Quality against valuation', 'Same axes as the Value Radar, restricted to the selected companies.'));
  const host = el('div', { style: 'width:100%' });
  mx.append(host);
  mx.append(el('div', { class: 'legend', style: 'margin-top:var(--sm)' }, [
    el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(--s1)"></span>United States` }),
    el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(--s2)"></span>Bursa Malaysia` }),
  ]));
  wrap.append(mx);
  scatterChart(host, {
    points: rows.filter(r => r.val.mos).map(r => ({
      id:r.c.id, label:r.c.tk, name:r.c.name, x:r.val.mos.base, y:r.pct.quality ?? 50,
      size:toBase(r.m.mcap, r.c.ccy), capLabel:fmtCap(toBase(r.m.mcap, r.c.ccy), State.baseCcy),
      model:r.val.pack.name, conf:r.val.confBand, varName:r.c.mkt === 'US' ? '--s1' : '--s2' })),
    xLabel:'Difference to model estimate vs base-case value — right of the line is below it',
    xLabelShort:'Difference to model estimate vs base-case model estimate',
    yLabel:'Quality percentile within market cohort',
    yLabelShort:'Quality percentile',
    xFmt:v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
    onPick:id => openResearch(id),
  });
  return wrap;
};

/* ==========================================================================
   VIEW — PORTFOLIO
   ========================================================================== */

/* `fx0` is the USD/MYR rate on the purchase date. It is what makes the currency
   effect computable: without a rate at cost, translating at one fixed rate
   cancels out and the split is silently zero. `fee` and `rebate` are the
   transaction cost paid and any rebate received, in the holding's own currency;
   `qty` is deliberately allowed to be fractional. */
const DEFAULT_PORTFOLIOS = [
  { id:'pf-1', name:'Long-term core', cash: 8400, cashCcy:'MYR', holdings: [
    { id:'MAYBANK', qty:12000,  cost:9.10,   fx0:4.68, fee:48,  rebate:0 },
    { id:'PBBANK',  qty:20000,  cost:4.05,   fx0:4.61, fee:52,  rebate:12 },
    { id:'TENAGA',  qty:4000,   cost:12.40,  fx0:4.72, fee:36,  rebate:0 },
    { id:'AXREIT',  qty:25000,  cost:1.72,   fx0:4.55, fee:41,  rebate:0 },
    { id:'IGBREIT', qty:18000,  cost:1.94,   fx0:4.49, fee:38,  rebate:9 },
    { id:'AAPL',    qty:120.5,  cost:171.20, fx0:4.38, fee:1.2, rebate:0 },
    { id:'MSFT',    qty:60.25,  cost:338.50, fx0:4.25, fee:1.2, rebate:0 },
    { id:'O',       qty:300,    cost:54.10,  fx0:4.71, fee:1.5, rebate:0 },
  ] },
  { id:'pf-2', name:'US quality sleeve', cash: 2150, cashCcy:'USD', holdings: [
    { id:'GOOGL', qty:45.5,  cost:152.40, fx0:4.40, fee:1.2, rebate:0 },
    { id:'COST',  qty:8.125, cost:880.00, fx0:4.36, fee:1.2, rebate:0 },
    { id:'JNJ',   qty:70,    cost:149.90, fx0:4.44, fee:1.2, rebate:0 },
  ] },
];
if (!State.portfolios) { State.portfolios = DEFAULT_PORTFOLIOS; savePortfolios(); }

/* Recorded dividends belong to the portfolio they were recorded in. Payments
   saved before they carried a portfolio are given one here, once: the first
   portfolio that holds the company, which is where the recording form would
   have offered it. After this every payment names its portfolio, so a later
   portfolio that buys the same company does not inherit it. */
{
  let moved = false;
  State.dividendsReceived = (State.dividendsReceived || []).map(x => {
    if (x.pfId) return x;
    const home = State.portfolios.find(p => (p.holdings || []).some(h => h.id === x.id)) || State.portfolios[0];
    moved = true;
    return { ...x, pfId: home?.id || null };
  });
  if (moved) store.write('dividendsReceived', State.dividendsReceived);
}
const dropDividendsOf = (pfIds) => {
  const before = (State.dividendsReceived || []).length;
  State.dividendsReceived = (State.dividendsReceived || []).filter(x => !pfIds.includes(x.pfId));
  if (State.dividendsReceived.length !== before) store.write('dividendsReceived', State.dividendsReceived);
};

/* SEEDED DEMONSTRATION DATA, SAID OUT LOUD
   ---------------------------------------------------------------------------
   Two portfolios and two investment cases are written into a fresh profile so
   these views have something to render. Only /my/portfolio admitted it, once,
   in a sentence at the foot of a card — so a first-time reader met
   "RM373.6k · 5 positions · +14.9%" on four surfaces as though it were theirs,
   and an alert feed "mapped to your watchlist" built on top of it.

   On a product whose entire argument is that every figure should say where it
   came from, an unlabelled fictional portfolio presented as the reader's own is
   the sharpest contradiction available to it.

   Clearing removes the seeded ids and nothing else, so a reader who has already
   added their own holdings or written their own case keeps them.

   The seed also writes two watchlists and two price alerts (05-plans.js), and
   clearing used to leave them: the banner disappeared and the alert feed went
   on reporting items "mapped to your watchlist" built on a list the reader
   never made. They are cleared with the rest — except a list or an alert the
   reader has since changed, which is theirs now. A watchlist records its last
   change in updatedAt (null for the untouched seed); an alert records it when
   the editor saves it. */
const SEEDED_PF_IDS = ['pf-1', 'pf-2'];
const SEEDED_THESIS_IDS = ['t1', 't2'];
const SEEDED_WL_IDS = ['wl-1', 'wl-2'];
const SEEDED_PA_IDS = ['pa-1', 'pa-2'];
const seededPortfolios = () => (State.portfolios || []).filter(p => SEEDED_PF_IDS.includes(p.id));
const seededTheses = () => (State.theses || []).filter(t => SEEDED_THESIS_IDS.includes(t.id));
const isSeededWL = (w) => SEEDED_WL_IDS.includes(w.id) && !w.updatedAt;
const isSeededPA = (pa) => SEEDED_PA_IDS.includes(pa.id) && !pa.updatedAt;
const hasSeededData = () => seededPortfolios().length > 0 || seededTheses().length > 0
  || (State.watchlists || []).some(isSeededWL) || (State.priceAlerts || []).some(isSeededPA);

function clearSeededData() {
  const ownPf = (State.portfolios || []).filter(p => !SEEDED_PF_IDS.includes(p.id));
  const ownTh = (State.theses || []).filter(t => !SEEDED_THESIS_IDS.includes(t.id));
  const ownWl = (State.watchlists || []).filter(w => !isSeededWL(w));
  const activeWlId = activeWL()?.id;
  dropDividendsOf(SEEDED_PF_IDS);
  /* activePF() reads State.portfolios[0] and the view assumes it exists, so the
     list is never left empty — it becomes one empty portfolio of the reader's
     own rather than nothing at all. activeWL() makes the same assumption. */
  State.portfolios = ownPf.length ? ownPf
    : [{ id:'pf-user', name:'My portfolio', cash:0, cashCcy:'MYR', holdings:[] }];
  State.theses = ownTh;
  State.pfIdx = 0;
  const now = new Date().toISOString();
  State.watchlists = ownWl.length ? ownWl
    : [{ id:'wl-user', name:'My watchlist', ids:[], added:{}, createdAt:now, updatedAt:now, schema:WATCHLIST_SCHEMA }];
  State.wlIdx = Math.max(0, State.watchlists.findIndex(w => w.id === activeWlId));
  State.priceAlerts = (State.priceAlerts || []).filter(pa => !isSeededPA(pa));
  savePortfolios(); saveTheses(); saveWatchlists(); savePriceAlerts(); render();
  toast('Sample data cleared');
}

/* Rendered on every surface that shows seeded data, not just the one that
   happened to mention it. Returns null when there is nothing seeded left. */
function sampleBanner() {
  if (!hasSeededData()) return null;
  const b = el('div', { class: 'note', style: 'border-left:3px solid var(--bronze);margin-bottom:var(--md)' });
  b.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:center' }, [
    el('span', { class: 'chip chip-bronze' }, 'Sample data'),
    el('p', { class: 'body', style: 'font-size:13px;flex:1 1 300px;margin:0' },
      'These holdings, investment cases, watchlists and price alerts were written into this browser so the views have something to show. They are not yours, nobody holds them, and every figure derived from them is illustrative. Clearing keeps any list or alert you have changed.'),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: clearSeededData }, 'Clear and start my own'),
  ]));
  return b;
}
const appendSampleBanner = (wrap) => { const b = sampleBanner(); if (b) wrap.append(b); };

/* Compact money formatter for absolute position sizes (not the billions-scaled
   statement series). */
function fmtAmount(v, ccy) {
  if (!isNum(v)) return '—';
  const sym = ccy === 'MYR' ? 'RM' : '$';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(2)}m`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}k`;
  return `${sign}${sym}${a.toFixed(0)}`;
}

/* Cost basis including transaction costs: fees raise what a position cost,
   rebates lower it. Ignoring them flatters every return by the spread. */
function positionsOf(pf) {
  return pf.holdings.map(h => {
    const r = BY_ID.get(h.id);
    if (!r) return null;
    const ccy = r.c.ccy;
    /* A holding in a company with no price has no value, no weight and no
       return — not a value of nought and a return of minus one hundred, which
       is what `qty * null` and `(null - cost) / cost` produced for every
       filed company on the deployed site. Likewise an absent dividend line
       is no projection, not a projection of nought. */
    const unpriced = !isNum(r.c.px?.p);
    const valLocal = unpriced ? null : h.qty * r.c.px.p;
    const grossCostLocal = h.qty * h.cost;
    const netCostLocal = grossCostLocal + (h.fee || 0) - (h.rebate || 0);
    const valBase = unpriced ? null : toBase(valLocal, ccy);
    /* Cost is translated at the rate that applied on the purchase date, not at
       today's rate — otherwise the currency effect cancels to zero by
       construction and the split says nothing. */
    const toBaseAtCost = (v) => State.baseCcy === ccy ? v : (ccy === 'MYR' ? v / h.fx0 : v * h.fx0);
    const costBase = toBaseAtCost(netCostLocal);
    const priceRet = unpriced ? null : (r.c.px.p - h.cost) / h.cost * 100;
    const totalRet = unpriced ? null : (valBase / costBase - 1) * 100;
    /* Cost drag is the part of the gap explained by fees net of rebates. */
    const costDrag = (toBaseAtCost(grossCostLocal) / costBase - 1) * 100;
    const fxRet = unpriced ? null : totalRet - priceRet - costDrag;
    const noDividendLine = !isNum(r.m.dps);
    const incomeLocal = noDividendLine ? null : h.qty * r.m.dps;
    return { h, r, unpriced, noDividendLine, valLocal, netCostLocal, valBase, costBase, priceRet, fxRet, costDrag, totalRet,
             incomeBase: noDividendLine ? null : toBase(incomeLocal, ccy),
             thesis: State.theses.find(t => t.ticker === h.id) };
  }).filter(Boolean);
}

VIEWS.portfolio = () => {
  const wrap = el('div');
  /* mySubnav existed and was called from userdata and watchlists only — the two
     surfaces nothing in the product linked to. So the four pages a reader could
     actually reach were each a dead end, and the two that carried the way out
     were unreachable. Four calls restore six finished surfaces to each other. */
  wrap.append(mySubnav('portfolio'));
  appendSampleBanner(wrap);
  const pf = activePF();

  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Portfolio'),
    el('h1', {}, 'Understand your exposures — not a trading screen'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'This view separates business performance from currency movement from transaction costs, and shows how much of the portfolio is backed by a written thesis. It does not optimise, rebalance, or recommend an allocation.'),
  ]));
  const hr = el('div', { class: 'row row-wrap', style: 'gap:8px' });
  const sel = el('select', { class: 'select', style: 'width:auto;min-width:190px', 'aria-label': 'Active portfolio',
    onchange: e => { State.pfIdx = +e.target.value; render(); } });
  State.portfolios.forEach((p, i) => sel.append(el('option', { value: i, selected: i === State.pfIdx ? '' : null },
    `${p.name} · ${p.holdings.length} holdings`)));
  hr.append(sel);
  hr.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openPortfolioManager(), html: `${icon('briefcase', 13)} Manage` }));
  hr.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => openAddHolding(), html: `${icon('plus', 13)} Add holding` }));
  hd.append(hr);
  wrap.append(hd);

  const pos = positionsOf(pf);
  const securities = sum(pos.map(p => p.valBase));
  const cashBase = toBase(pf.cash || 0, pf.cashCcy || State.baseCcy);
  const totalVal = securities + cashBase;
  /* The return is measured on the positions that have a value. Summing every
     position's cost against the value of only the priced ones counted an
     unpriced holding at nought — a sleeve of three unpriced holdings read
     −100.0% — while the table beneath said those holdings were excluded from
     returns. Value, cost, currency share and yield on cost now cover one set. */
  const priced = pos.filter(p => !p.unpriced);
  const unpricedN = pos.length - priced.length;
  const totalCost = sum(priced.map(p => p.costBase));

  if (!pos.length && !cashBase) {
    wrap.append(el('div', { class: 'card' }, emptyState('This portfolio is empty. Add a holding to begin.')));
    return wrap;
  }

  const fxContribution = totalCost ? sum(priced.map(p => p.fxRet * p.costBase)) / totalCost : 0;
  const feeTotal = sum(pos.map(p => toBase((p.h.fee || 0) - (p.h.rebate || 0), p.r.c.ccy)));
  const unpricedNote = unpricedN ? `${unpricedN} without a price excluded` : '';
  const tiles = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--lg)' });
  tiles.append(el('div', { class: 'card' }, statTile('Portfolio value', fmtAmount(totalVal, State.baseCcy),
    { sub: `${pos.length} positions${unpricedN ? ` (${unpricedN} without a price)` : ''} + ${fmtAmount(cashBase, State.baseCcy)} cash` })));
  tiles.append(el('div', { class: 'card' }, statTile('Unrealised change', totalCost ? withSign((securities - totalCost) / totalCost * 100, 1) : '—',
    { sub: totalCost ? `of which ${withSign(fxContribution, 1)} is currency${unpricedNote ? ` · ${unpricedNote}` : ''}`
                     : (pos.length ? 'No holding here has a price, so there is no return to measure' : 'No holdings yet'),
      tone: !totalCost ? null : securities >= totalCost ? '--ok-text' : '--dn-text' })));
  const withThesis = pos.filter(p => p.thesis);
  tiles.append(el('div', { class: 'card' }, statTile('Covered by a thesis', `${withThesis.length}/${pos.length}`,
    { sub: securities ? `${fmtPct(sum(withThesis.map(p => p.valBase)) / securities * 100, 0)} of securities value` : '—' })));
  tiles.append(el('div', { class: 'card' }, statTile('Transaction costs paid', fmtAmount(feeTotal, State.baseCcy),
    { sub: 'Fees net of rebates, included in the cost base' })));
  wrap.append(tiles);

  /* holdings table */
  const hc = el('div', { class: 'card', style: 'padding:0;overflow:hidden;margin-bottom:var(--md)' });
  const hh = el('div', { style: 'padding:var(--md) var(--lg);border-bottom:1px solid var(--line)' });
  hh.append(el('h3', { class: 'h-card' }, 'Holdings'));
  hh.append(el('p', { class: 'caption', style: 'margin-top:2px' },
    `Return is split into the price move in the reporting currency and the currency effect of translating into ${State.baseCcy}. Net yield applies the illustrative withholding rates set on the Compare view — it is a scenario, not a tax calculation. Sample positions.`));
  hc.append(hh);
  const tw = el('div', { class: 'tablewrap', style: 'border:0;border-radius:0' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, ['Company', 'Quantity', 'Weight', `Value (${State.baseCcy})`, 'Price return', 'Currency effect', 'Cost drag', 'Yield (gross)', 'Yield (net, illustrative)', 'Risk', 'Thesis', ''].map((h, i) =>
    el('th', { class: i === 0 ? 'pin' : '' }, h)))));
  const tb = el('tbody');
  [...pos].sort((a, b) => b.valBase - a.valBase).forEach(p => {
    const tr = el('tr');
    const td0 = el('td', { class: 'pin ident' }); td0.append(tickerCell(p.r)); tr.append(td0);
    /* Fractional quantities are shown to three places; whole lots stay clean. */
    tr.append(el('td', { title: `Cost ${fmtMoney(p.h.cost, p.r.c.ccy)} · fee ${fmtMoney(p.h.fee || 0, p.r.c.ccy)} · rebate ${fmtMoney(p.h.rebate || 0, p.r.c.ccy)}` },
      Number.isInteger(p.h.qty) ? p.h.qty.toLocaleString('en-US') : fmtNum(p.h.qty, 3)));
    const NOPX = '<span class="caption" title="No price is carried for this company, so the position has no value, weight or return here.">no price</span>';
    tr.append(el('td', { html: p.unpriced ? NOPX : fmtPct(p.valBase / totalVal * 100, 1) }));
    tr.append(el('td', { html: p.unpriced ? NOPX : fmtAmount(p.valBase, State.baseCcy) }));
    tr.append(el('td', { class: signClass(p.priceRet), title: `In ${p.r.c.ccy}, the reporting currency`, html: p.unpriced ? NOPX : withSign(p.priceRet, 1) }));
    tr.append(el('td', { class: signClass(p.fxRet), title: p.r.c.ccy === State.baseCcy ? 'Same currency as the base — no translation effect' : `Rate at cost ${p.h.fx0.toFixed(2)} → now ${FX.USDMYR.toFixed(2)}`,
      html: p.r.c.ccy === State.baseCcy ? '<span class="caption">same currency</span>' : withSign(p.fxRet, 1) }));
    tr.append(el('td', { class: signClass(p.costDrag), title: 'The part of the return explained by fees net of rebates',
      html: Math.abs(p.costDrag) < 0.005 ? '<span class="caption">—</span>' : withSign(p.costDrag, 2) }));
    tr.append(el('td', {}, fmtPct(p.r.m.dy, 2)));
    tr.append(el('td', { title: `Illustrative withholding of ${State.wht[p.r.c.mkt] ?? 0}% — set on the Compare view` },
      fmtPct(netYield(p.r.m.dy, p.r.c.mkt), 2)));
    tr.append(el('td', { html: riskPill(p.r.risk.band) }));
    tr.append(el('td', { html: p.thesis ? sevChip('good', 'Written').outerHTML : sevChip('warning', 'None').outerHTML }));
    const act = el('td');
    act.append(el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Edit ${p.r.c.tk} holding`,
      onclick: () => openAddHolding(p.h) }, 'Edit'));
    tr.append(act);
    tb.append(tr);
  });
  t.append(tb); tw.append(t); hc.append(tw);
  {
    const np = pos.filter(p => p.unpriced);
    if (np.length) hc.append(el('p', { class: 'metaline', style: 'padding:var(--sm) var(--lg)' },
      `${np.length} holding${np.length === 1 ? '' : 's'} (${np.map(p => p.r.c.tk).join(', ')}) ${np.length === 1 ? 'has' : 'have'} no price carried here and ${np.length === 1 ? 'is' : 'are'} excluded from value, weight and returns rather than counted at nought.`));
  }
  wrap.append(hc);

  /* exposures */
  const ex = el('div', { class: 'grid g-2' });
  const bySector = {}, byType = {};
  pos.forEach(p => {
    bySector[p.r.c.sector] = (bySector[p.r.c.sector] || 0) + p.valBase;
    byType[p.r.c.type] = (byType[p.r.c.type] || 0) + p.valBase;
  });
  [['Sector exposure', bySector], ['Business-model exposure', byType]].forEach(([label, obj]) => {
    const card = el('div', { class: 'card' });
    card.append(cardHead(label, 'Share of portfolio value. Concentration is a fact to notice, not a score.'));
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const bar = el('div', { class: 'pillbar', style: 'height:14px;margin-bottom:var(--md)' });
    entries.forEach(([k, v], i) => bar.append(el('i', { style: `width:${v / totalVal * 100}%;background:var(${SERIES[i % 8]})`, title: k })));
    card.append(bar);
    const l = el('div');
    entries.forEach(([k, v], i) => l.append(el('div', { class: 'row', style: 'gap:8px;padding:6px 0;border-bottom:1px solid var(--grid)' }, [
      el('span', { class: 'legend-key', style: `background:var(${SERIES[i % 8]})` }),
      el('span', { style: 'font-size:13px;color:var(--ink-2)' }, k),
      el('span', { class: 'spacer' }),
      el('span', { class: 'num', style: 'font-size:13px;font-weight:600' }, fmtPct(v / totalVal * 100, 1)),
    ])));
    card.append(l);
    ex.append(card);
  });
  wrap.append(ex);

  /* ---------- income ---------- */
  /* Four different things, kept apart. Money that has arrived, money declared
     but not yet paid, a projection from the last declared rate, and that
     projection after an illustrative withholding. Adding them together — or
     showing a projection where a reader expects a record — is how a portfolio
     page ends up reporting income nobody received. */
  /* Over the holdings that carry a dividend line. The ones that do not are
     counted and named below rather than summed as nought. */
  const withDps = pos.filter(p => !p.noDividendLine);
  const noDpsCount = pos.length - withDps.length;
  const grossIncome = sum(withDps.map(p => p.incomeBase));
  const netIncome = sum(withDps.map(p => p.incomeBase * (1 - (State.wht[p.r.c.mkt] ?? 0) / 100)));
  const received = (State.dividendsReceived || []).filter(x => x.pfId === pf.id && pos.some(p => p.h.id === x.id));
  const recTotal = sum(received.map(x => toBase(num0(x.amount), x.ccy || State.baseCcy)));
  const yr = new Date().getFullYear();
  const recYTD = sum(received.filter(x => String(x.date || '').startsWith(String(yr)))
    .map(x => toBase(num0(x.amount), x.ccy || State.baseCcy)));

  const inc = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  inc.append(cardHead('Income',
    'Received, declared, projected and after-withholding are four separate figures. They are never added together.'
    + (noDpsCount ? ` ${noDpsCount} holding${noDpsCount === 1 ? '' : 's'} carr${noDpsCount === 1 ? 'ies' : 'y'} no dividend line and ${noDpsCount === 1 ? 'is' : 'are'} excluded from the projection — not counted as paying nothing.` : '')));
  const ig2 = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--md)' });
  ig2.append(el('div', { class: 'panel' }, statTile('Dividends received', fmtAmount(recTotal, State.baseCcy),
    { sub: received.length
        ? received.length + ' payment' + (received.length === 1 ? '' : 's') + ' you recorded · ' + fmtAmount(recYTD, State.baseCcy) + ' in ' + yr
        : 'Nothing recorded yet' })));
  ig2.append(el('div', { class: 'panel' }, statTile('Declared but unpaid', 'not available',
    { sub: 'Needs a corporate-actions feed. Bursa publishes none that is machine-readable, so this cannot be filled in honestly.' })));
  ig2.append(el('div', { class: 'panel' }, statTile('Projected, annual', fmtAmount(grossIncome, State.baseCcy),
    { sub: 'Latest declared rate repeated. Not a forecast.' })));
  ig2.append(el('div', { class: 'panel' }, statTile('Projected after withholding', fmtAmount(netIncome, State.baseCcy),
    { sub: 'Illustrative only — the rate that applies depends on your circumstances.' })));
  inc.append(ig2);

  const selH = el('select', { class: 'select select-sm', id: 'divHold', 'aria-label': 'Holding' });
  pos.forEach(p2 => selH.append(el('option', { value: p2.h.id }, p2.r.c.tk + ' — ' + p2.r.c.name)));
  const dDate = el('input', { class: 'input input-inline', type: 'date', id: 'divDate',
    value: new Date().toISOString().slice(0, 10), 'aria-label': 'Payment date' });
  /* The amount is stored in the holding's own currency, so the field says
     which one. Labelled only "Amount" on a page in the reader's base currency,
     ringgit typed for a US holding were counted as dollars — 4.4 times over. */
  const ccyOf = (id) => pos.find(p2 => p2.h.id === id)?.r.c.ccy || State.baseCcy;
  const dAmt = el('input', { class: 'input input-inline', type: 'number', step: '0.01', min: '0',
    placeholder: 'amount', id: 'divAmt', 'aria-label': `Amount received, in ${ccyOf(selH.value)}` });
  const amtLabel = el('label', { for: 'divAmt' }, `Amount (${ccyOf(selH.value)})`);
  selH.addEventListener('change', () => {
    amtLabel.textContent = `Amount (${ccyOf(selH.value)})`;
    dAmt.setAttribute('aria-label', `Amount received, in ${ccyOf(selH.value)}`);
  });
  const addRow = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:flex-end;margin-bottom:var(--md)' });
  addRow.append(el('div', { class: 'field', style: 'margin:0' }, [el('label', { for: 'divHold' }, 'Record a payment'), selH]));
  addRow.append(el('div', { class: 'field', style: 'margin:0' }, [el('label', { for: 'divDate' }, 'Date paid'), dDate]));
  addRow.append(el('div', { class: 'field', style: 'margin:0' }, [amtLabel, dAmt]));
  addRow.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const amount = num0(dAmt.value);
    if (!(amount > 0)) { toast('Enter the amount that was actually paid'); return; }
    /* Recorded against this portfolio. A payment carried no portfolio, so one
       recorded in one portfolio appeared as received in every other portfolio
       holding the same company. */
    State.dividendsReceived = [...(State.dividendsReceived || []),
      { id: selH.value, pfId: pf.id, date: dDate.value, amount, ccy: ccyOf(selH.value) }];
    store.write('dividendsReceived', State.dividendsReceived);
    render();
  } }, 'Add'));
  if (pos.length) inc.append(addRow);

  /* Built from payments actually recorded, not from projected ex-dates. This
     dataset carries no dividend dates, and a calendar of invented ones would be
     fiction with a grid around it. */
  if (received.length) {
    const byMonth = {};
    received.forEach(x => {
      const k = String(x.date || '').slice(0, 7) || 'undated';
      byMonth[k] = (byMonth[k] || 0) + toBase(num0(x.amount), x.ccy || State.baseCcy);
    });
    const cal = el('div', { class: 'tablewrap' });
    const ct = el('table', { class: 'dt' });
    ct.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Month'), el('th', { class: 'num' }, 'Received'), el('th', {}, 'Holdings')])));
    ct.append(el('tbody', {}, Object.keys(byMonth).sort().map(mo => el('tr', {}, [
      el('td', {}, mo),
      el('td', { class: 'num' }, fmtAmount(byMonth[mo], State.baseCcy)),
      el('td', { class: 'metaline' }, received.filter(x => String(x.date || '').startsWith(mo))
        .map(x => { const b = BY_ID.get(x.id); return b ? b.c.tk : null; }).filter(Boolean).join(', ')),
    ]))));
    cal.append(ct);
    inc.append(el('p', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Payments recorded, by month'));
    inc.append(cal);
    inc.append(el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-top:8px', onclick: () => {
      if (!confirm(`Remove every dividend payment recorded in “${pf.name}”? This cannot be undone.`)) return;
      State.dividendsReceived = (State.dividendsReceived || []).filter(x => x.pfId !== pf.id);
      store.write('dividendsReceived', State.dividendsReceived); render();
    } }, 'Clear recorded payments'));
  }
  wrap.append(inc);

  /* ---------- dividend projection ---------- */
  const dc = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  dc.append(cardHead('How the projection is built',
    'Projected income from the current holdings at the latest declared dividend per share. It assumes the distribution is repeated — it is a projection from reported history, not a forecast, and a cut or a special dividend would change it.'));
  /* Each yield divides income by the value or cost of the SAME holdings. The
     income of an unpriced holding over the value of the priced ones overstated
     yield on value, and every holding's cost under the income of the ones with
     a dividend line understated yield on cost. A holding with no dividend line
     is absent from both halves, never counted as paying nothing. */
  const yovSet = withDps.filter(p => !p.unpriced);
  const yovValue = sum(yovSet.map(p => p.valBase));
  const yocCost = sum(withDps.map(p => p.costBase));
  const dg = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--md)' });
  dg.append(el('div', { class: 'panel' }, statTile('Gross income, annual', fmtAmount(grossIncome, State.baseCcy),
    { sub: `Yield on value ${yovValue ? fmtPct(sum(yovSet.map(p => p.incomeBase)) / yovValue * 100, 2) : '—'}${yovSet.length < withDps.length ? ', over the priced holdings' : ''}` })));
  dg.append(el('div', { class: 'panel' }, statTile('Net income, annual', fmtAmount(netIncome, State.baseCcy),
    { sub: 'After the illustrative withholding you set' })));
  dg.append(el('div', { class: 'panel' }, statTile('Gross, monthly average', fmtAmount(grossIncome / 12, State.baseCcy),
    { sub: 'Annual ÷ 12; actual payments are lumpy' })));
  dg.append(el('div', { class: 'panel' }, statTile('Yield on cost', yocCost ? fmtPct(grossIncome / yocCost * 100, 2) : '—',
    { sub: 'Against the cost base including fees, of the holdings with a dividend line' })));
  dc.append(dg);
  const dtw = el('div', { class: 'tablewrap' });
  const dt = el('table', { class: 'dt' });
  dt.append(el('thead', {}, el('tr', {}, ['Company', 'Dividend per share', 'Quantity', `Gross (${State.baseCcy})`, 'Withholding', `Net (${State.baseCcy})`].map(h => el('th', {}, h)))));
  dt.append(el('tbody', {}, [...pos].filter(p => p.incomeBase > 0).sort((a, b) => b.incomeBase - a.incomeBase).map(p =>
    el('tr', {}, [
      el('td', { class: 'ident' }, p.r.c.tk),
      el('td', {}, fmtMoney(p.r.m.dps, p.r.c.ccy, 3)),
      el('td', {}, Number.isInteger(p.h.qty) ? p.h.qty.toLocaleString('en-US') : fmtNum(p.h.qty, 3)),
      el('td', {}, fmtAmount(p.incomeBase, State.baseCcy)),
      el('td', {}, fmtPct(State.wht[p.r.c.mkt] ?? 0, 0)),
      el('td', {}, fmtAmount(p.incomeBase * (1 - (State.wht[p.r.c.mkt] ?? 0) / 100), State.baseCcy)),
    ]))));
  dtw.append(dt); dc.append(dtw);
  dc.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Withholding rates are the illustrative ones you set on the Compare view. Tax actually payable depends on your residency, account type and any treaty — this is not a tax calculation.'));
  wrap.append(dc);

  /* ---------- cross-asset net worth ---------- */
  const xa = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  if (!lim('crossAsset')) {
    xa.append(cardHead('Cross-asset net worth', 'Equities and property in one place, with allocation, combined cash flow and leverage.'));
    xa.append(upsell('Combine shares and property', 'All-Access adds the property portfolio to this view: one allocation, one cash-flow line and one leverage figure across both asset classes. It is the reason the two products exist in the same application.'));
  } else {
    const dm = dealModel(State.deal);
    /* The carrying value is the price. Back-computing it from the exit value
       stopped being the price when the exit value began to include the
       recovered share of the renovation. */
    const propValue = toBase(num0(State.deal.price), 'MYR');
    const propLoan = toBase(dm.loan, 'MYR');
    const propEquity = Math.max(0, propValue - propLoan);
    const netWorth = totalVal + propEquity;
    const propCashflow = toBase(dm.cashflowMonthly * 12, 'MYR');
    const equityIncome = grossIncome;

    xa.append(cardHead('Cross-asset net worth',
      'Equity holdings and the modelled property in one place. Property is carried at the purchase price less the outstanding loan — an entry cost, not a valuation.'));
    const xg = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--md)' });
    xg.append(el('div', { class: 'panel' }, statTile('Net worth', fmtAmount(netWorth, State.baseCcy), { sub: 'Securities, cash and property equity' })));
    xg.append(el('div', { class: 'panel' }, statTile('Property equity', fmtAmount(propEquity, State.baseCcy),
      { sub: `${fmtAmount(propValue, State.baseCcy)} less ${fmtAmount(propLoan, State.baseCcy)} loan` })));
    xg.append(el('div', { class: 'panel' }, statTile('Combined annual cash flow', fmtAmount(equityIncome + propCashflow, State.baseCcy),
      { sub: `${fmtAmount(equityIncome, State.baseCcy)} dividends, ${fmtAmount(propCashflow, State.baseCcy)} net rent`,
        tone: (equityIncome + propCashflow) >= 0 ? '--ok-text' : '--dn-text' })));
    xg.append(el('div', { class: 'panel' }, statTile('Leverage', netWorth > 0 ? fmtPct(propLoan / (netWorth + propLoan) * 100, 1) : '—',
      { sub: 'Debt ÷ gross assets. All of it sits on the property.' })));
    xa.append(xg);

    const bar2 = el('div', { class: 'pillbar', style: 'height:14px;margin-bottom:var(--md)' });
    const parts = [['Equities', securities, '--s1'], ['Cash', cashBase, '--s3'], ['Property equity', propEquity, '--s2']];
    parts.forEach(([, v, cvar]) => bar2.append(el('i', { style: `width:${netWorth ? v / netWorth * 100 : 0}%;background:var(${cvar})` })));
    xa.append(bar2);
    const pl2 = el('div');
    parts.forEach(([label, v, cvar]) => pl2.append(el('div', { class: 'row', style: 'gap:8px;padding:6px 0;border-bottom:1px solid var(--grid)' }, [
      el('span', { class: 'legend-key', style: `background:var(${cvar})` }),
      el('span', { style: 'font-size:13px;color:var(--ink-2)' }, label),
      el('span', { class: 'spacer' }),
      el('span', { class: 'num', style: 'font-size:13px;font-weight:600' }, fmtAmount(v, State.baseCcy)),
      el('span', { class: 'metaline', style: 'min-width:52px;text-align:right' }, fmtPct(netWorth ? v / netWorth * 100 : 0, 1)),
    ])));
    xa.append(pl2);
    xa.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      'Property is illiquid, indivisible and carried at cost; equities are liquid, divisible and marked to market daily. Treating the two as one number is convenient for allocation and misleading for risk — which is why leverage is shown separately.'));
  }
  wrap.append(xa);

  wrap.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'No brokerage connection, no order routing and no personalised allocation advice. Positions are held only in this browser.'));
  return wrap;
};

/* Both editors below work on a COPY and write it back on Save. They edited the
   live record, field by field as each input changed, so closing the drawer
   with Escape, the scrim or × kept the edit in State: the page showed it on the
   next render and the next unrelated save wrote it to storage.

   The company is resolved to a row id before the select is built. The default
   was a bare ticker ('AAPL') that matches no option value ('AAPL-SEC'), so the
   select fell back to showing its first option while an untouched form saved
   the other company. */
function openPriceAlertEditor(existing) {
  const defaultId = BY_ID.get(State.ticker)?.c.id || U[0]?.c.id;
  const pa = existing ? { ...existing }
    : { id: `pa-${Date.now()}`, ticker: defaultId, op: '<', price: 0, note: '' };
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    'A price alert tells you the price moved. It does not tell you anything changed about the business — pair it with a thesis condition if you want that.'));

  const f1 = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  f1.append(el('label', { for: 'pa-co' }, 'Company'));
  const csel = el('select', { class: 'select', id: 'pa-co', onchange: e => {
    pa.ticker = e.target.value;
    const r = BY_ID.get(pa.ticker);
    /* null * 0.9 is 0, so an unpriced company used to prefill a price alert at
       RM0.00 — a threshold that can never trigger, presented as a suggestion. */
    if (r && !existing && isNum(r.c.px?.p)) { pa.price = +(r.c.px.p * 0.9).toFixed(2); $('#pa-price').value = pa.price; }
  } });
  const paRowId = BY_ID.get(pa.ticker)?.c.id;
  U.forEach(r => csel.append(el('option', { value: r.c.id, selected: r.c.id === paRowId ? '' : null },
    `${r.c.tk} — ${fmtMoney(r.c.px.p, r.c.ccy)}`)));
  /* What is saved is what the select shows, whatever it fell back to. */
  if (!existing || paRowId) pa.ticker = csel.value;
  f1.append(csel); body.append(f1);

  const f2 = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  f2.append(el('label', { for: 'pa-op' }, 'Trigger when the price is'));
  const osel = el('select', { class: 'select', id: 'pa-op', onchange: e => pa.op = e.target.value });
  [['<', 'below'], ['>', 'above']].forEach(([v, l]) =>
    osel.append(el('option', { value: v, selected: pa.op === v ? '' : null }, l)));
  f2.append(osel); body.append(f2);

  const f3 = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  f3.append(el('label', { for: 'pa-price' }, 'Price, in the reporting currency'));
  f3.append(el('input', { class: 'input', id: 'pa-price', type: 'number', step: '0.01', value: pa.price,
    onchange: e => pa.price = +e.target.value || 0 }));
  body.append(f3);

  const f4 = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  f4.append(el('label', { for: 'pa-note' }, 'Why this level matters'));
  f4.append(el('input', { class: 'input', id: 'pa-note', value: pa.note || '',
    placeholder: 'e.g. enters my base-case range', onchange: e => pa.note = e.target.value }));
  body.append(f4);

  const acts = el('div', { class: 'row', style: 'gap:8px' });
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!(pa.price > 0)) { toast('Set a price above zero'); return; }
    if (!existing) {
      if (State.priceAlerts.length >= LIMITS.priceAlerts) { toast(`${LIMITS.priceAlerts} price alerts is the maximum`); return; }
      State.priceAlerts.push(pa);
    } else {
      /* Stamped so an edited sample alert counts as the reader's own and is
         kept when the sample data is cleared. */
      Object.assign(existing, pa, { updatedAt: new Date().toISOString() });
    }
    savePriceAlerts(); closeDrawer(); render(); toast(existing ? 'Alert updated' : 'Price alert set');
  } }, existing ? 'Save' : 'Add alert'));
  if (existing) acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    State.priceAlerts = State.priceAlerts.filter(x => x !== existing);
    savePriceAlerts(); closeDrawer(); render(); toast('Alert removed');
  } }, 'Delete'));
  body.append(acts);
  openDrawer(existing ? 'Edit price alert' : 'New price alert', body);
}

/* ------------------------------------------------------ watchlist managing */
function openWatchlistManager() {
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    `Up to ${LIMITS.watchlists} watchlists, each holding up to ${LIMITS.watchlistStocks} companies. Stored in this browser only.`));

  State.watchlists.forEach((w, i) => {
    const card = el('div', { class: 'panel', style: 'margin-bottom:8px' });
    const top = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:6px' });
    top.append(el('input', { class: 'input input-inline', value: w.name, style: 'flex:1 1 150px', 'aria-label': 'Watchlist name',
      onchange: e => { const r = wlRename(w.id, e.target.value); if (!r.ok) toast(r.why); render(); } }));
    top.append(el('span', { class: 'chip' }, `${w.ids.length}/${LIMITS.watchlistStocks}`));
    top.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { State.wlIdx = i; closeDrawer(); render(); } }, 'Open'));
    if (State.watchlists.length > 1) top.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      if (!confirm(`Delete “${w.name}”?`)) return;
      const r = wlDelete(w.id); closeDrawer(); render(); toast(r.ok ? 'Watchlist deleted' : r.why);
    } }, 'Delete'));
    card.append(top);
    card.append(el('div', { class: 'row row-wrap', style: 'gap:4px' },
      w.ids.map(id => BY_ID.get(id)).filter(Boolean).map(r =>
        el('button', { class: 'chip', style: 'cursor:pointer', title: `Remove ${r.c.tk}`,
          onclick: () => toggleWatch(r.c.id, i) }, `${r.c.tk} ×`))));
    body.append(card);
  });

  body.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin:var(--sm) 0 var(--lg)', onclick: () => {
    const r = wlCreate(`Watchlist ${State.watchlists.length + 1}`);
    if (!r.ok) { toast(r.why); return; }
    closeDrawer(); render(); toast('Watchlist created');
  } }, `New watchlist (${State.watchlists.length}/${LIMITS.watchlists})`));

  /* Import: paste tickers or Bursa codes. Anything unmatched is reported rather
     than dropped silently, so a bad import is visible. */
  body.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Import into the active watchlist'));
  body.append(el('p', { class: 'metaline', style: 'margin-bottom:6px' },
    'Paste tickers or Bursa codes separated by commas, spaces or new lines — a CSV column pasted straight from a broker export works.'));
  const ta = el('textarea', { class: 'input', placeholder: 'AAPL, MSFT, 1155, 5347…', style: 'margin-bottom:8px' });
  body.append(ta);
  body.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    const tokens = ta.value.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tokens.length) { toast('Nothing to import'); return; }
    const wl = activeWL();
    const matched = [], unmatched = [], dupes = [];
    /* Through the service, so a token resolves by any name the registry knows
       and a duplicate is refused rather than appended twice. */
    tokens.forEach(tok => {
      const r = wlAdd(wl.id, tok);
      if (r.ok) matched.push(r.id); else if (r.duplicate) dupes.push(tok); else unmatched.push(tok);
    });
    closeDrawer(); render();
    toast(`Imported ${matched.length}${dupes.length ? `, ${dupes.length} already present` : ''}${unmatched.length ? `, ${unmatched.length} not recognised: ${unmatched.slice(0, 4).join(', ')}` : ''}`);
  } }, 'Import'));
  openDrawer('Manage watchlists', body);
}

/* ---------------------------------------------- portfolio & holding editing */
function openPortfolioManager() {
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    `Up to ${LIMITS.portfolios} portfolios, each holding up to ${LIMITS.holdings} positions. Everything is stored in this browser only.`));

  State.portfolios.forEach((p, i) => {
    const card = el('div', { class: 'panel', style: 'margin-bottom:8px' });
    const top = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:8px' });
    top.append(el('input', { class: 'input input-inline', value: p.name, style: 'flex:1 1 160px',
      'aria-label': 'Portfolio name',
      onchange: e => { p.name = e.target.value || 'Untitled'; savePortfolios(); render(); } }));
    top.append(el('span', { class: 'chip' }, `${p.holdings.length}/${LIMITS.holdings}`));
    if (State.portfolios.length > 1) top.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      if (!confirm(`Delete “${p.name}” and its ${p.holdings.length} holdings?`)) return;
      State.portfolios = State.portfolios.filter((_, j) => j !== i);
      /* The active portfolio stays the active one: a deletion above it shifts
         its index down by one, and only deleting it resets to the first. The
         deleted portfolio's recorded payments go with it. */
      State.pfIdx = i < State.pfIdx ? State.pfIdx - 1 : i === State.pfIdx ? 0 : State.pfIdx;
      dropDividendsOf([p.id]);
      savePortfolios(); closeDrawer(); render(); toast('Portfolio deleted');
    } }, 'Delete'));
    card.append(top);
    const cashRow = el('div', { class: 'row', style: 'gap:8px' });
    cashRow.append(el('span', { class: 'caption', style: 'flex:1' }, 'Cash balance'));
    cashRow.append(el('input', { class: 'input input-inline', type: 'number', step: '0.01', value: p.cash || 0,
      style: 'width:120px;text-align:right', 'aria-label': 'Cash balance',
      onchange: e => { p.cash = +e.target.value || 0; savePortfolios(); render(); } }));
    const cc = el('select', { class: 'select input-inline', style: 'width:80px',
      onchange: e => { p.cashCcy = e.target.value; savePortfolios(); render(); } });
    ['USD', 'MYR'].forEach(x => cc.append(el('option', { value: x, selected: (p.cashCcy || 'USD') === x ? '' : null }, x)));
    cashRow.append(cc);
    card.append(cashRow);
    body.append(card);
  });

  body.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:var(--sm)', onclick: () => {
    if (State.portfolios.length >= LIMITS.portfolios) { toast(`${LIMITS.portfolios} portfolios is the maximum`); return; }
    State.portfolios.push({ id: `pf-${Date.now()}`, name: `Portfolio ${State.portfolios.length + 1}`, cash: 0, cashCcy: State.baseCcy, holdings: [] });
    State.pfIdx = State.portfolios.length - 1;
    savePortfolios(); closeDrawer(); render(); toast('Portfolio created');
  } }, `New portfolio (${State.portfolios.length}/${LIMITS.portfolios})`));
  openDrawer('Manage portfolios', body);
}

function openAddHolding(existing) {
  const pf = activePF();
  const defaultId = BY_ID.get(State.ticker)?.c.id || U[0]?.c.id;
  const h = existing ? { ...existing } : { id: defaultId, qty: 0, cost: 0, fx0: FX.USDMYR, fee: 0, rebate: 0 };
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    existing ? 'Editing an existing position.' : `Adding to “${pf.name}”. Quantities may be fractional.`));

  const f1 = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  f1.append(el('label', { for: 'hd-co' }, 'Company'));
  const csel = el('select', { class: 'select', id: 'hd-co', disabled: existing ? '' : null,
    onchange: e => { h.id = e.target.value; } });
  /* A held id may be an older alias of the row ('AAPL' for 'AAPL-SEC'); the
     locked select for an existing holding shows the row it resolves to rather
     than whichever company happens to be listed first. */
  const hRowId = BY_ID.get(h.id)?.c.id;
  U.forEach(r => csel.append(el('option', { value: r.c.id, selected: r.c.id === hRowId ? '' : null },
    `${r.c.tk} — ${r.c.name}`)));
  if (!existing) h.id = csel.value;
  f1.append(csel); body.append(f1);

  /* Each figure has a floor, and the save names the field that is wrong. Only
     quantity was checked, and only for nought, so a negative quantity, a cost
     of nought or a purchase rate of nought saved and produced a −100% cost drag
     or a cost base of nothing. The rate band is the one the price-file loader
     accepts for USD/MYR. */
  const fields = [
    ['qty', 'Quantity (fractional allowed)', 0.0001, 0],
    ['cost', 'Cost per share, in the reporting currency', 0.01, 0],
    ['fee', 'Transaction cost paid', 0.01, 0],
    ['rebate', 'Rebate received', 0.01, 0],
    ['fx0', 'USD/MYR rate on the purchase date', 0.01, 2],
  ];
  fields.forEach(([k, label, step, min]) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    f.append(el('label', { for: `hd-${k}` }, label));
    f.append(el('input', { class: 'input', id: `hd-${k}`, type: 'number', step, min, max: k === 'fx0' ? 8 : null, value: h[k] ?? 0,
      onchange: e => { h[k] = +e.target.value || 0; } }));
    body.append(f);
  });

  const acts = el('div', { class: 'row', style: 'gap:8px' });
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!(h.qty > 0)) { toast('Quantity must be greater than zero'); return; }
    if (!(h.cost > 0)) { toast('Enter the cost per share, above zero'); return; }
    if (!((h.fee || 0) >= 0) || !((h.rebate || 0) >= 0)) { toast('Fees and rebates cannot be negative'); return; }
    if (!(h.fx0 >= 2 && h.fx0 <= 8)) { toast('Enter the USD/MYR rate on the purchase date, between 2 and 8'); return; }
    if (existing) Object.assign(existing, h);
    else {
      if (pf.holdings.length >= LIMITS.holdings) { toast(`${LIMITS.holdings} holdings is the maximum`); return; }
      pf.holdings.push(h);
    }
    savePortfolios(); closeDrawer(); render();
    toast(existing ? 'Holding updated' : 'Holding added');
  } }, existing ? 'Save' : 'Add holding'));
  if (existing) acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    pf.holdings = pf.holdings.filter(x => x !== existing);
    savePortfolios(); closeDrawer(); render(); toast('Holding removed');
  } }, 'Remove'));
  body.append(acts);
  openDrawer(existing ? 'Edit holding' : 'Add holding', body);
}

/* ==========================================================================
   VIEW — ALERTS
   ========================================================================== */

const ALERT_KINDS = [
  { id:'thesis',    label:'Thesis condition',      note:'Fires when a written invalidation condition changes state.' },
  { id:'fundamental',label:'Fundamental change',   note:'A reported metric crosses a threshold you set.' },
  { id:'filing',    label:'Filing or announcement',note:'A new document is published for a company you follow.', built:false },
  { id:'dividend',  label:'Dividend and coverage', note:'A change in the distribution, or in how well cash flow covers it.' },
  { id:'valuation', label:'Valuation band',        note:'Price enters or leaves a range you defined against your own valuation.' },
  { id:'corporate', label:'Corporate action',      note:'Placement, buyback, split, or an entitlement date.', built:false },
  { id:'risk',      label:'Risk flag',             note:'A computed risk flag changes state — leverage, dilution, cash cover, earnings variability.' },
  { id:'screen',    label:'New screen match',      note:'A company enters or leaves one of your saved screens, measured against the snapshot taken when it was saved.' },
  { id:'status',    label:'Local status change',   note:'Shariah status, PN17 or GN3 classification changes.', built:false },
  { id:'price',     label:'Price move',            note:'A price threshold you set, or a large three-month move. Off by default — price alone is not new information.' },
];
/* Which types the feed shows, stored so the choice survives a reload. The
   default is every type but price, as the list has always said. A type marked
   built:false has nothing in this build that produces it — no filings feed, no
   corporate-actions feed, no status register — so its switch is shown disabled
   with that reason rather than as a filter over nothing. */
State.alertKinds = store.read('alertKinds', null) || ALERT_KINDS.filter(k => k.id !== 'price').map(k => k.id);
const saveAlertKinds = () => store.write('alertKinds', State.alertKinds);

/* ==========================================================================
   ONBOARDING — four questions, then one completed task

   The purpose is not to configure the product. It is to get one real thing
   done: a company opened, a holding added, a watchlist made, a property
   calculated. Everything asked is asked because it changes what happens next,
   which is why there is no question about goals or risk tolerance here — those
   would shape a recommendation, and this product does not make one.
   ========================================================================== */
const OB_STEPS = [
  { key:'goal', q:'What would you like Quantum Tradeworks to help you with?',
    note:'This decides where you land at the end, and nothing else.',
    options:[
      { v:'bursa',    t:'Research Bursa companies',      n:'Malaysian listed companies' },
      { v:'us',       t:'Research US companies',         n:'Filed with the SEC, audited annual statements' },
      { v:'monitor',  t:'Monitor my existing portfolio', n:'Track what you already hold' },
      { v:'property', t:'Analyse a property',            n:'Model a purchase to its monthly cash flow' },
      { v:'learn',    t:'Learn investment fundamentals', n:'Start with how the measures work' },
    ] },
  { key:'level', q:'How much of this is familiar already?',
    note:'This sets how much explanation appears by default. It never changes a number, and it never changes what you are shown — only how much is said about it.',
    options:[
      { v:'new',      t:'New investor',                   n:'Explain terms in plain language' },
      { v:'basic',    t:'Comfortable with basic ratios',  n:'Skip the definitions, keep the context' },
      { v:'experienced', t:'Experienced investor',        n:'Formulas and periods, minimal prose' },
    ] },
  { key:'market', q:'Which market are you mainly looking at?',
    note:'Sets the default market filter on the screener. You can always widen it.',
    options:[
      { v:'MY',   t:'Bursa Malaysia' },
      { v:'US',   t:'US equities' },
      { v:'both', t:'Both' },
    ] },
  { key:'ccy', q:'Which currency should totals be shown in?',
    note:'Portfolio values, market capitalisations and comparisons are converted to this. Individual share prices always stay in the currency they trade in.',
    options:[
      { v:'MYR', t:'Malaysian ringgit (RM)' },
      { v:'USD', t:'US dollar ($)' },
    ] },
];

State.onboarding = store.read('onboarding', null);
const onboarded = () => !!State.onboarding?.done;

function completeOnboarding(answers) {
  const done = { ...answers, done: true, at: new Date().toISOString() };
  State.onboarding = done;
  store.write('onboarding', done);

  /* The answers take effect immediately rather than being stored and ignored. */
  if (done.ccy) { State.baseCcy = done.ccy; store.write('baseCcy', done.ccy); }
  setExplainDepth(done.level === 'experienced' ? 'technical' : done.level === 'basic' ? 'context' : 'simple');
  /* The screener filters on `universe`; nothing reads a `market` key, so the
     answer used to be stored and ignored. Written where the launcher's own
     "Which market?" step writes it. Compare has no market filter, so the
     question no longer claims to set one there. */
  if (done.market && done.market !== 'both' && State.screen) {
    State.screen.universe = done.market; store.write('screen', State.screen);
  }

  /* One task, chosen by the first answer, and it is a real destination rather
     than a tour. */
  const FIRST = {
    bursa:    () => { const r = U.find(x => x.c.mkt === 'MY'); r ? openResearch(r.c.id) : navigate('/discover'); },
    /* The option promises SEC-filed, audited statements, and the first US row
       is an illustrative listing. Only a filed company qualifies; while the
       filings are still loading, or if they failed, the reader lands on the
       research home rather than on sample figures. */
    us:       () => { const r = !realPending && U.find(x => x.c.mkt === 'US' && x.c.real); r ? openResearch(r.c.id) : navigate('/research'); },
    monitor:  () => navigate('/my/portfolio'),
    property: () => navigate('/property/calculator'),
    learn:    () => navigate('/learn'),
  };
  (FIRST[done.goal] || (() => navigate('/app')))();
}

/* render() replaces the pressed button, so focus fell to <body> on every step
   and a keyboard reader had to Tab from the top of the page. Focus moves to
   the new question instead, which is also what a screen reader should read. */
function focusObQuestion() { $('.ob-wrap h1')?.focus(); }

VIEWS.onboarding = () => {
  const draft = State.obDraft ||= {};
  const i = Math.min(State.obStep || 0, OB_STEPS.length - 1);
  const step = OB_STEPS[i];

  /* The count is the questions asked. It was OB_STEPS.length + 1, so the last
     question read "Step 4 of 5" and the flow then ended without a fifth. */
  const wrap = el('div', { class: 'ob-wrap' });
  const dots = el('div', { class: 'ob-steps', role: 'progressbar',
    'aria-valuemin': '1', 'aria-valuemax': String(OB_STEPS.length),
    'aria-valuenow': String(i + 1), 'aria-label': `Step ${i + 1} of ${OB_STEPS.length}` });
  for (let k = 0; k < OB_STEPS.length; k++) dots.append(el('div', { class: 'ob-dot', data: { done: k <= i ? '1' : '0' } }));
  wrap.append(dots);

  wrap.append(el('p', { class: 'eyebrow' }, `Step ${i + 1} of ${OB_STEPS.length}`));
  wrap.append(el('h1', { class: 'h-display', tabindex: '-1', style: 'font-size:24px;margin:4px 0 6px' }, step.q));
  wrap.append(el('p', { class: 'body' }, step.note));

  const opts = el('div', { class: 'ob-options' });
  step.options.forEach(o => {
    const btn = el('button', { class: 'ob-option', type: 'button',
      'aria-pressed': draft[step.key] === o.v ? 'true' : 'false',
      onclick: () => {
        draft[step.key] = o.v;
        if (i < OB_STEPS.length - 1) { State.obStep = i + 1; render(); focusObQuestion(); }
        else completeOnboarding(draft);
      } });
    btn.append(el('div', { class: 'ob-option-t' }, o.t));
    if (o.n) btn.append(el('div', { class: 'ob-option-n' }, o.n));
    opts.append(btn);
  });
  wrap.append(opts);

  const foot = el('div', { class: 'row', style: 'gap:10px;margin-top:var(--xl)' });
  if (i > 0) foot.append(el('button', { class: 'btn btn-ghost btn-sm',
    onclick: () => { State.obStep = i - 1; render(); focusObQuestion(); } }, 'Back'));
  foot.append(el('span', { class: 'spacer' }));
  foot.append(el('button', { class: 'btn btn-quiet btn-sm',
    onclick: () => completeOnboarding({ ...draft, skipped: true }) }, 'Skip — take me to the app'));
  wrap.append(foot);
  return wrap;
};

