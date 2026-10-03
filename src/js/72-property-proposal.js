/* ==========================================================================
   THE CLIENT PROPOSAL — A SAVED PROPERTY, SET OUT FOR SOMEONE ELSE
   --------------------------------------------------------------------------
   The owner chose Property as the next product (3 Oct 2026). Its paying
   audience is agents, mortgage consultants and small developers, and their
   job is a proposal for a client: the property entered once, then a page
   they can hand over. Everything such a page needs was already here — a
   saved property with its scenarios (71-property-models.js), the model
   every property tool reads (dealModel, 75-property-grade.js) and a
   printable record (97-decision-record.js) — but nothing set it out for a
   reader who is not the one who made it.

   ONE PROPERTY, AS SAVED. A proposal is made from a property saved in My
   properties, never from the calculator's working copy: what a client is
   handed has to be something its preparer can open again and find the
   same. A scenario is the saved scenario — the property with its own
   changes (pmSavedInputs). Changes on the calculator that are not saved
   are said to be left out, with the way to include them.

   NO FIGURE IS COMPUTED HERE. Each one is dealModel's, the engine the
   calculator runs, read for the same inputs, so every number equals what
   the calculator shows for them. Money is printed in whole ringgit, as the
   decision record prints it; the calculator's tiles round the same figure
   to the hundred (RM95.3k). model-test holds the two to one value, figure
   by figure. An input is printed as it was entered, never rounded.

   WHAT IS LEFT OUT, ON PURPOSE.
   - The grade. A letter on a page handed to a client reads as a rating of
     the property, which this product does not give.
   - The equity comparison, the risk flags and the sensitivity: research
     for the preparer, not the client's commitment.
   - A fit-out allowance. Renovation and furnishing is one line in the
     model; an allowance of its own is an open decision of the owner's, and
     no default is invented for it here.

   PREPARED BY is the preparer's own name, agency, contact and logo, kept in
   this browser under one key (proposalDetails) that /privacy names, the
   export on Your data carries and a cleared browser loses with everything
   else. PREPARED FOR is the client's name and a date: they are held in
   memory by this tab and never stored — not in storage, and not in the
   page's title either, which a browser keeps in its history. A client's
   name is somebody else's personal data, and nothing here needs to keep it.

   A PREVIEW. No plan includes a proposal and nothing is sold (the launch
   audit, 29 Sep 2026); the page and each way into it say so, and the
   Pricing page is left as it is.
   ========================================================================== */

/* -------------------------------------------------------- your details */
/* The logo: an image file read to a data URL, kept with the details. A
   logo printed 56px tall needs a few tens of kilobytes, and this browser's
   storage is shared with every property, list and record the reader keeps,
   so a file over 200 KB is refused, and the page says so before one is
   chosen. Only the three raster formats every browser prints are taken. */
const CP_LOGO_MAX = 200 * 1024;
const CP_LOGO_TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
const CP_LOGO_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CP_LOGO_CHARS = 'data:image/jpeg;base64,'.length + Math.ceil(CP_LOGO_MAX / 3) * 4;
const CP_TEXT = { name: 80, agency: 80, contact: 120 };

/* The details as this page reads them, whatever storage holds: a restored
   file writes what it carries, so a field that is not text reads as empty,
   and a logo that is not an image this page writes — a PNG, JPEG or WebP
   data URL within the cap — reads as no logo. Nothing else is read. */
function cpDetails() {
  const v = store.read('proposalDetails', null);
  const r = isRecord(v) ? v : {};
  const text = (k) => (typeof r[k] === 'string' ? r[k].trim().slice(0, CP_TEXT[k]) : '');
  const logo = typeof r.logo === 'string' && r.logo.length <= CP_LOGO_CHARS && CP_LOGO_URL.test(r.logo) ? r.logo : null;
  return { name: text('name'), agency: text('agency'), contact: text('contact'), logo };
}
const cpHasDetails = (x) => !!(x.name || x.agency || x.contact || x.logo);
/* A change to the details, written whole; false when the browser refused it. */
const cpSaveDetails = (patch) => store.write('proposalDetails', { ...cpDetails(), ...patch });

const cpKb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
/* A file chosen for the logo: read, or refused with the reason. */
function cpReadLogo(file) {
  return new Promise((resolve) => {
    if (!file) { resolve({ ok: false, why: 'No file was chosen.' }); return; }
    if (!CP_LOGO_TYPES[file.type]) {
      resolve({ ok: false, why: `That file is not a PNG, JPEG or WebP image${file.type ? ` (it is ${file.type})` : ''}, so it cannot be the logo.` });
      return;
    }
    if (file.size > CP_LOGO_MAX) {
      resolve({ ok: false, why: `That image is ${cpKb(file.size)}. The logo can be at most 200 KB — this browser keeps it with everything else you save here. An image about 600 pixels wide is plenty for print.` });
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result || '');
      resolve(CP_LOGO_URL.test(url) && url.length <= CP_LOGO_CHARS ? { ok: true, url } : { ok: false, why: 'That file could not be read as an image.' });
    };
    r.onerror = () => resolve({ ok: false, why: 'That file could not be read.' });
    r.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------ this visit */
/* Prepared for, and the scenarios chosen, per property: kept for the visit
   and never written to storage (see the head of this file). The scenarios
   start as the calculator's own comparison has them, where it has been
   used this visit, and otherwise as the first three saved. */
const CP_FOR = {}, CP_PICK = {};
const cpFor = (id) => (CP_FOR[id] ||= { client: '', date: localDay() });
function cpPicks(rec) {
  const ids = (rec.scenarios || []).map(s => s.id);
  if (!CP_PICK[rec.id]) {
    const compared = (PM_COMPARE[rec.id] || []).filter(x => ids.includes(x));
    CP_PICK[rec.id] = compared.length ? compared : ids.slice(0, 3);
  }
  CP_PICK[rec.id] = CP_PICK[rec.id].filter(x => ids.includes(x)).slice(0, 3);
  return CP_PICK[rec.id];
}
/* Whether the details card is open across a redraw, once the reader has
   opened or closed it; it starts open while nothing is filled in. */
let cpDetailsOpen = null;

/* -------------------------------------------------------------- the ways in */
const cpPath = (id) => `/property/models/${encodeURIComponent(id)}/proposal`;
/* A real link, so it can be opened in a new tab: the proposal reads the
   saved property itself and needs nothing put on the calculator first. */
function cpLink(rec, { id = null, cls = 'btn btn-ghost btn-sm', label = 'Client proposal' } = {}) {
  const path = cpPath(rec.id);
  return el('a', { class: cls, id, href: href(path), 'aria-label': `${label} — ${rec.name}`,
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
}
const CP_PREVIEW = 'A preview: client proposals are not part of any plan yet, nothing is on sale and nothing is charged.';

/* The calculator's Report section: the proposal of the property on it, or —
   while the deal is not saved — the one thing to do first. */
function propertyProposalNext(d = State.deal) {
  const st = propertyStatus(d);
  const card = el('div', { class: 'card', id: 'cp-next' });
  if (st.kind !== 'model') {
    card.append(cardHead('A proposal for a client',
      'A client proposal is made from a saved property, so that it can be opened again and read the same. Save this property first.'));
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'cp-next-save',
        onclick: () => { if (saveActiveProperty()) { render(); focusAfterRedraw('#cp-next-open', '#cp-next'); } } }, 'Save this property first'),
    ]));
    return card;
  }
  card.append(cardHead('A proposal for a client',
    `“${st.rec.name}” set out for someone else: who prepared it and for whom, what buying it takes, the loan and the monthly commitment, the rent and the cash flow, up to three of its scenarios side by side and a sale at the end of the hold. Every figure is the calculator’s, from the property as saved${st.dirty ? ' — the changes on the calculator are not saved, so they are not in it until they are' : ''}.`));
  card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
    cpLink(st.rec, { id: 'cp-next-open' }),
    el('span', { class: 'chip chip-bronze' }, 'Preview'),
    el('span', { class: 'metaline' }, 'Not part of any plan — nothing is on sale.'),
  ]));
  return card;
}

