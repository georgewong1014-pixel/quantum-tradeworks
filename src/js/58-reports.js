/* ==========================================================================
   REPORTS — WHAT THE READER'S OWN WORK CAN PRINT (Release B, /my/reports)

   Every report in the product is a page of the tool that makes it: a
   company's research report (/company/:id/report), a saved property's
   investor report (the calculator's Report section), its decision record and
   its client proposal (/property/models/:property/proposal, a preview), and
   the Cash Wheel's and the Trading Index's decision records
   (/decision-record). Each was reached only from inside its tool, so a
   reader looking for a report had to remember which tool, which company,
   which property. This page lists them, from the reader's own work in this
   browser, and every row opens the real report: it prints as it always has,
   through the browser's own print — "Save as PDF" as the printer, the
   navigation and controls hidden. Nothing is generated here, stored or kept.

   WHOSE WORK. A company is listed when the reader opened it — the companies
   last read here, those read this calendar month, and any with a valuation
   run they saved — or put it on a list of their own; a seeded sample list's
   companies are not theirs (myDashOwnIds). A property is listed when it is
   saved in My properties. The Cash Wheel and the Trading Index each hold one
   piece of work, and its record is listed only when that work is the
   reader's: a contract they entered, not the worked one; chart evidence
   they recorded, not the §14 example (the launcher's own rule, 55-views-
   public.js).

   THE ALLOWANCE. A company's report is metered as its page is
   (reportAllowed, 05-plans.js): distinct companies a calendar month, a
   company already opened this month costing nothing more. Each row says
   what opening it would do, and the page says what is left in the company
   page's words. Listing spends nothing; a report the meter would refuse is
   said to be unavailable, not offered as a link to the refusal.
   ========================================================================== */

/* It names companies, so it waits for the filings as every such page does
   (UNIVERSE_VIEWS, 35-ui.js) — registered from here, as the scanner's pages
   and the research queue register theirs. */
UNIVERSE_VIEWS.add('reports');

/* The chevron a row that is a link ends with (My Alerts' scanner rows too). */
const ROW_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

/* The companies whose research report the reader's own work can print, in
   the order the reader last came to them: those read here most recently
   first, then those read this month, then those with a saved valuation run,
   then those on a list of their own — each with why it is listed. A company
   the loaded data does not hold (a filed one, with the filings failed) is
   not listed; the page says so. */
function reportCompanies() {
  const out = new Map();
  const add = (id) => {
    const row = id ? BY_ID.get(id) : null;
    if (!row) return null;
    if (!out.has(row.c.id)) out.set(row.c.id, { row, opened: false, runs: [], lists: [] });
    return out.get(row.c.id);
  };
  (State.recentCompanies || []).forEach(id => { const e = add(id); if (e) e.opened = true; });
  if (State.reportLog?.month === meterMonth()) (State.reportLog.ids || []).forEach(id => { const e = add(id); if (e) e.opened = true; });
  /* Newest first, as the store keeps them. */
  (store.read('runs', []) || []).forEach(run => { const e = add(run?.id); if (e) e.runs.push(run); });
  (State.watchlists || []).forEach(w => {
    const mine = typeof myDashOwnIds === 'function' ? myDashOwnIds(w) : (w?.ids || []);
    mine.forEach(id => { const e = add(id); if (e && !e.lists.includes(w.name)) e.lists.push(w.name); });
  });
  return [...out.values()];
}

/* What opening a company's report would do to this month's allowance, by
   the meter's own rule. */
function reportMeterFor(id) {
  if (!Number.isFinite(lim('reportsPerMonth'))) return { state: 'unmetered' };
  const r = reportAllowed(id);
  if (r.ok && !r.counted) return { state: 'opened' };
  return r.ok ? { state: 'costs', left: reportsLeft() } : { state: 'refused' };
}
/* The first day of next month, when a refused report opens again. */
const reportNextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); };

/* The allowance, in the company page's words (VIEWS.research): what the plan
   covers, and what this month has used. */
