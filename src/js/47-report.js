/* ==========================================================================
   RESEARCH REPORT — one company, one printable page

   Printing /company/:id printed whichever tab was open, with the tab strip,
   the Studio's sliders and the search bar, and no cover, no legend and no
   record of which dataset or model it came from. A printed page that cannot
   be matched to the data it was drawn from is not a record of anything.

   This route is the company page laid out for paper. Every section is built
   from the functions the screen already uses — derive, metricStatus,
   valuationRun, the PROVENANCE and ABSENCE tables — so the report cannot
   disagree with the page it was printed from. It prints through the same
   print stylesheet as the decision record: navigation and controls hidden,
   light colours from either theme, rows kept whole.

   PDF IS THE BROWSER'S PRINT. There is no server, so nothing here generates a
   PDF, stores a copy or keeps an archive; "Save as PDF" in the print dialog is
   the whole mechanism, and the page says so where the button is.

   REPRODUCIBLE FROM A SAVED RUN. With ?run=<id>, the statements, the price
   and the assumptions come from what the run stored, not from what us.json
   holds now — so a report reprinted after a dataset refresh prints the
   figures that were saved, and says in its data-status block that the live
   data has moved (and how) rather than silently printing something else.
   ========================================================================== */

/* The measures the report prints, in the order a reader asks: returns,
   growth, balance sheet, then what needs a price. */
const REPORT_METRICS = ['roic', 'om', 'fcfm', 'roe', 'cashconv', 'rev5', 'eps5', 'fcf5', 'ndEbit', 'de', 'netGearing', 'pe', 'pb', 'evebit', 'fcfy', 'dy', 'payout'];
/* The statement lines, in the report's order. Their names are the company
   page's (statementLines), so a line reads the same on paper as on screen. */
const REPORT_LINES = ['rev', 'ebit', 'ni', 'ocf', 'capex', 'fcf', 'eq', 'debt', 'cash', 'sh', 'dps'];

/* Where the figures come from: the live dataset, or the statements a saved
   run stored. Returns everything the sections read, so no section reaches
   past it to the live row. */
function reportSource(r, run) {
  const notes = [];
  if (run && run.id !== r.c.id) {
    notes.push({ warn: true, text: `The run named in the address (${run.runId}) is for ${run.ticker || run.id}, not ${r.c.tk}, so this report is rendered from the current dataset instead.` });
    run = null;
  }
  if (run && !run.statements?.fin) {
    notes.push({ warn: true, text: `Run ${run.runId} was saved before runs kept their statements, so its assumptions are printed against the current dataset. Figures other than the valuation may differ from what was on screen when it was saved.` });
  }
  const fromRun = !!(run && run.statements?.fin);
  const c = fromRun
    ? { ...r.c, fin: run.statements.fin, years: run.statements.years,
        px: run.statements.px ? { ...r.c.px, p: run.statements.px.p, manual: run.statements.px.basis === 'entered', eod: run.statements.px.basis === 'eod', asOf: run.statements.px.asOf }
                              : { ...r.c.px, p: null } }
    : r.c;
  const d = fromRun ? derive(c) : r.d;
  const row = { c, d, m: d.m };
  const defaults = fromRun ? defaultInputs(c, d) : r.inputs;
  let inputs = run ? { ...defaults, ...run.inputs } : studioInputs(r);
  /* An input emptied in the Studio is not printed as a number, and the model
     is not run on it: the defaults are printed instead, and said to be. */
  if (!run && ASSUMPTIONS[inputs.model] && blankAssumptions(r, inputs).length) {
    notes.push({ warn: true, text: 'An assumption is empty in the Valuation Studio, so the derived defaults are printed in its place.' });
    inputs = { ...defaults };
  }
  const val = defaults.model === 'unavailable' ? valuationRun(c, d, defaults) : valuationRun(c, d, inputs);
  let moved = null;
  if (run) {
    moved = stampDiff(run.stamp, { model: run.model });
    if (fromRun) {
      const same = JSON.stringify(run.statements.fin) === JSON.stringify(r.c.fin) && JSON.stringify(run.statements.years) === JSON.stringify(yearsOf(r.c));
      moved.statementsSame = same;
    }
  }
  return { c, d, m: d.m, row, defaults, inputs, val, run, fromRun, moved, notes };
}