/* -------------------------------------------------------------- formats */
/* An input as it was entered: its own decimals, up to four, never rounded
   to fewer. A rate keeps at least two, as the calculator prints one. */
function cpDecimals(v) {
  if (!isNum(v)) return 0;
  const s = String(+v.toFixed(4));
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}
const cpN = (v) => (isNum(v) ? fmtNum(v, cpDecimals(v)) : '—');
const cpPct = (v, min = 0) => (isNum(v) ? fmtPct(v, Math.max(min, cpDecimals(v))) : '—');
const cpMoneyIn = (v) => (isNum(v) ? fmtMoney(v, 'MYR', Math.min(2, cpDecimals(v))) : '—');
/* A figure the model computed, in whole ringgit. */
const cpMoney = (v) => (isNum(v) ? fmtMoney(v, 'MYR', 0) : '—');
const cpPlural = (n, one, many = `${one}s`) => `${cpN(n)} ${Number(n) === 1 ? one : many}`;
/* A day as a page carried away from the screen reads it: never "today". */
function cpWhen(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || !Number.isFinite(t.getTime())) return 'on a date not recorded';
  return `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
function cpLongDate(day) {
  const [y, mo, da] = String(day || '').split('-').map(Number);
  const t = new Date(y, (mo || 1) - 1, da || 1);
  return Number.isFinite(t.getTime()) && y ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/* A figure the proposal prints, marked with the model's name for it, so a
   check can hold it to the calculator's (model-test, property-proposal). */
const cpFig = (key, text, extra = {}) => el('span', { class: 'num', 'data-cp': key, ...extra }, text);

/* ------------------------------------------------- where an input came from */
/* Still the calculator's own starting figure: by the review queue's rule
   for the figures it lists (70-property.js) — untouched is the tool's —
   and for any other input, untouched and the sample deal's value. A field
   left empty is said to be empty, not called a sample. */
function cpSeeded(d, k) {
  if (isTouched(d, k)) return false;
  if (PROPERTY_REVIEW.some(f => f.k === k)) return true;
  if (d[k] == null || d[k] === '') return false;
  return pmCanon(d[k]) === pmCanon(PROPERTY_DEFAULT_DEAL[k]);
}
const cpSampleMark = () => el('span', { class: 'cp-mark', title: 'The calculator’s own starting figure: not changed for this property, and taken from no market.' }, 'Sample');
const cpLabel = (k) => String(PROPERTY_I18N[`in.${k}`]?.en || PM_FIELD_WORDS[k] || k).replace(/\s*\([^)]*\)$/, '');

/* The inputs every figure rests on, in the calculator's own groups and
   words, each only where the property's class uses it (propertyInputApplies
   and the class's own rules) and only where a figure here reads it: the
   share of the rent that depends on the renovation moves the renovation's
   own return (renovationReturn), which a proposal does not print, so it is
   not listed as something the proposal rests on. */
function cpInputGroups(d, m) {
  const lets = m.letsToTenant, strata = m.strataCharges, reno = num0(d.renovation) > 0;
  const managed = lets && !d.selfManaged;
  const row = (k, value, label = cpLabel(k)) => ({ k, label, value });
  const rule = { lower_of: 'The lower of the price and the valuation', valuation_only: 'The valuation' }[d.valuationRule || 'lower_of'] || 'The purchase price';
  /* The price and the built-up area are the property's own facts, listed
     above these groups with their marks; they are not listed twice. */
  return [
    ['Purchase', [
      row('bankValuation', num0(d.bankValuation) > 0 ? cpMoneyIn(d.bankValuation) : 'Not entered'),
      num0(d.bankValuation) > 0 ? row('valuationRule', rule, 'What the loan is calculated on') : null,
      row('bookingDepositPaid', cpMoneyIn(num0(d.bookingDepositPaid))),
      row('renovation', cpMoneyIn(num0(d.renovation))),
      reno ? row('renoValueRecoveryPct', cpPct(num0(d.renoValueRecoveryPct))) : null,
      row('reserveMonths', cpPlural(m.reserveMonths, 'month'), 'Months of reserve to hold'),
    ]],
    ['Loan', [
      row('downPct', cpPct(d.downPct)),
      row('ratePct', `${cpPct(d.ratePct, 2)} a year`),
      row('tenureYears', cpPlural(d.tenureYears, 'year')),
      isNum(d.mrtaPremium) && d.mrtaPremium > 0 ? row('mrtaPremium', cpMoneyIn(d.mrtaPremium), 'Mortgage protection premium, as quoted') : null,
    ]],
    lets ? ['Rent', [
      row('rent', `${cpMoneyIn(d.rent)} a month`),
      row('rentGrowthPct', `${cpPct(d.rentGrowthPct)} a year`),
      row('vacancyPct', cpPct(d.vacancyPct)),
    ]] : null,
    ['Running costs', [
      strata ? row('maintenance', `${cpMoneyIn(num0(d.maintenance))} a month`) : null,
      strata ? row('sinkingFund', `${cpMoneyIn(num0(d.sinkingFund))} a month`) : null,
      row('assessment', `${cpMoneyIn(num0(d.assessment))} a year`),
      row('quitRent', `${cpMoneyIn(num0(d.quitRent))} a year`),
      row('insurance', `${cpMoneyIn(num0(d.insurance))} a year`),
      lets ? row('repairReservePct', `${cpPct(num0(d.repairReservePct))} of the rent collected`) : null,
      lets ? row('selfManaged', d.selfManaged ? 'By the owner, with no fee' : 'By a letting agent', 'Management') : null,
      managed ? row('mgmtPct', `${cpPct(num0(d.mgmtPct))} of the rent collected`) : null,
      managed ? row('mgmtMinMonthly', `${cpMoneyIn(num0(d.mgmtMinMonthly))} a month`) : null,
      managed ? row('leasingFeeMonths', `${cpPlural(num0(d.leasingFeeMonths), 'month')} of rent a tenancy`) : null,
      managed ? row('tenancyMonths', cpPlural(m.monthsPerCycle, 'month')) : null,
    ]],
    ['Sale and tax', [
      row('holdYears', cpPlural(d.holdYears, 'year')),
      row('apprecPct', `${cpPct(d.apprecPct)} a year`),
      row('sellMonths', cpPlural(num0(d.sellMonths), 'month')),
      row('agentPct', cpPct(num0(d.agentPct))),
      row('exitLegalPct', cpPct(num0(d.exitLegalPct))),
      row('disposerCategory', rpgtCategory(d.disposerCategory).label, 'Who would be selling'),
      row('marginalTaxPct', isNum(d.marginalTaxPct) && d.marginalTaxPct > 0 ? cpPct(d.marginalTaxPct) : 'Not entered', 'Marginal tax rate on the rent'),
    ]],
  ].filter(Boolean).map(([title, rows]) => [title, rows.filter(Boolean)]);
}
/* Every input the proposal prints that is still the calculator's starting
   figure — the property's two facts and the groups' inputs — counted in one
   place, so the note under the assumptions and the disclosure at the foot
   cannot give two different numbers. */
const CP_FACT_INPUTS = ['sqft', 'price'];
const cpSampleKeys = (d, m) => [...CP_FACT_INPUTS, ...cpInputGroups(d, m).flatMap(([, rows]) => rows.map(r => r.k))].filter(k => cpSeeded(d, k));

/* ------------------------------------------------------------- the document */
function cpSection(id, title) {
  const s = el('section', { class: 'cp-sec', 'aria-labelledby': `cp-h-${id}` });
  s.append(el('h2', { id: `cp-h-${id}` }, title));
  return s;
}
/* A two-column list of label and figure, each figure with a line under it.
   A value may be several nodes (a figure and its Sample mark): el() flattens
   its children one level, so they are spread here rather than nested. */
function cpList(rows) {
  const dl = el('dl', { class: 'cp-kv' });
  rows.filter(Boolean).forEach(([label, value, note, attrs = {}]) => {
    dl.append(el('dt', {}, label));
    dl.append(el('dd', attrs, [...(Array.isArray(value) ? value : [value]), note ? el('span', { class: 'cp-kv-note' }, note) : null]));
  });
  return dl;
}
const cpNote = (text, { warn = false } = {}) => el('p', { class: `cp-note${warn ? ' cp-warn' : ''}` }, text);
function cpTable(caption, head, rows, { cls = '' } = {}) {
  const t = el('table', { class: `dt cp-table ${cls}`.trim() });
  t.append(el('caption', { class: 'sr-only' }, caption));
  if (head) t.append(el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { scope: 'col', class: i ? 'num' : '' }, h)))));
  t.append(el('tbody', {}, rows));
  /* A named stop of its own on a phone, where it scrolls sideways; on paper
     it is the page's width (styles.css). */
  return el('div', { class: 'tablewrap cp-tablewrap', tabindex: '0', role: 'region', 'aria-label': caption }, t);
}
const cpRow = (label, ...cells) => el('tr', {}, [el('th', { scope: 'row' }, label), ...cells.map(c => el('td', { class: 'num' }, c))]);

/* The head: who prepared it, for whom, and of what. */
function cpHead(rec, d, details, forWhom) {
  const head = el('header', { class: 'cp-head' });
  const by = el('div', { class: 'cp-by' });
  if (details.logo) by.append(el('img', { class: 'cp-logo', src: details.logo, alt: details.agency ? `${details.agency} logo` : 'Logo',
    onerror: (e) => { e.target.remove(); } }));
  /* What is filled in prints; what is not is said on the screen only, so
     an empty block never reaches the client's copy. */
  const said = details.name || details.agency || details.contact;
  by.append(el('p', { class: `cp-eyebrow${said ? '' : ' cp-screen-only'}` }, 'Prepared by'));
  if (details.name) by.append(el('p', { class: 'cp-by-name' }, details.name));
  if (details.agency) by.append(el('p', { class: 'cp-by-agency' }, details.agency));
  if (details.contact) by.append(el('p', { class: 'cp-by-contact' }, details.contact));
  if (!said) by.append(el('p', { class: 'cp-blank cp-screen-only' }, 'Your name, agency and contact print here — add them under “Your details for proposals”.'));
  const fr = el('div', { class: 'cp-for' });
  fr.append(el('p', { class: `cp-eyebrow${forWhom.client ? '' : ' cp-screen-only'}` }, 'Prepared for'));
  if (forWhom.client) fr.append(el('p', { class: 'cp-for-name' }, forWhom.client));
  else fr.append(el('p', { class: 'cp-blank cp-screen-only' }, 'The client’s name prints here.'));
  fr.append(el('p', { class: 'cp-for-date' }, cpLongDate(forWhom.date) || cpLongDate(localDay())));
  head.append(by, fr);
  return head;
}

/* The four figures a client asks first, before any table. */
function cpKeyFigures(d, m) {
  const short = (m.missingCostLines || []).length;
  const shortComplete = (m.missingCostLines || []).filter(x => x.groupId === 'acquisition' || x.groupId === 'financing').length;
  const fig = (label, key, value, sub) => el('div', { class: 'cp-fig' }, [
    el('p', { class: 'cp-fig-k' }, label), el('p', { class: 'cp-fig-v' }, cpFig(key, cpMoney(value))), el('p', { class: 'cp-fig-s' }, sub)]);
  return el('div', { class: 'cp-figs' }, [
    fig('Cash to complete', 'cashStillRequiredToComplete', m.cashStillRequiredToComplete,
      shortComplete ? 'So far — a cost line is not priced' : m.cashAlreadyPaid > 0 ? `On completion day, after ${cpMoney(m.cashAlreadyPaid)} paid at offer` : 'Paid out on completion day'),
    fig('Safe cash required', 'safeCashRequired', m.safeCashRequired,
      short ? 'So far — a cost line is not priced' : 'With the renovation and the reserve'),
    fig('Monthly instalment', 'instalment', m.instalment,
      isNum(m.instalment) ? `${cpPct(d.ratePct, 2)} over ${cpPlural(d.tenureYears, 'year')}` : 'Not computed — the loan has no repayment schedule'),
    fig('Monthly position', 'cashflowMonthly', m.cashflowMonthly,
      !isNum(m.cashflowMonthly) ? 'Not computed' : m.letsToTenant ? 'After vacancy, running costs and the loan, before tax' : 'Running costs and the loan; this class earns no rent'),
  ]);
}

function cpPropertySection(rec, d, m) {
  const s = cpSection('property', 'The property and what it assumes');
  const title = TITLE_TYPES.find(t => t.id === d.titleType);
  const cls = PROPERTY_CLASSES[m.propertyClass];
  s.append(cpList([
    ['Location', pmPlace(d)],
    ['Property type', `${d.propertyType || 'Property'} · ${cls.label}${m.propertyClassSrc === 'reader' ? ', as the preparer classed it' : ''}`],
    ['Title class', [title ? title.label : 'Not recorded'], `Recorded from the preparer’s input and not verified.${title?.restricted ? ` ${title.note}` : ''}`],
    d.titleType !== 'strata' ? ['Years remaining on the lease', isNum(d.remainingLease) && d.remainingLease > 0 ? cpN(d.remainingLease) : 'Freehold (0 entered)'] : null,
    ['Built-up area', [`${cpN(d.sqft)} sq ft`, cpSeeded(d, 'sqft') ? cpSampleMark() : null], null, { 'data-cp-in': 'sqft' }],
    num0(d.landSqft) > 0 ? ['Land area', `${cpN(d.landSqft)} sq ft`] : null,
    ['Purchase price', [cpMoneyIn(d.price), cpSeeded(d, 'price') ? cpSampleMark() : null],
      isNum(m.psf) ? [cpFig('psf', fmtMoney(m.psf, 'MYR', 0)), ' per sq ft of built-up area'] : null, { 'data-cp-in': 'price' }],
  ]));
  s.append(el('h3', {}, 'The assumptions behind every figure'));
  const grid = el('div', { class: 'cp-assume' });
  cpInputGroups(d, m).forEach(([title2, rows]) => {
    const box = el('div', { class: 'cp-assume-grp' });
    box.append(el('p', { class: 'cp-eyebrow' }, title2));
    const dl = el('dl', { class: 'cp-kv cp-kv-tight' });
    rows.forEach(r => {
      dl.append(el('dt', {}, r.label));
      dl.append(el('dd', { 'data-cp-in': r.k }, [r.value, cpSeeded(d, r.k) ? cpSampleMark() : null]));
    });
    box.append(dl);
    grid.append(box);
  });
  s.append(grid);
  const samples = cpSampleKeys(d, m).length;
  if (samples) s.append(cpNote(`${samples === 1 ? 'One figure marked' : `${samples} figures marked`} Sample ${samples === 1 ? 'is' : 'are'} still the calculator’s own starting figure: nobody changed ${samples === 1 ? 'it' : 'them'} for this property, and ${samples === 1 ? 'it was' : 'they were'} taken from no market. Every result below inherits that.`, { warn: true }));
  return s;
}

function cpAcquisitionSection(d, m) {
  const s = cpSection('acquisition', 'What buying it takes');
  const rows = [];
  const mark = (st) => st === 'placeholder' ? el('span', { class: 'cp-mark', title: 'A commonly quoted approximation, not a quotation and not read off the current schedule.' }, 'placeholder')
    : st === 'unverified' ? el('span', { class: 'cp-mark cp-mark-quiet', title: 'A working figure nobody has checked against its cited source.' }, 'unverified')
    : st === 'quote' ? el('span', { class: 'cp-mark cp-mark-quiet', title: 'A figure from a quotation the preparer was given.' }, 'quoted')
    : null;
  m.costGroups.forEach(g => {
    rows.push(el('tr', { class: 'cp-grp' }, el('th', { scope: 'rowgroup', colspan: 2 }, g.label)));
    g.items.forEach(it => {
      rows.push(el('tr', {}, [
        el('th', { scope: 'row' }, [it[0], mark(it[2]?.status)]),
        el('td', { class: 'num' }, isNum(it[1]) ? cpFig('line', cpMoney(it[1]), { 'data-cp-line': it[0] })
          : el('span', { class: 'cp-unpriced', 'data-cp': 'line', 'data-cp-line': it[0] }, 'not priced')),
      ]));
    });
    if (g.items.length > 1) {
      const sub = g.items.reduce((t, it) => t + (isNum(it[1]) ? it[1] : 0), 0);
      rows.push(el('tr', { class: 'cp-sub' }, [el('th', { scope: 'row' }, `${g.label}, together`),
        el('td', { class: 'num' }, cpFig('subtotal', cpMoney(sub), { 'data-cp-group': g.id }))]));
    }
  });
  const missing = m.missingCostLines || [];
  rows.push(el('tr', { class: 'cp-total' }, [el('th', { scope: 'row' }, missing.length ? 'Total so far' : 'Total'),
    el('td', { class: 'num' }, cpFig('totalInitialCash', cpMoney(m.totalInitialCash)))]));
  s.append(cpTable('What buying it takes, line by line', ['Cost', 'Amount'], rows, { cls: 'cp-ledger' }));
  if (missing.length) s.append(cpNote(`Not the full amount: ${missing.map(x => x.label.toLowerCase()).join(', ')} could not be priced, so the total is short by whatever ${missing.length === 1 ? 'it comes' : 'they come'} to. ${missing.length === 1 ? 'It is' : 'They are'} left unpriced rather than counted as nothing.`, { warn: true }));
  if (isNum(m.unconfirmedCost) && m.unconfirmedCost > 0 && m.totalInitialCash > 0)
    s.append(el('p', { class: 'cp-note cp-warn' }, [cpFig('unconfirmedCost', cpMoney(m.unconfirmedCost)),
      ` of the total — ${fmtPct(m.unconfirmedCost / m.totalInitialCash * 100, 0)} — comes from fee lines marked placeholder or unverified: working figures nobody has checked against their source. Confirm each with the lender, the solicitor and the local authority before relying on it.`]));
  s.append(cpList([
    m.cashAlreadyPaid > 0 ? ['Cash already paid', cpFig('cashAlreadyPaid', cpMoney(m.cashAlreadyPaid)), 'The booking deposit handed over at offer — part of the deposit, not on top of it.'] : null,
    ['Cash still to complete', cpFig('cashStillRequiredToComplete', cpMoney(m.cashStillRequiredToComplete)), 'Paid out on completion day: the deposit, any valuation gap, the duties, the legal fees and the financing costs.'],
    ['Cash to make it rent-ready', cpFig('improvementCash', cpMoney(m.improvementCash)), 'Spent after completion, before it can earn: renovation, furnishing and deposits.'],
    ['Cash to keep untouched', isNum(m.reserveCash) ? cpFig('reserveCash', cpMoney(m.reserveCash)) : el('span', { class: 'cp-unpriced' }, 'not priced'),
      `${cpPlural(m.reserveMonths, 'month')} of instalment and owner-paid running costs, held in the owner’s account rather than spent.`],
    ['Safe cash required', cpFig('safeCashRequired', cpMoney(m.safeCashRequired)), missing.length ? 'Everything priced so far — short by the lines named above.' : 'Everything together: the cash that decides whether the purchase can be carried.'],
  ]));
  return s;
}

function cpFinancingSection(d, m) {
  const s = cpSection('financing', 'The loan and the monthly commitment');
  const basis = !m.financingBasisConfirmed ? 'the purchase price'
    : m.valuationRule === 'valuation_only' ? 'the valuation' : m.valuationRule === 'lower_of' ? 'the lower of the price and the valuation' : 'the purchase price';
  /* The commitment is the model's two figures for it, never one worked out
     here: the instalment owed to the lender each month, and what holding
     the property takes from the owner's own income in a year (the
     calculator's "Costs you … a year to hold"). The monthly position under
     the rent is the same shortfall a month at a time. */
  const cf = m.cashflowMonthly;
  s.append(cpList([
    m.financingBasisConfirmed ? ['Value the loan is calculated on', cpFig('lenderValueBasis', cpMoney(m.lenderValueBasis)), `${cpMoney(m.bankValuation)} bank or valuer estimate against a ${cpMoneyIn(d.price)} price`] : null,
    ['Loan', cpFig('loan', cpMoney(m.loan)), `A ${cpN(m.marginOfFinancePct)}% margin of finance on ${basis}`],
    ['Share of the price the loan funds', cpFig('financingCoverageOfPrice', fmtPct(m.financingCoverageOfPrice, 1))],
    ['Monthly instalment', cpFig('instalment', cpMoney(m.instalment)), isNum(m.instalment) ? `Owed to the lender each month: ${cpPct(d.ratePct, 2)} a year over ${cpPlural(d.tenureYears, 'year')}` : 'Not computed: the loan has no repayment schedule at the entered tenure'],
    ['Loan repayments a year', cpFig('annualDebtService', cpMoney(m.annualDebtService))],
    !isNum(cf) ? null
      : m.annualOwnerSubsidy > 0 ? ['From the owner’s own income, a year', cpFig('annualOwnerSubsidy', cpMoney(m.annualOwnerSubsidy)),
        m.letsToTenant ? 'What the rent, after vacancy and running costs, leaves unpaid of the loan repayments — before any major repair.'
          : 'The loan repayments and the running costs together: this class earns no rent to meet them.']
      : ['From the owner’s own income', 'Nothing', m.letsToTenant ? 'The rent, after vacancy and running costs, covers the loan repayments.' : 'There is no loan repayment or running cost to meet.'],
  ]));
  if (!m.financingBasisConfirmed) s.append(cpNote('The loan is calculated on the purchase price: no bank or valuer estimate has been entered, so the financing is modelled, not lender-confirmed. A valuation below the price would turn the difference into cash due on completion.', { warn: true }));
  else if (m.valuationGapCash > 0) s.append(el('p', { class: 'cp-note cp-warn' }, ['The valuation is ', cpFig('valuationGapCash', cpMoney(m.valuationGapCash)),
    ` below the price, so the ${cpN(m.marginOfFinancePct)}% margin funds ${fmtPct(m.financingCoverageOfPrice, 1)} of what is paid. The difference is cash due on completion, and is in the costs above as valuation-gap cash.`]));
  if (m.zeroRateModelled) s.append(cpNote('The interest rate entered is 0%. If that was not intended, the instalment and everything after it are understated.', { warn: true }));
  if (!m.tenureValid && m.loan > 0) s.append(cpNote('The loan tenure entered is 0, so there is no repayment schedule: the instalment, the reserve and the sale’s figures are not computed rather than shown as nothing.', { warn: true }));
  s.append(cpNote('Scenarios, not an offer: no lender has seen this property or this borrower, and the margin a lender extends depends on its own valuation and credit policy.'));
  return s;
}

function cpRentSection(d, m) {
  const s = cpSection('rental', m.letsToTenant ? 'Rent and the monthly cash flow' : 'What holding it costs');
  if (!m.letsToTenant) {
    s.append(cpNote(`A ${String(PROPERTY_CLASSES[m.propertyClass].label).toLowerCase()} class has no tenancy, so no rent, vacancy, yield or break-even rent is computed for it — working them out would mean inventing a rent nobody expects to receive.`));
    s.append(cpTable('What holding it costs, a year', null, [
      cpRow('Running costs, a year', cpFig('opex', cpMoney(m.opex))),
      cpRow('Loan repayments, a year', cpFig('annualDebtService', cpMoney(m.annualDebtService))),
    ]));
  } else {
    s.append(cpTable('A year at the rent entered', null, [
      cpRow(`Rent, a year — ${cpMoneyIn(d.rent)} a month`, cpFig('grossAnnualRent', cpMoney(m.grossAnnualRent))),
      cpRow(`Rent collected, after ${cpPct(d.vacancyPct)} vacancy`, cpFig('effectiveRent', cpMoney(m.effectiveRent))),
      cpRow('less running costs', cpFig('opex', cpMoney(m.opex))),
      cpRow('Net operating income', cpFig('noi', cpMoney(m.noi))),
      cpRow('less loan repayments', cpFig('annualDebtService', cpMoney(m.annualDebtService))),
    ]));
  }
  s.append(cpList([
    ['Monthly position', cpFig('cashflowMonthly', cpMoney(m.cashflowMonthly)),
      m.letsToTenant ? 'Net operating income for a month, less the monthly instalment.' : 'The running costs for a month and the instalment, met from the owner’s income.'],
    m.letsToTenant ? ['Break-even rent', cpFig('breakEvenRent', cpMoney(m.breakEvenRent)), 'The monthly rent at which the position is nil, after vacancy and the rent-linked costs.'] : null,
    m.letsToTenant ? ['Gross yield', cpFig('grossYield', fmtPct(m.grossYield, 2)), 'A year’s rent as a share of the price, before any cost.'] : null,
    m.letsToTenant ? ['Net yield', cpFig('netYield', fmtPct(m.netYield, 2)), 'Net operating income as a share of the price, before the loan.'] : null,
  ]));
  /* Which figures carry tax, said as the decision record says it. */
  const taxKnown = m.taxComputed && isNum(m.cumTax);
  if (!m.taxComputed) s.append(cpNote('Before tax: no marginal tax rate was entered, so every figure here is before tax on the rent — what the property produces, not what an owner keeps.'));
  else if (!taxKnown) s.append(cpNote(`No tax on the rent is computed although a marginal rate of ${cpPct(d.marginalTaxPct)} is entered: the loan’s interest — the deduction that decides the tax — could not be worked out from the entered tenure.`, { warn: true }));
  else s.append(el('p', { class: 'cp-note' }, [`The monthly position and the break-even rent are before tax on the rent. The rental cash and the rate of return under “If it is sold” are after tax at ${cpPct(d.marginalTaxPct)}, which comes to `,
    cpFig('cumTax', cpMoney(m.cumTax)), ' across the hold: loan interest is deducted and principal is not. Nothing here is tax advice.']));
  return s;
}

/* The property beside the scenarios chosen, on the same model. */
function cpScenariosSection(rec, picks) {
  const base = pmInputsOf(rec);
  const cols = [{ id: 'base', name: 'Base case', what: 'The figures above', d: base },
    ...picks.map(id => rec.scenarios.find(s => s.id === id)).filter(Boolean)
      .map(sc => ({ id: sc.id, name: sc.name, what: pmOverrideLine(sc.overrides) || 'Nothing changed', d: pmMerge(base, sc.overrides) }))];
  const s = cpSection('scenarios', `The scenarios side by side — ${cols.length - 1} beside the base case`);
  const models = cols.map(c => dealModel(c.d));
  const line = (label, key, get, fmt = cpMoney) => el('tr', {}, [el('th', { scope: 'row' }, label),
    ...models.map((m, i) => el('td', { class: 'num' }, cpFig(key, fmt(get(m)), { 'data-cp-col': cols[i].id })))]);
  const t = el('table', { class: 'dt cp-table cp-sc-table' });
  t.append(el('caption', { class: 'sr-only' }, `The base case and ${cols.length - 1} scenario${cols.length === 2 ? '' : 's'}, side by side`));
  t.append(el('thead', {}, el('tr', {}, [el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Figure')),
    ...cols.map(c => el('th', { scope: 'col', class: 'num' }, c.name))])));
  t.append(el('tbody', {}, [
    el('tr', { class: 'cp-sc-what' }, [el('th', { scope: 'row' }, 'What it changes'), ...cols.map(c => el('td', {}, c.what))]),
    line('Monthly instalment', 'instalment', m => m.instalment),
    line('Monthly position', 'cashflowMonthly', m => m.cashflowMonthly),
    line('Cash to complete', 'cashStillRequiredToComplete', m => m.cashStillRequiredToComplete),
    line('Safe cash required', 'safeCashRequired', m => m.safeCashRequired),
    line('Net yield', 'netYield', m => m.netYield, v => (isNum(v) ? fmtPct(v, 2) : '—')),
    line('Break-even rent', 'breakEvenRent', m => m.breakEvenRent),
  ]));
  s.append(el('div', { class: 'tablewrap cp-tablewrap', tabindex: '0', role: 'region', 'aria-label': 'The scenarios side by side' }, t));
  if (models.some(m => (m.missingCostLines || []).length)) s.append(cpNote('Where a cost line could not be priced, the cash figures of that column are what is priced so far.', { warn: true }));
  s.append(cpNote('Each column is the same model run on that column’s inputs: the property as saved, with only what the scenario changes. Scenarios, not forecasts — and none is ranked above another.'));
  return s;
}

/* The sale at the end of the hold, as the model prices it (dealModel's own
   exit: exitAt for the holding period, and the rate of return of the whole
   hold). Nothing is assumed here that the model does not already assume. */
function cpExitSection(d, m) {
  const s = cpSection('exit', `If it is sold after ${cpPlural(d.holdYears, 'year')}`);
  /* A deduction carries its minus — except one that prints as nothing: a
     gains tax of nil read "−RM0", a sign on a zero. */
  const less = (key, v) => cpFig(key, !isNum(v) ? '—' : cpMoney(v) === 'RM0' ? 'RM0' : `−${cpMoney(v)}`, { 'data-cp-sign': '-' });
  s.append(cpTable(`If it is sold after ${d.holdYears} years`, null, [
    cpRow('Sale value', cpFig('exitValue', cpMoney(m.exitValue))),
    cpRow('Loan outstanding', less('outstanding', m.outstanding)),
    cpRow('Agent commission', less('agentFee', m.agentFee)),
    cpRow('Legal fees on the sale', less('exitLegal', m.exitLegal)),
    cpRow(`Carried while it sells — ${cpPlural(num0(d.sellMonths), 'month')}`, less('carryWhileSelling', m.carryWhileSelling)),
    cpRow(`Real property gains tax (${m.rpgtPct}%)`, less('rpgt', m.rpgt)),
    cpRow('Net proceeds', cpFig('netExitProceeds', cpMoney(m.netExitProceeds))),
    cpRow(m.taxComputed ? 'Rental cash over the hold, after tax on the rent' : 'Rental cash over the hold, before tax', cpFig('cumCash', cpMoney(m.cumCash))),
    cpRow('Total profit on the cash put in', cpFig('totalProfit', cpMoney(m.totalProfit))),
    cpRow('Rate of return over the hold', isNum(m.irrPct) ? cpFig('irrPct', fmtPct(m.irrPct, 2)) : el('span', { class: 'cp-unpriced', 'data-cp': 'irrPct' }, 'No rate')),
  ], { cls: 'cp-exit' }));
  if (!isNum(m.irrPct) && m.irrWhy) s.append(cpNote(`No rate of return: ${m.irrWhy}`));
  const reno = num0(d.renovation) > 0 && num0(d.renoValueRecoveryPct) > 0
    ? `, with ${cpPct(num0(d.renoValueRecoveryPct))} of the renovation recovered in the price` : '';
  s.append(cpNote(`Sold at the price grown by ${cpPct(d.apprecPct)} a year${reno}, by ${rpgtCategory(d.disposerCategory).who}. The rate of return discounts each year’s cash to when it arrives, on ${cpMoney(m.equityOut)} put in at the start — the reserve included, which comes back at the sale. Capital growth is the preparer’s assumption, not a forecast.`));
  s.append(cpNote('The gains-tax rates are cited to Schedule 5 of the Real Property Gains Tax Act 1976 and have not been verified against the current schedule or any exemption order in force.', { warn: true }));
  return s;
}

function cpDisclosures(rec, d, m) {
  const s = cpSection('disclosures', 'What this proposal is, and is not');
  const placeholders = (m.placeholderCostLines || []).length;
  const unverified = m.costGroups.flatMap(g => g.items).filter(it => it[2]?.status === 'unverified' && isNum(it[1])).length;
  const samples = cpSampleKeys(d, m).length;
  const ul = el('ul', { class: 'cp-points' });
  [
    'Research and illustration, not financial advice and not a recommendation to buy, sell, let or finance this property. It does not take account of anyone’s objectives, financial situation or needs; before acting, take advice from someone licensed to give it.',
    'Every figure is computed from the inputs listed under “The property and what it assumes”, by the model the Quantum Tradeworks property calculator runs. None is a forecast, a quotation or an offer.',
    'Not a valuation. In Malaysia an official valuation must be carried out by a registered valuer, and nothing here is a price opinion.',
    placeholders || unverified
      ? `Fee lines are marked as they stand: ${placeholders ? `${placeholders} ${placeholders === 1 ? 'is a placeholder' : 'are placeholders'} — a commonly quoted approximation` : ''}${placeholders && unverified ? ', and ' : ''}${unverified ? `${unverified} ${unverified === 1 ? 'is' : 'are'} unverified against ${unverified === 1 ? 'its' : 'their'} source` : ''}. Duties and fees change without notice; confirm every one with the lender, the solicitor and the local authority.`
      : 'Duties and fees follow the fee registry this build carries, which changes without notice; confirm every one with the lender, the solicitor and the local authority.',
    samples
      ? `Sample marks ${samples === 1 ? 'a figure' : `${samples} figures`} that ${samples === 1 ? 'is' : 'are'} still the calculator’s illustrative starting value, chosen for no property and taken from no market.`
      : 'Every driving figure here was entered or changed by the preparer; none is the calculator’s illustrative starting value.',
    'Title, tenure and eligibility are recorded from the preparer’s input and have not been verified. Confirm them with a property lawyer and the land office before relying on them.',
  ].forEach(x => ul.append(el('li', {}, x)));
  s.append(ul);
  s.append(el('p', { class: 'cp-stamp' }, `Prepared ${caseRaisedAt(new Date())} with Quantum Tradeworks (${MODEL_VERSION}), from the saved property “${rec.name}”, as saved ${cpWhen(pmUpdated(rec))}.`));
  return s;
}

function cpDocument(rec, details, forWhom, picks) {
  const d = pmInputsOf(rec), m = dealModel(d);
  const doc = el('article', { class: 'cp-doc', id: 'cp-doc', 'aria-label': 'Client proposal' });
  doc.append(cpHead(rec, d, details, forWhom));
  const where = pmPlace(d);
  doc.append(el('div', { class: 'cp-title' }, [
    el('p', { class: 'cp-eyebrow' }, 'Property proposal'),
    el('h1', {}, `${d.propertyType || 'Property'}${where !== '—' ? ` — ${where}` : ''}`),
    el('p', { class: 'cp-sub' }, `Research and illustration, not financial advice. From the saved property “${rec.name}”.`),
  ]));
  if (workIsSample(rec)) doc.append(el('p', { class: 'cp-note cp-warn cp-sample' },
    'Illustrative: every figure in this proposal comes from the calculator’s sample inputs, which nobody chose for any real property.'));
  doc.append(cpKeyFigures(d, m));
  doc.append(cpPropertySection(rec, d, m));
  doc.append(cpAcquisitionSection(d, m));
  doc.append(cpFinancingSection(d, m));
  doc.append(cpRentSection(d, m));
  if (picks.length) doc.append(cpScenariosSection(rec, picks));
  doc.append(cpExitSection(d, m));
  doc.append(cpDisclosures(rec, d, m));
  return doc;
}

/* ------------------------------------------------------------ the controls */
function cpRail(rec, details, forWhom, picks) {
  const rail = el('aside', { class: 'card cp-rail rail-sticky', 'aria-label': 'Set up the proposal' });
  rail.append(el('div', { class: 'cp-rail-hd' }, [
    el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
      el('p', { class: 'h-card', style: 'margin:0' }, 'Client proposal'),
      el('span', { class: 'chip chip-bronze' }, 'Preview'),
    ]),
    el('p', { class: 'caption' }, CP_PREVIEW),
    el('button', { type: 'button', class: 'btn btn-primary cp-print', id: 'cp-print', onclick: () => window.print() }, 'Print or save as PDF'),
    el('p', { class: 'metaline' }, 'Printing leaves this column out. The proposal prints on A4, in light colours whatever theme the screen uses.'),
  ]));
  const st = propertyStatus(State.deal);
  if (st.kind === 'model' && st.rec.id === rec.id && st.dirty) rail.append(el('p', { class: 'cp-rail-warn', role: 'note' }, [
    'The calculator holds changes to this property that are not saved. This proposal is the property as saved; ',
    el('a', { href: href('/property/calculator'), onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate('/property/calculator'); } }, 'save them on the calculator'),
    ' to include them.',
  ]));

  const body = el('div', { class: 'cp-rail-body' });
  /* Prepared for — this visit only. */
  const pf = el('fieldset', { class: 'cp-fs' });
  pf.append(el('legend', {}, 'Prepared for'));
  const field = (id, label, input, note) => el('div', { class: 'field' }, [el('label', { for: id }, label), input, note ? el('p', { class: 'metaline' }, note) : null]);
  pf.append(field('cp-client', 'Client’s name', el('input', { class: 'input', id: 'cp-client', type: 'text', maxlength: '80', autocomplete: 'off', value: forWhom.client,
    onchange: e => { forWhom.client = e.target.value.trim().slice(0, 80); renderAfterTyping(); } })));
  pf.append(field('cp-date', 'Date', el('input', { class: 'input', id: 'cp-date', type: 'date', value: forWhom.date,
    onchange: e => { forWhom.date = /^\d{4}-\d\d-\d\d$/.test(e.target.value) ? e.target.value : localDay(); renderAfterTyping(); } })));
  pf.append(el('p', { class: 'metaline' }, 'Not stored: the client’s name is held by this tab until it is reloaded or closed, and prints on the proposal. Nothing about the client is written to this browser’s storage.'));
  body.append(pf);

  /* The scenarios, three at most. */
  const sf = el('fieldset', { class: 'cp-fs' });
  sf.append(el('legend', {}, 'Scenarios beside it — up to three'));
  const scs = rec.scenarios || [];
  if (!scs.length) {
    sf.append(el('p', { class: 'metaline' }, 'No scenario is saved for this property. On the calculator, change a figure — the rent, the rate, the deposit — and save it as a scenario to set it beside the property here.'));
  } else scs.forEach(sc => {
    const on = picks.includes(sc.id);
    sf.append(el('label', { class: 'checkline cp-pick', for: `cp-pick-${sc.id}` }, [
      el('input', { type: 'checkbox', id: `cp-pick-${sc.id}`, checked: on ? '' : null, onchange: e => {
        const now = CP_PICK[rec.id] || [];
        if (e.target.checked && now.length >= 3) { e.target.checked = false; toast('Three scenarios at most beside the property — clear one first'); return; }
        CP_PICK[rec.id] = e.target.checked ? [...now, sc.id] : now.filter(x => x !== sc.id);
        renderKeepFocus();
      } }),
      el('span', {}, [el('strong', {}, sc.name), el('span', { class: 'metaline cp-pick-what' }, pmOverrideLine(sc.overrides) || 'Nothing changed')]),
    ]));
  });
  body.append(sf);

  /* Your details for proposals — kept in this browser. */
  const open = cpDetailsOpen ?? !cpHasDetails(details);
  const yd = el('details', { class: 'cp-fs cp-details', id: 'cp-details', open: open ? '' : null });
  yd.addEventListener('toggle', () => { cpDetailsOpen = yd.open; });
  yd.append(el('summary', {}, cpHasDetails(details)
    ? `Your details: ${[details.name, details.agency].filter(Boolean).join(', ') || details.contact || 'a logo'}`
    : 'Your details for proposals'));
  const saveField = (k) => (e) => {
    const refused = store.failed;
    cpSaveDetails({ [k]: e.target.value.trim().slice(0, CP_TEXT[k]) });
    if (store.failed !== refused) toast(STORE_REFUSED);
    renderAfterTyping();
  };
  yd.append(field('cp-name', 'Your name', el('input', { class: 'input', id: 'cp-name', type: 'text', maxlength: String(CP_TEXT.name), autocomplete: 'name', value: details.name, onchange: saveField('name') })));
  yd.append(field('cp-agency', 'Agency or firm', el('input', { class: 'input', id: 'cp-agency', type: 'text', maxlength: String(CP_TEXT.agency), autocomplete: 'organization', value: details.agency, onchange: saveField('agency') })));
  yd.append(field('cp-contact', 'Contact', el('input', { class: 'input', id: 'cp-contact', type: 'text', maxlength: String(CP_TEXT.contact), autocomplete: 'off', placeholder: 'Phone, email or both', value: details.contact, onchange: saveField('contact') })));
  /* Behind a button, as Your data's restore is: the native file control
     cannot be styled, and reads as a browser artefact. */
  const fileIn = el('input', { type: 'file', id: 'cp-logo-file', accept: Object.keys(CP_LOGO_TYPES).join(','), style: 'display:none',
    onchange: async (e) => {
      const res = await cpReadLogo(e.target.files && e.target.files[0]);
      e.target.value = '';
      if (!res.ok) { toast(res.why); return; }
      const refused = store.failed;
      cpSaveDetails({ logo: res.url });
      toast(store.failed !== refused ? STORE_REFUSED : 'Logo added — it prints at the top of the proposal');
      renderKeepFocus(); focusAfterRedraw('#cp-logo-add');
    } });
  const logoRow = el('div', { class: 'cp-logo-row' });
  if (details.logo) logoRow.append(el('img', { class: 'cp-logo-thumb', src: details.logo, alt: 'Your logo, as it prints' }));
  logoRow.append(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'cp-logo-add', onclick: () => fileIn.click() }, details.logo ? 'Replace the logo' : 'Add a logo'));
  if (details.logo) logoRow.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'cp-logo-remove', onclick: () => {
    const refused = store.failed;
    cpSaveDetails({ logo: null });
    toast(store.failed !== refused ? STORE_REFUSED : 'Logo removed');
    render(); focusAfterRedraw('#cp-logo-add');
  } }, 'Remove the logo'));
  yd.append(el('div', { class: 'field' }, [el('span', { class: 'cp-fs-label' }, 'Logo'), logoRow, fileIn]));
  yd.append(el('p', { class: 'metaline' }, 'A PNG, JPEG or WebP image of at most 200 KB. Your name, agency, contact and logo are kept in this browser only — no server holds them. The export on Your data carries them, and clearing this browser’s storage removes them.'));
  if (cpHasDetails(details)) yd.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'cp-details-remove', onclick: () => {
    if (!confirm('Remove your name, agency, contact and logo from this browser? There is no copy anywhere else.')) return;
    const refused = store.failed;
    store.write('proposalDetails', null);
    cpDetailsOpen = true;
    toast(store.failed !== refused ? STORE_UNDELETED : 'Your details are removed from this browser');
    render(); focusAfterRedraw('#cp-name');
  } }, 'Remove my details'));
  body.append(yd);
  rail.append(body);

  const go = (path, label, id) => el('a', { class: 'btn btn-quiet btn-sm', id, href: href(path),
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
  rail.append(el('div', { class: 'cp-rail-links' }, [
    el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'cp-open-calc', onclick: () => openPropertyModel(rec.id) }, 'Open it on the calculator'),
    go('/property/models', 'My properties', 'cp-models'),
  ]));
  return rail;
}

/* A proposal address whose property this browser does not hold. */
function cpMissing(wrap, id) {
  const any = pmAll().length;
  wrap.append(pageHead({ title: 'Client proposal', lede: 'A saved property, set out for a client to read.' }));
  const card = el('section', { class: 'card cp-missing', 'aria-labelledby': 'cp-missing-hd' });
  card.append(el('h2', { class: 'h-card', id: 'cp-missing-hd' }, id ? 'That property is not saved in this browser' : 'No property named'));
  card.append(el('p', { class: 'body' }, any
    ? 'A client proposal is made from a property saved in My properties. This one may have been deleted, or saved in another browser — nothing saved here leaves the browser it was saved in.'
    : 'A client proposal is made from a property saved in My properties, and none is saved in this browser yet. Model a property on the calculator and save it; its proposal is then a click away.'));
  card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [any
    ? el('a', { class: 'btn btn-primary', href: href('/property/models'), onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate('/property/models'); } }, 'Open My properties')
    : el('a', { class: 'btn btn-primary', href: href('/property/calculator'), onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate('/property/calculator'); } }, productById('property')?.action || 'Analyse a property')]));
  wrap.append(card);
  return wrap;
}

VIEWS.propertyProposal = () => {
  const route = matchRoute(location.pathname);
  let id = '';
  try { id = decodeURIComponent(route?.params?.property || ''); } catch { id = ''; }
  const rec = pmFind(id);
  const wrap = el('div', { class: 'cp-page' });
  if (!rec) return cpMissing(wrap, id);
  const details = cpDetails(), forWhom = cpFor(rec.id), picks = cpPicks(rec);
  wrap.append(el('div', { class: 'cp-layout' }, [cpRail(rec, details, forWhom, picks), cpDocument(rec, details, forWhom, picks)]));
  wrap.append(el('div', { class: 'cp-foot cp-screen-only' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', id: 'cp-print-foot', onclick: () => window.print() }, 'Print or save as PDF'),
    el('span', { class: 'metaline' }, CP_PREVIEW),
  ]));
  /* The title is the file name a browser offers for the PDF, so it names the
     property. Never the client: a browser writes every title it is shown
     into its history, and a client's name is the one thing this page
     promises not to keep. */
  document.title = `Client proposal — ${rec.name} · Quantum Tradeworks`;
  return wrap;
};