function reportAllowanceLine() {
  const p = planOf(), limit = lim('reportsPerMonth');
  if (!Number.isFinite(limit)) return `The ${p.name} plan, previewed in this browser, sets no monthly limit on company reports.`;
  const used = State.reportLog.ids.length;
  const tks = State.reportLog.ids.map(x => BY_ID.get(x)?.c.tk).filter(Boolean);
  return `The ${p.name} plan covers ${limit} distinct company reports a calendar month, and revisiting one you have already opened never costs another. `
    + `This month: ${used} of your ${limit} used${tks.length ? ` (${tks.join(', ')})` : ''} — ${reportsLeft()} left.`;
}

/* An in-app link that keeps the browser's own link behaviour. */
const reportLink = (path, attrs, ...kids) => el('a', { href: href(path), ...attrs,
  onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path); } }, ...kids);

/* A saved property's two reports. The property on the calculator is
   reported as it stands there — its open scenario and any changes not yet
   saved, which the report and the record both say — rather than reloaded
   over them. Another is opened as My properties opens it (openPropertyModel):
   whatever was on the calculator that exists nowhere else is kept aside
   first, and "Restore my previous deal" puts it back. */
function reportsOpenProperty(rec, to) {
  if (State.deal?.modelId !== rec.id && !openPropertyModel(rec.id, { show: false })) return;
  if (to === 'record') { State.decisionSubject = 'property'; navigate('/decision-record'); return; }
  navigate('/property/calculator');
  /* To the Report section once the calculator has settled — its data landing
     redraws the page above the section — as an address naming the section
     is landed on (propertyArrivalSection, 71-property-models.js). */
  const at = Date.now();
  const land = () => {
    if (State.view !== 'property') return;
    if (typeof propertyPagesSettled === 'function' && !propertyPagesSettled() && Date.now() - at < 10000) { setTimeout(land, 200); return; }
    goToPropertySection('report', { instant: true });
  };
  setTimeout(land, 0);
}
/* The Cash Wheel's and the Trading Index's records print the tool's current
   work; the record page draws the subject chosen when it is ready. */
function reportsOpenRecord(subject) {
  State.decisionSubject = subject;
  navigate('/decision-record');
}

/* Whether each tool's current work is the reader's own, by the launcher's
   rule: a contract with a put strike that is not the worked contract; chart
   evidence that is not the §14 example and names a symbol or a panel. */
const reportsWheelOwn = () => num0(State.wheel?.putStrike) > 0 && !State.wheel?.isWorkedExample;
function reportsQttiOwn() {
  const q = State.qtti;
  return !!q && JSON.stringify(q) !== JSON.stringify(qttiWorkedExample())
    && (String(q.symbol || '').trim() !== '' || ['daily', 'weekly', 'monthly'].some(t => q.timeframes?.[t]?.present));
}

/* A section: a card with a heading the section is named by, a sentence, and
   what the heading's right holds. */
function reportsSection(id, title, sub) {
  const sec = el('section', { class: 'card rp-sec', id, 'aria-labelledby': `${id}-hd` });
  sec.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h2', { class: 'h-card', id: `${id}-hd` }, title),
    el('p', { class: 'caption', style: 'margin-top:2px;max-width:66ch' }, sub),
  ])));
  return sec;
}
/* A section with nothing in it says what to do, with the action that does it. */
const reportsNone = (text, ...acts) => el('div', { class: 'rp-none' }, [el('p', { class: 'caption' }, text), acts.length ? el('div', { class: 'rp-acts' }, acts) : null]);
const reportsRow = (id, main, acts) => el('li', { class: 'rp-row', 'data-id': id }, [el('div', { class: 'rp-row-main' }, main), el('div', { class: 'rp-acts' }, acts)]);