const reportFig = (label, value, kind) => el('div', { class: 'dr-fig' }, [
  el('div', { class: 'caption' }, label),
  el('div', { class: 'dr-fig-v' }, value),
  kind ? el('div', { class: 'caption rr-kind' }, kind) : null,
]);

VIEWS.researchReport = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const live = BY_ID.get(State.ticker);
  if (!live) { wrap.append(el('div', { class: 'card' }, emptyState('No company is selected for a report.'))); return wrap; }

  /* The same meter as the company page: a report is that company's research. */
  if (!noteReportRead(live.c.id)) {
    wrap.append(upsell(`You have used all ${lim('reportsPerMonth')} company reports this month`,
      `The Free plan covers ${lim('reportsPerMonth')} distinct companies a calendar month, and a printable report of one you have already opened costs nothing more.`));
    return wrap;
  }

  const qs = new URLSearchParams(location.search);
  const runId = qs.get('run');
  const run = runId ? (store.read('runs', []) || []).find(x => x.runId === runId) || null : null;
  const S = reportSource(live, run);
  const { c, d, m, row, inputs, defaults, val } = S;
  const companyHref = companyPath(live.c);
  const reportHref = `${companyHref}/report`;
  if (runId && !run) S.notes.unshift({ warn: true, text: `No saved run called ${runId} is held in this browser, so this report is rendered from the current dataset.` });

  /* ---------- the chrome: not part of what prints ---------- */
  const bar = el('div', { class: 'card dr-chrome' });
  bar.append(cardHead('Research report',
    `${live.c.name} on one page, laid out for printing. ${S.fromRun ? `Rendered from saved run ${S.run.runId}.` : 'Rendered from the current dataset and your current Studio assumptions.'}`));
  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => window.print() }, 'Print or save as PDF'));
  acts.append(el('a', { class: 'btn btn-ghost btn-sm', href: href(companyHref),
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(companyHref); } }, 'Back to the company page'));
  if (S.fromRun || runId) acts.append(el('a', { class: 'btn btn-ghost btn-sm', href: href(reportHref),
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(reportHref); } }, 'Open the live report'));
  else if (ASSUMPTIONS[inputs.model] && !val.err) acts.append(el('button', { class: 'btn btn-ghost btn-sm',
    onclick: () => {
      /* Saving from here stamps the same data version this page prints, and
         the address moves to the run so the page can be reprinted as saved. */
      /* The inputs this page printed, and only a run this press wrote. It
         saved studioInputs, which with an assumption emptied in the Studio
         is refused (the page prints the defaults in its place) — and then
         read runs[0] regardless, so an older run of the same company was
         opened as though it were the one just saved. */
      const before = (store.read('runs', []) || [])[0]?.runId ?? null;
      saveValuationRun(live, inputs);
      const saved = (store.read('runs', []) || [])[0];
      if (saved && saved.runId !== before && saved.id === live.c.id) navigate(`${reportHref}?run=${encodeURIComponent(saved.runId)}`);
    } }, 'Save this run so the report can be reprinted as it is'));
  bar.append(acts);
  bar.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'The PDF is your browser’s own: choose “Save as PDF” as the printer in the print dialog. Nothing is generated on a server, no copy is stored and there is no archive. Printing hides the navigation and these controls, and prints in light colours whatever the screen theme.'));
  wrap.append(bar);

  const card = el('div', { class: 'card' });
  const out = el('article', { class: 'decision-record research-report', 'aria-label': `Research report — ${c.name}` });
  card.append(out);
  wrap.append(card);

  const now = new Date();
  const stampNow = now.toISOString().slice(0, 16).replace('T', ' ');
  const reportId = `QT-${String(c.tk || c.id).replace(/[^A-Za-z0-9]/g, '')}-${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const basis = accountingBasis(c);
  const fy = latestFy(c), fyEnd = fyEndOf(c, fy);

  /* ---------- 1. identification ---------- */
  out.append(el('div', { class: 'dr-head rr-cover' }, [
    el('p', { class: 'eyebrow' }, 'Research report · equities · research only, not advice'),
    el('h1', {}, c.name),
    /* The listing code only where it is not the ticker again. */
    el('p', { class: 'rr-ident' }, [c.tk, c.exch, c.code && c.code !== c.tk ? `code ${c.code}` : null, c.cik ? `CIK ${c.cik}` : null,
      c.sectorWithheld ? 'sector withheld' : c.sector, c.industry && c.industry !== c.sector ? c.industry : null, `reports in ${c.ccy}`]
      .filter(Boolean).join(' · ')),
    el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:8px' }, [
      !c.real ? el('span', { class: 'chip chip-bronze', title: ILLUS_TITLE }, 'illustrative figures')
        : c.personal ? el('span', { class: 'chip chip-bronze' }, 'annual statements — personal research')
        : sevChip('good', 'SEC-filed statements'),
      el('span', { class: 'chip' }, `Accounting basis: ${basis.label}`),
      S.fromRun ? el('span', { class: 'chip chip-bronze' }, `From saved run ${S.run.runId}`) : el('span', { class: 'chip' }, 'From the current dataset'),
    ]),
    el('p', { class: 'metaline', style: 'margin-top:8px' }, `Prepared ${stampNow} UTC · report ${reportId} · ${MODEL_VERSION}`),
  ]));
  if (!c.real) out.append(el('p', { class: 'dr-warn' },
    'Every figure in this report is synthetic. It was made to demonstrate the interface, describes no company, and is not evidence about the business named above.'));

  /* ---------- 2. data status ---------- */
  out.append(el('h2', {}, 'Data status'));
  const ds = el('dl', { class: 'kv rr-kv' });
  const kvRow = (k, v) => { ds.append(el('dt', {}, k)); ds.append(el('dd', {}, v)); };
  kvRow('Source', !c.real ? 'Illustrative set compiled into this build — no filing' : c.personal ? 'Annual statements from your personal-research file — not redistributable' : 'SEC EDGAR companyfacts (XBRL, us-gaap taxonomy)');
  if (c.real) kvRow('Retrieved', c.retrieved || 'not recorded');
  if (c.real && isNum(c.completeness)) kvRow('Statement lines present', `${Math.round(c.completeness * 100)}%`);
  const ys = yearsOf(c);
  kvRow('Years held', `FY${ys[0]}–FY${ys[ys.length - 1]} (${ys.length})`);
  kvRow('Latest fiscal year', `FY${fy}${fyEnd ? `, ended ${fmtFyEnd(fyEnd)}` : c.real ? ' — the period-end date is not in this dataset yet' : ''}`);
  kvRow('Price', isNum(c.px?.p) ? `${fmtMoney(c.px.p, c.ccy)} — ${priceAsOfLabel(c)}` : c.real ? 'No licensed price. Every price-derived figure below is unavailable, and says so.' : 'none');
  kvRow('Coverage', `${m.coverage}% of the measures that apply to a ${c.type} business are computable`);
  kvRow('Model version', MODEL_VERSION);
  kvRow('Data version', S.fromRun ? stampDataText(S.run.stamp) : stampDataText(buildStamp(c)));
  kvRow('Rendered from', S.fromRun ? `Saved run ${S.run.runId}, saved ${S.run.saved}` : 'The current dataset');
  out.append(ds);
  S.notes.forEach(n => out.append(el('p', { class: 'dr-warn' }, n.text)));
  if (S.run && S.moved) {
    const liveData = stampDataText(buildStamp(live.c));
    const parts = [];
    parts.push(`Prepared from run ${S.run.runId}, saved ${S.run.saved} against ${S.run.stamp ? stampDataText(S.run.stamp) : 'a data version that was not recorded'}; the current dataset is ${liveData}.`);
    if (S.moved.status !== 'current') parts.push(S.moved.text);
    if (S.fromRun) parts.push(S.moved.statementsSame
      ? `The live statements for ${live.c.tk} are identical to the ones saved with the run.`
      : `The live statements for ${live.c.tk} differ from the ones saved with the run; this report prints the saved ones.`);
    out.append(el('p', { class: (S.moved.status !== 'current' || S.moved.statementsSame === false) ? 'dr-warn' : 'rr-ok' }, parts.join(' ')));
  }

  /* ---------- 3. financial summary ---------- */
  out.append(el('h2', {}, `Financial summary — FY${fy}`));
  /* The kind of each line; the long form names the XBRL concept, for the
     statements table, and the short form fits under a headline figure. */
  const kindOfLine = (k, short = false) => {
    if (!c.real) return 'Illustrative';
    if (k === 'fcf') return short ? 'Calculated' : 'Calculated — operating cash flow less capex';
    if (c.personal) return 'Reported — statements you supplied';
    const keys = LINE_PROV[k]?.keys || [k];
    const p = c.provenance && typeof c.provenance === 'object' ? keys.map(x => c.provenance[x]).find(Boolean) : null;
    if (short) return p?.mixedTags ? 'Reported · XBRL, more than one tag' : 'Reported · XBRL';
    return p?.concept ? `Reported · ${String(p.concept).split(' + ')[0]}${p.mixedTags ? ' (more than one tag)' : ''}` : 'Reported';
  };
  /* THE PAGE'S LINES, UNDER THE PAGE'S NAMES. The report kept its own list:
     it called a filed bank's pre-tax income "Operating profit (EBIT)" where
     the company page, from the concept the ingest recorded, says "Profit
     before tax, after provisions"; it printed a bank's operating cash flow,
     capital expenditure, free cash flow and cash, which the page omits as
     meaningless on a deposit-taking balance sheet (JPMorgan's headline read
     "Operating cash flow −$147.8B"); and it printed a dividend CAGR across a
     share-count break the page withholds (Apple, 4.7%). statementLines is
     what the page's table reads, so the report now reads it too. */
  const pageLines = statementLines(row);
  const pageLine = (k) => pageLines.find(l => l.key === k) || null;
  const figs = el('div', { class: 'dr-figs' });
  [['Revenue', last(d.rev), 'rev'], [pageLine('ebit')?.label || 'Operating profit', last(d.ebit), 'ebit'], ['Net income', last(d.ni), 'ni'],
   ['Operating cash flow', last(d.ocf), 'ocf'], ['Free cash flow', m.fcf, 'fcf'],
   ['Net debt', m.netDebt, 'debt']].forEach(([label, v, k]) => {
    const na = k === 'debt' ? c.type === 'bank' : !pageLine(k);
    figs.append(reportFig(label,
      na ? 'Not applicable' : isNum(v) ? fmtCap(v, c.ccy) : 'Not reported',
      !na && isNum(v) ? (k === 'debt' ? (c.real ? 'Calculated — debt less cash' : 'Illustrative') : kindOfLine(k, true)) : null));
  });
  out.append(figs);

  /* ---------- 4. selected metrics ---------- */
  out.append(el('h2', {}, 'Selected metrics'));
  const prior = c.fin.length > 1 ? derive({ ...c, fin: c.fin.slice(0, -1), years: yearsOf(c).slice(0, -1) }).m : null;
  const mt = el('table', { class: 'dt dr-table rr-table' });
  mt.append(el('thead', {}, el('tr', {}, ['Measure', `FY${fy}`, 'Kind', `FY${ys[ys.length - 2] ?? '—'}`, 'Formula'].map((h, i) =>
    el('th', { style: i === 0 || i === 2 || i === 4 ? 'text-align:left' : null }, h)))));
  const mb = el('tbody');
  REPORT_METRICS.filter(k => FIELD_BY_K[k]).forEach(k => {
    const f = FIELD_BY_K[k], st = metricStatus(row, k);
    const priceBased = (FIELD_INPUTS[k] || []).some(l => l === 'price' || l === 'history');
    const pv = prior && !priceBased && isNum(prior[k]) ? f.fmt(prior[k], row) : priceBased ? 'no prior price' : '—';
    mb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, f.label),
      el('td', {}, st.available ? f.fmt(m[k], row) : st.label),
      el('td', { style: 'text-align:left;white-space:normal' }, st.available ? st.label
        : [el('span', {}, `Unavailable — ${st.reason}`), el('span', { class: 'caption rr-why' }, st.text)]),
      el('td', {}, pv),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, f.formula || ''),
    ]));
  });
  mt.append(mb);
  out.append(el('div', { class: 'tablewrap' }, mt));
  out.append(el('p', { class: 'metaline' },
    'An absent figure is printed with its reason, never left blank and never filled in. The prior-year column re-derives each measure on the statements one year earlier; a measure that needs a price has no prior value, because the price has no prior date here.'));

  /* ---------- 5. historical statements ---------- */
  out.append(el('h2', {}, 'Historical statements'));
  const span = Math.min(6, ys.length);
  const hy = ys.slice(-span);
  const colOf = { rev: d.rev, ebit: d.ebit, ni: d.ni, ocf: d.ocf, capex: d.capex, fcf: d.fcf, eq: d.eq, debt: d.debt, cash: d.cash, sh: d.sh, dps: d.dps };
  const ht = el('table', { class: 'dt dr-table rr-table rr-hist' });
  ht.append(el('thead', {}, el('tr', {}, ['Line', ...hy.map(y => `FY${y}`), '4-year CAGR', 'Kind'].map((h, i) =>
    el('th', { style: i === 0 || i === hy.length + 2 ? 'text-align:left' : null }, h)))));
  const hb = el('tbody');
  REPORT_LINES.filter(k => pageLine(k)).forEach(k => {
    const line = pageLine(k), label = line.label;
    const series = colOf[k] || [];
    const tail = series.slice(-span);
    const g0 = ['rev', 'ebit', 'ni', 'ocf', 'fcf', 'eq', 'dps'].includes(k) ? cagr(series.slice(-5)) : null;
    /* The statement table's rule: a per-share line across a share-count
       break has no growth rate, only the break. */
    const withheld = line.perShare && m.shareSeriesBreak && isNum(g0);
    const g = withheld ? null : g0;
    hb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, label),
      ...tail.map(v => el('td', {}, isNum(v) ? fmtNum(v, k === 'dps' ? 3 : 2) : el('span', { class: 'caption' }, 'not reported'))),
      el('td', {}, isNum(g) ? fmtPct(g) : withheld ? el('span', { class: 'caption', title: 'The share count jumps inside the stored window — a split, merger or offering — so a growth rate over a per-share line would measure that event. Withheld, as on the company page.' }, 'withheld') : '—'),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, kindOfLine(k)),
    ]));
  });
  ht.append(hb);
  out.append(el('div', { class: 'tablewrap' }, ht));
  out.append(el('p', { class: 'metaline' },
    `Billions of ${c.ccy}, except shares (billions) and dividend per share (${c.ccy}). Fiscal-year labels are the company’s own. A CAGR needs a positive figure at both ends of the window and is otherwise left blank.`
    + (m.shareSeriesBreak ? ` A per-share CAGR is withheld: the share count moves from ${fmtNum(m.shareSeriesBreak.from, 2)}bn to ${fmtNum(m.shareSeriesBreak.to, 2)}bn between two years held — a split, merger or offering, which the filings are not restated for.` : '')
    + (c.type === 'bank' ? ' Operating cash flow, capital expenditure, free cash flow and cash are not shown for a bank, as on the company page: they are not meaningful measures for a deposit-taking balance sheet.' : '')));

  /* ---------- 6. valuation and the reader's assumptions ---------- */
  out.append(el('h2', {}, 'Valuation — the assumptions and what they produce'));
  if (defaults.model === 'unavailable' || val.err) {
    out.append(el('p', { class: 'body' }, `No valuation is available: ${val.err || defaults.reason}`));
  } else {
    out.append(el('p', { class: 'body', style: 'font-size:13px;margin-bottom:var(--sm);max-width:72ch' }, `${val.pack.name}. ${val.pack.why}`));
    const list = assumptionList(defaults, val.pack.id);
    const at = el('table', { class: 'dt dr-table rr-table' });
    at.append(el('thead', {}, el('tr', {}, ['Assumption', 'Value used', 'Derived default', 'Whose'].map((h, i) =>
      el('th', { style: i === 0 || i === 3 ? 'text-align:left' : null }, h)))));
    let nEdited = 0;
    at.append(el('tbody', {}, list.map(a => {
      const saved = S.run?.assumptions?.[a.k];
      const edited = saved ? !!saved.edited : !sameInput(inputs[a.k], defaults[a.k]);
      const dflt = saved ? saved.default : defaults[a.k];
      if (edited) nEdited++;
      return el('tr', {}, [
        el('td', { style: 'text-align:left' }, a.label),
        el('td', {}, fmtAssumption(a, inputs[a.k])),
        el('td', {}, fmtAssumption(a, dflt)),
        el('td', { style: 'text-align:left' }, edited ? 'Edited by you' : 'Derived default'),
      ]);
    })));
    out.append(el('div', { class: 'tablewrap' }, at));
    out.append(el('p', { class: 'metaline' }, nEdited
      ? `${nEdited} of ${list.length} assumptions are yours rather than derived from the statements. The figures below are computed on them.`
      : 'Every assumption is the default derived from the company’s own statements.'));
    const vf = el('div', { class: 'dr-figs' });
    [['Bear case', val.vals.bear], ['Base case', val.vals.base], ['Bull case', val.vals.bull]].forEach(([l, v]) =>
      vf.append(reportFig(`${l}, per share`, isNum(v) ? fmtMoney(v, c.ccy) : 'Not computed',
        isNum(v) && isNum(c.px?.p) ? `${withSign((v - c.px.p) / c.px.p * 100, 0)} against the price` : 'Modelled')));
    vf.append(reportFig('Confidence', `${val.conf}/100`, `${val.confBand}${val.confParts ? ` — completeness ${val.confParts.coverage}, fit ${val.confParts.type}, band ${val.confParts.band ?? '—'}` : ''}`));
    out.append(vf);
    (val.caseNotes || []).forEach(t => out.append(el('p', { class: 'dr-warn' }, t)));
    const ex = explainCalculation({ c, inputs: defaults }, inputs, val);
    ex.open = true;
    out.append(ex);
    out.append(el('h3', { class: 'rr-h3' }, 'Limitations of this model'));
    out.append(el('ul', { class: 'ticklist blocklist' }, val.pack.limits.map(x => el('li', {}, x))));
  }

  /* ---------- 7. provenance and methodology ---------- */
  out.append(el('h2', {}, 'How to read the figures'));
  out.append(el('p', { class: 'body', style: 'font-size:13px' }, 'Every figure in this report is one of five kinds, and every absent one gives one of five reasons.'));
  const legend = el('dl', { class: 'kv rr-kv rr-legend' });
  ['reported', 'calculated', 'market', 'modelled', 'illustrative'].forEach(k => {
    legend.append(el('dt', {}, PROVENANCE[k].label)); legend.append(el('dd', {}, PROVENANCE[k].note));
  });
  out.append(legend);
  const absent = el('dl', { class: 'kv rr-kv rr-legend' });
  Object.entries(ABSENCE).forEach(([k, a]) => { absent.append(el('dt', {}, `Unavailable — ${k}`)); absent.append(el('dd', {}, a.legend)); });
  out.append(absent);
  out.append(el('h3', { class: 'rr-h3' }, 'Methodology and versions'));
  out.append(el('ul', { class: 'rr-plain' }, [
    el('li', {}, `How each measure is defined and each model chosen: ${location.origin}${href('/methodology')}`),
    el('li', {}, `Where the data comes from and what it does not cover: ${location.origin}${href('/data-sources')}`),
    el('li', {}, `Model version ${MODEL_VERSION}; data version ${S.fromRun ? stampDataText(S.run.stamp) : stampDataText(buildStamp(c))}.`),
    el('li', {}, 'This document was produced by the browser’s print function from a page of Quantum Tradeworks. No server generated it and no copy of it is kept.'),
    el('li', {}, 'Research only. It is not advice, not a recommendation and not a rating, and it says nothing about whether this company suits anyone.'),
  ]));
  return wrap;
};