VIEWS.reports = () => {
  const wrap = el('div', { class: 'rp-page' });
  wrap.append(mySubnav('reports'));
  /* The workspace's one page head (pageHead, 36-layouts.js): a lede a phone
     shows whole, the rest in the note under it. */
  wrap.append(pageHead({ title: 'Reports',
    lede: 'Every report your own work in this browser can produce, each opening the real one.',
    note: 'Print one, or save it as PDF through your browser’s print. Nothing is generated on a server and no copy is kept.' }));

  /* A log kept from an earlier month counts nothing now: the meter's own turn
     to a new month (reportAllowed, 05-plans.js), made once before anything
     here reads it, so the rows and the allowance line read the same month. */
  if (State.reportLog?.month !== meterMonth()) State.reportLog = { month: meterMonth(), ids: [] };
  const cos = reportCompanies();
  const props = pmAll().sort((a, b) => String(pmUpdated(b) || '').localeCompare(String(pmUpdated(a) || '')));
  const wheelOwn = reportsWheelOwn(), qttiOwn = reportsQttiOwn();

  /* Nothing of the reader's own: what a report is, and the one way to make one. */
  if (!cos.length && !props.length && !wheelOwn && !qttiOwn) {
    const empty = el('section', { class: 'card rp-empty', id: 'rp-empty', 'aria-labelledby': 'rp-empty-hd' });
    empty.append(el('h2', { class: 'h-card', id: 'rp-empty-hd' }, 'No reports yet'));
    empty.append(el('p', { class: 'body' },
      'A report is one page made from your own work, laid out to print or save as PDF: a company’s research report — its statements, its measures and your valuation assumptions, with where every figure came from — a saved property’s investor report, decision record and client proposal, or the decision record of a Cash Wheel contract or of Trading Index chart evidence.'));
    empty.append(el('p', { class: 'caption' },
      'Open a company’s page, save a property, enter a contract or record chart evidence, and its report is listed here.'));
    empty.append(reportLink(productById('equities')?.actionPath || '/research', { class: 'btn btn-primary' }, productById('equities')?.action || 'Start research'));
    wrap.append(empty);
    return wrap;
  }

  /* ---------- company research reports ---------- */
  /* A section with nothing in it is headed without a count: what it says
     under its heading is what to do, not a nought. */
  const cs = reportsSection('rp-companies', `Company research reports${cos.length ? ` — ${cos.length}` : ''}`,
    'One company on one printable page: its statements, its measures with their status, your valuation assumptions and where every figure came from. Listed for the companies you opened here or keep on a list of your own.');
  cs.append(el('div', { class: 'rp-meter', id: 'rp-meter' }, [el('span', { class: 'chip' }, 'This month’s allowance'), el('p', { class: 'metaline' }, reportAllowanceLine())]));
  const filings = typeof toolSource === 'function' ? toolSource('filings') : null;
  if (filings?.state === 'unavailable') cs.append(el('p', { class: 'caption rp-warn' },
    `${filings.why} A filed company you opened is listed again once they load.`));
  if (!cos.length) cs.append(reportsNone('No company yet. Open a company’s page, or add one to a watchlist of your own, and its research report is listed here.',
    reportLink('/research', { class: 'btn btn-ghost btn-sm' }, productById('equities')?.action || 'Start research')));
  else {
    const ul = el('ul', { class: 'rp-list', 'aria-label': 'Company research reports' });
    cos.forEach(({ row, opened, runs, lists }) => {
      const c = row.c;
      const base = `${companyPath(c)}/report`;
      const meter = reportMeterFor(c.id);
      const why = [opened ? 'opened in this browser' : null,
        lists.length ? `on your list${lists.length === 1 ? '' : 's'} ${lists.map(n => `“${n}”`).join(', ')}` : null,
        runs.length ? `${runs.length} saved valuation run${runs.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
      const meterSaid = meter.state === 'opened' ? 'Opened this month — its report costs nothing more.'
        : meter.state === 'costs' ? `Not opened this month — opening its report uses 1 of the ${meter.left} left.`
        : meter.state === 'refused' ? `This month’s ${lim('reportsPerMonth')} company reports are used, and it was not one of them — its report opens again on ${reportNextMonth()}.`
        : null;
      const acts = meter.state === 'refused'
        ? [el('span', { class: 'rp-off' }, 'Not available this month')]
        : [reportLink(base, { class: 'btn btn-ghost btn-sm', 'aria-label': `Research report — ${c.name}` }, 'Research report'),
           /* A run reprints the figures it saved (47-report.js), newest first. */
           ...runs.slice(0, 3).map(run => reportLink(`${base}?run=${encodeURIComponent(run.runId)}`, { class: 'btn btn-quiet btn-sm', 'aria-label': `Research report of ${c.tk} as saved in run ${run.runId}` },
             `As saved ${String(run.stamp?.savedAt || run.saved || '').slice(0, 10) || run.runId}`))];
      ul.append(reportsRow(c.id, [
        el('div', { class: 'rp-chips' }, [
          !c.real ? el('span', { class: 'chip chip-bronze', title: ILLUS_TITLE }, 'illustrative figures')
            : c.personal ? el('span', { class: 'chip chip-bronze' }, 'annual statements — personal research')
            : el('span', { class: 'chip' }, 'SEC-filed statements'),
          /* D6: the report's figures' kind. */
          kindBadge(rowKind(c), { fine: 'The report’s figures', link: false }),
        ]),
        el('strong', { class: 'rp-name' }, c.name),
        el('span', { class: 'metaline' }, [c.tk, why].filter(Boolean).join(' · ')),
        meterSaid ? el('span', { class: 'caption rp-said' }, meterSaid) : null,
        runs.length > 3 ? el('span', { class: 'caption rp-said' }, `The three newest runs are here; Saved Models lists all ${runs.length}.`) : null,
      ], acts));
    });
    cs.append(ul);
  }
  wrap.append(cs);

  /* ---------- property reports ---------- */
  const st = propertyStatus(State.deal);
  const ps = reportsSection('rp-properties', `Property reports${props.length ? ` — ${props.length} ${props.length === 1 ? 'property' : 'properties'}` : ''}`,
    'For each property saved in My properties: its investor report — the calculator’s Report section for it, with the grade, what the answer rests on and the gates still open — its decision record, the one printable page of it, carried to a lender or a lawyer, and its client proposal, the property and up to three of its scenarios set out for a client to read (a preview, in no plan).');
  if (!props.length) ps.append(reportsNone('No property saved yet. Save one on the calculator, and its investor report, decision record and client proposal are listed here.',
    reportLink('/property/calculator', { class: 'btn btn-ghost btn-sm' }, productById('property')?.action || 'Analyse a property')));
  else {
    const ul = el('ul', { class: 'rp-list', 'aria-label': 'Property reports' });
    props.forEach(rec => {
      const d = pmInputsOf(rec);
      const onCalc = st.kind === 'model' && st.rec?.id === rec.id;
      const nSc = (rec.scenarios || []).length;
      const full = typeof propertyReportUnlocked === 'function' && propertyReportUnlocked(d.projectId);
      ul.append(reportsRow(rec.id, [
        el('div', { class: 'rp-chips' }, [
          onCalc ? el('span', { class: 'chip chip-brand' }, st.dirty ? 'On the calculator · unsaved changes' : 'On the calculator') : null,
          workIsSample(rec) ? el('span', { class: 'chip chip-bronze', title: 'Every figure in it is the calculator’s sample input. Not your figures.' }, 'sample') : null,
          /* D6: the property's figures' kind, its weakest input. */
          (() => { const k = workIsSample(rec) ? { kind: 'illustrative', fine: 'The sample deal' } : dealKind(d); return kindBadge(k.kind, { fine: k.fine, link: false }); })(),
          nSc ? el('span', { class: 'chip' }, `${nSc} scenario${nSc === 1 ? '' : 's'}`) : null,
          full ? el('span', { class: 'chip', title: 'The full investor report is previewed in this browser for this property’s project — nothing is on sale, and nothing was charged.' }, 'full report previewed') : null,
        ]),
        el('strong', { class: 'rp-name' }, rec.name),
        el('span', { class: 'metaline' }, `${pmPlace(d)} · ${d.propertyType || 'Property'} · saved ${pmWhen(pmUpdated(rec))}`),
        /* The proposal is the property as saved (72-property-proposal.js),
           so only the two that show the calculator are said to. */
        onCalc ? el('span', { class: 'caption rp-said' }, `Its investor report and decision record show what is on the calculator${st.sc ? `, the scenario “${st.sc.name}” open` : ''}${st.dirty ? ', the changes not yet saved included — each says so; its client proposal is the property as saved' : ''}.`) : null,
      ], [
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: `rp-inv-${rec.id}`, 'data-tool-path': '/property/calculator',
          'aria-label': `Investor report — ${rec.name}`, onclick: () => reportsOpenProperty(rec, 'report') }, 'Investor report'),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: `rp-rec-${rec.id}`,
          'aria-label': `Decision record — ${rec.name}`, onclick: () => reportsOpenProperty(rec, 'record') }, 'Decision record'),
        cpLink(rec, { id: `rp-cp-${rec.id}` }),
      ]));
    });
    ps.append(ul);
  }
  wrap.append(ps);

  /* ---------- the Cash Wheel's and the Trading Index's records ---------- */
  const tools = [wheelOwn, qttiOwn].filter(Boolean).length;
  /* The count is of records that can be printed: chart evidence the index
     cannot assess yet is listed, with what it lacks, but prints nothing. */
  const qttiNow = qttiOwn ? qttiRun(State.qtti) : null;
  const printable = (wheelOwn ? 1 : 0) + (qttiNow?.assessable ? 1 : 0);
  const rs = reportsSection('rp-records', `Cash Wheel and Trading Index records${printable ? ` — ${printable}` : ''}`,
    'Each tool holds one piece of work at a time, and its decision record prints it: the figures, what is unresolved and what the record does not tell you.');
  if (!tools) rs.append(reportsNone('Neither tool holds work of yours yet. Enter a contract on the Cash Wheel, or record chart evidence on the Trading Index, and its decision record is listed here.',
    reportLink('/us-options/wheel', { class: 'btn btn-ghost btn-sm' }, 'Model a wheel'),
    reportLink('/research/trading-index', { class: 'btn btn-ghost btn-sm' }, 'Assess a trend')));
  else {
    const ul = el('ul', { class: 'rp-list', 'aria-label': 'Cash Wheel and Trading Index records' });
    if (wheelOwn) {
      const p = State.wheel;
      ul.append(reportsRow('wheel', [
        el('div', { class: 'rp-chips' }, el('span', { class: 'chip' }, 'Cash Wheel')),
        el('strong', { class: 'rp-name' }, `${String(p.symbol || '').trim() || 'Unnamed contract'} — cash-secured put and covered call`),
        el('span', { class: 'metaline' }, `Put strike ${fmtMoney(num0(p.putStrike), 'USD')} · the contract you entered · no chain data is connected`),
      ], [el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'rp-rec-wheel', 'aria-label': 'Decision record — Cash Wheel contract',
        onclick: () => reportsOpenRecord('wheel') }, 'Decision record')]));
    }
    if (qttiOwn) {
      const q = State.qtti, run = qttiNow;
      const sym = String(q.symbol || '').trim() || 'Unnamed instrument';
      ul.append(reportsRow('tradingIndex', [
        el('div', { class: 'rp-chips' }, el('span', { class: 'chip' }, 'Trading Index')),
        el('strong', { class: 'rp-name' }, `${sym} — trend evidence`),
        el('span', { class: 'metaline' }, `${q.capturedAt ? `Captured ${String(q.capturedAt).replace('T', ' ')}` : 'No capture time recorded'} · chart evidence you recorded`),
        /* A record needs evidence the index can assess; until then the row
           says what is missing, and the way to finish it. */
        run.assessable ? null : el('span', { class: 'caption rp-said' }, `No record yet — the evidence is not assessable: ${(run.reject || [])[0] || 'it is incomplete.'}`),
      ], run.assessable
        ? [el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'rp-rec-tradingIndex', 'aria-label': `Decision record — Trading Index, ${sym}`,
            onclick: () => reportsOpenRecord('tradingIndex') }, 'Decision record')]
        : [reportLink('/research/trading-index', { class: 'btn btn-ghost btn-sm' }, 'Finish the evidence')]));
    }
    rs.append(ul);
  }
  wrap.append(rs);
  return wrap;
};
