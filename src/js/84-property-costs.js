/* ==========================================================================
   PROPERTY COSTS WITH PROVENANCE — the owner's Track A of 10 Oct 2026
   (the four-business synergy strategy, Quantum Tradeworks items only)
   --------------------------------------------------------------------------
   QT-03, COST LINES. Every renovation and improvement cost — the
   calculator's renovation and furnishing, and Refurbish's and Upgrade's
   works in the Lab's Refurbish or not — can be entered as lines, each with
   its source (the reader's own words), date, what it includes and
   excludes, and its kind: Quoted, Estimate or Placeholder. The registry and
   the writer are in 70-property.js (COST_LINE_KINDS, setCostLines), beside
   RF_BASES; this module draws them. A total carries the weakest line's
   badge and says how much rests on estimates.

   Rules that hold throughout (the owner's, binding): every figure is the
   reader's own or sourced; nothing is ranked; no recommendation or verdict
   wording; no supplier attached, named or preferred — a business's name
   appears only as the source text the reader typed.
   ========================================================================== */

/* Ringgit as a line holds it: whole, or to the sen where it has sen. */
const clMoney = (v) => (isNum(v) ? fmtMoney(v, 'MYR', Math.round(v * 100) % 100 ? 2 : 0) : '—');
/* Which editors the reader has open, and the last thing each said, so a
   redraw (every write redraws its page) keeps both. */
const CL_OPEN = new Set();
const CL_SAID = {};
/* The kind of a line, as its badge and its word: "Quoted", "Yours ·
   estimate", "Placeholder". */
const clKind = (x) => (x.sample ? kindWithFine('illustrative', 'Illustrative default', { link: false, cls: 'cl-kind' })
  : kindWithFine(COST_LINE_KINDS[x.kind].badge, COST_LINE_KINDS[x.kind].label, { link: false, cls: 'cl-kind' }));
/* What a line records besides its amount, in one line of words. */
function clMeta(x) {
  const bits = [];
  bits.push(x.source ? `Source: ${x.source}` : x.implicit ? (x.sample ? 'The calculator’s sample figure' : 'Entered as one figure, with no source recorded') : 'No source recorded');
  if (x.date) bits.push(`dated ${feeDay(x.date)}`);
  if (x.includes) bits.push(`includes ${x.includes}`);
  if (x.excludes) bits.push(`excludes ${x.excludes}`);
  if (x.from?.file) bits.push(`imported from ${x.from.file}${x.from.row ? `, row ${x.from.row}` : ''}`);
  return bits.join(' · ');
}
/* The total, as the editor heads it and every place that shows the cost
   reads it: the weakest line's badge, the sum, and what rests on
   estimates. */
function clSummaryLine(s, { id = null } = {}) {
  return el('p', { class: 'cl-sum', id, 'data-cl-kind': s.kind, 'data-cl-total': String(s.total), 'data-cl-estimates': String(s.onEstimates) }, [
    kindBadge(s.kind, { link: false, fine: s.n ? `the weakest of ${s.n} line${s.n === 1 ? '' : 's'}` : 'not entered' }), ' ',
    el('span', { class: 'cl-sum-t' }, s.n ? `${clMoney(s.total)} across ${s.n} line${s.n === 1 ? '' : 's'}. ` : 'No lines yet. '),
    el('span', { class: 'cl-sum-e' }, s.n ? costEstimateWords(s, clMoney) : 'Enter the first line below.')]);
}
/* The lines as written once more lines are added: the single figure entered
   before lines read as its own line (kept as it was — a quote with no
   source stays a quote, its missing source said where it is listed), the
   sample's untouched figure left out, never carried as the reader's. */
const clStart = (lines) => lines.filter(x => !x.sample).map(x => (x.implicit ? { ...x, id: undefined, implicit: undefined, legacy: x.kind === 'quoted' ? true : undefined } : x));

/* THE EDITOR. `d`: the deal its lines are read from; `target`: one of
   COST_TARGETS; `prefix`: the ids' prefix; `write(lines)`: the page's own
   writer (the calculator writes its deal; the Lab answers every column of
   the property, a what-if until Save). A <details> (L3): open while the
   reader has lines, or has opened it. */
function costLinesBlock({ d, target, prefix, write }) {
  const t = COST_TARGETS[target];
  const id = `${prefix}-cl-${target}`;
  const lines = costLinesOf(d, target);
  const explicit = costLinesExplicit(d, target);
  const s = costLinesSummary(lines);
  const box = el('details', { class: 'pc-more cl-box', id, 'data-cl-target': target, open: explicit || CL_OPEN.has(id) ? '' : null,
    ontoggle: (e) => { if (e.target.open) CL_OPEN.add(id); else CL_OPEN.delete(id); } });
  box.append(el('summary', { class: 'pc-more-sum cl-box-sum' }, explicit ? `${s.n} cost line${s.n === 1 ? '' : 's'}, with sources` : 'Itemise as lines, with sources'));
  const body = el('div', { class: 'cl-body' });
  body.append(clSummaryLine(s, { id: `${id}-sum` }));
  if (lines.length) {
    body.append(el('ul', { class: 'cl-list', 'aria-label': `${t.label}: the cost lines` }, lines.map((x, i) => el('li', { class: 'cl-line', 'data-line': x.id, 'data-kind': x.kind }, [
      el('div', { class: 'cl-line-hd' }, [el('span', { class: 'cl-item' }, x.item), el('span', { class: 'cl-amt num' }, clMoney(x.amount)), clKind(x)]),
      el('p', { class: 'cl-meta' }, clMeta(x)),
      x.sample ? null : el('button', { type: 'button', class: 'btn btn-quiet btn-sm cl-del', id: `${id}-del-${i}`, onclick: () => {
        CL_SAID[id] = `Removed “${x.item}”, ${clMoney(x.amount)}.`;
        CL_OPEN.add(id);
        write(clStart(lines).filter((y, j) => j !== i));
      } }, ['Remove', el('span', { class: 'sr-only' }, ` the line ${x.item}`)]),
    ]))));
  }
  /* A line added: each field to its rule (costLineFault), refused with the
     reason, never guessed. */
  const f = (k, label, attrs = {}) => {
    const fid = `${id}-${k}`;
    return el('div', { class: `au-field cl-f cl-f-${k}` }, [el('label', { for: fid, class: 'au-label' }, label),
      el('input', { class: 'input au-in', id: fid, autocomplete: 'off', ...attrs })]);
  };
  const kindSel = el('select', { class: 'select au-in cl-kind-sel', id: `${id}-kind` },
    COST_LINE_KIND_IDS.map(k => el('option', { value: k, selected: k === 'quoted' ? '' : null }, COST_LINE_KINDS[k].option)));
  const add = el('fieldset', { class: 'au-group cl-add', id: `${id}-addset` });
  add.append(el('legend', { class: 'au-legend' }, 'Add a line'), el('div', { class: 'au-grid cl-grid' }, [
    f('item', 'Item', { type: 'text', maxlength: String(COST_TEXT_MAX.item), placeholder: 'e.g. Kitchen cabinets' }),
    f('amount', 'Amount (RM)', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 12000' }),
    el('div', { class: 'au-field cl-f cl-f-kind' }, [el('label', { for: `${id}-kind`, class: 'au-label' }, 'Kind'), kindSel]),
    f('source', 'Source — where it came from, in your words', { type: 'text', maxlength: String(COST_TEXT_MAX.source), placeholder: 'e.g. Written quote ref. 123' }),
    f('date', 'Date', { type: 'date' }),
    f('includes', 'What it includes', { type: 'text', maxlength: String(COST_TEXT_MAX.includes) }),
    f('excludes', 'What it excludes', { type: 'text', maxlength: String(COST_TEXT_MAX.excludes) }),
  ]));
  const msg = el('p', { class: 'cl-msg metaline', id: `${id}-msg`, role: 'status', 'aria-live': 'polite' }, CL_SAID[id] || '');
  add.append(el('div', { class: 'cl-acts' }, [el('button', { type: 'button', class: 'btn btn-ghost btn-sm cl-add-btn', id: `${id}-add`, onclick: () => {
    const v = (k) => box.querySelector(`#${id}-${k}`)?.value ?? '';
    const raw = String(v('amount')).trim();
    const x = { item: v('item'), amount: /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : raw === '' ? null : NaN, kind: kindSel.value,
      source: v('source'), date: v('date'), includes: v('includes'), excludes: v('excludes') };
    const fault = x.amount === null ? 'it has no amount' : Number.isNaN(x.amount) ? `its amount “${raw.slice(0, 20)}” is not ringgit and sen, written 12000 or 12000.50` : costLineFault(x);
    if (fault) { CL_SAID[id] = `Not added — ${fault}.`; msg.textContent = CL_SAID[id]; return; }
    CL_SAID[id] = `Added “${costText(x.item)}”, ${clMoney(x.amount)}, ${COST_LINE_KINDS[x.kind].label}.`;
    CL_OPEN.add(id);
    write([...clStart(lines), x]);
  } }, 'Add the line')]), msg);
  body.append(add);
  body.append(el('p', { class: 'metaline cl-note' }, s.sample
    ? 'A line added replaces the calculator’s sample figure. The total is the cost; each line keeps where it came from.'
    : 'The lines’ total is the cost. Each keeps its source, its date and what it covers; the total carries the weakest line’s badge.'));
  box.append(body);
  return box;
}

/* ==========================================================================
   QT-06, ACTUAL AGAINST MODELLED (the owner's approval of 10 Oct 2026). On
   a saved property the owner records what it actually did — rent received,
   months vacant, costs paid — by month or by year of the hold, and sees it
   beside what was modelled for the same period: the property as saved
   (dealModel's own year of the hold — its rent after the vacancy
   allowance, its running costs — prorated to the months), with the
   difference. Before the loan, as the net yield is. A realised yield is
   stated for a year of the hold only when all twelve of its months are
   recorded, each with its rent and costs; a period not whole says so, and
   no yield is stated for it. Kept only in this browser, under one key
   (propertyActuals: { <property id>: { start, entries } }) that /privacy
   names, Your data lists, exports and restores, and Clear removes with the
   rest. Nothing is ranked, recommended or forecast.
   ========================================================================== */
const ACTUAL_FIGURES = ['rent', 'vacancy', 'costs'];
const acMonthIndex = (s) => ndMonthIndex(s);
const acThisMonth = () => localDay().slice(0, 7);
/* Why a stored entry cannot be read, or null. */
function actualEntryFault(e) {
  if (!isRecord(e)) return 'an entry is not a record';
  if (e.kind === 'month') { if (!ansMonth(e.period)) return `a month entry's period “${String(e.period).slice(0, 12)}” is not YYYY-MM`; }
  else if (e.kind === 'year') { if (!Number.isInteger(e.period) || e.period < 1 || e.period > HOLD_YEARS_MAX) return 'a year entry is not a year of the hold'; }
  else return 'an entry is neither a month nor a year';
  if (!Number.isInteger(e.months) || e.months < 1 || e.months > 12 || (e.kind === 'month' && e.months !== 1)) return 'an entry covers no whole number of months';
  for (const k of ACTUAL_FIGURES) if (e[k] != null && !(isNum(e[k]) && e[k] >= 0)) return `an entry's ${k} is not a figure of nought or more`;
  if (!ACTUAL_FIGURES.some(k => isNum(e[k]))) return 'an entry records no figure';
  return null;
}
/* The restore's rule for the key (STORE_SHAPES, 00-core.js). */
function propertyActualsFault(v) {
  if (!isRecord(v)) return 'is not a record';
  for (const [id, r] of Object.entries(v)) {
    if (!isRecord(r) || !Array.isArray(r.entries)) return `holds, for ${id.slice(0, 40)}, something other than a start month and a list of entries`;
    if (r.start != null && !ansMonth(r.start)) return `holds, for ${id.slice(0, 40)}, a first month “${String(r.start).slice(0, 12)}” that is not YYYY-MM`;
    const bad = r.entries.map(actualEntryFault).find(Boolean);
    if (bad) return `holds, for ${id.slice(0, 40)}, ${bad}`;
  }
  return null;
}
const actualsAll = () => { const v = store.read('propertyActuals', {}); return isRecord(v) ? v : {}; };
function actualsOf(id) {
  const r = actualsAll()[id];
  return { start: isRecord(r) && ansMonth(r.start) ? r.start : null,
    entries: isRecord(r) && Array.isArray(r.entries) ? r.entries.filter(e => !actualEntryFault(e)) : [] };
}
/* A property's record written whole, or removed when it holds nothing. */
function actualsWrite(id, rec) {
  const all = { ...actualsAll() };
  if (rec && (rec.start || rec.entries.length)) all[id] = { start: rec.start || null, entries: rec.entries }; else delete all[id];
  return Object.keys(all).length ? store.write('propertyActuals', all) : (() => { try { localStorage.removeItem('vl.propertyActuals'); return true; } catch { return false; } })();
}
/* The year of the hold a period falls in, or why it has none. */
function actualYearOf(e, start) {
  if (e.kind === 'year') return { y: e.period };
  if (!start) return { why: 'enter the first month of the hold first: a month is set beside the model’s year it falls in' };
  const i = acMonthIndex(e.period) - acMonthIndex(start);
  if (i < 0) return { why: `${ndMonthWords(e.period)} is before ${ndMonthWords(start)}, the first month of the hold` };
  return { y: Math.floor(i / 12) + 1, month: i % 12 + 1 };
}
/* Whether an entry can be recorded beside the others: refused with the
   reason, never guessed. Returns the reason, or null. */
function actualRecordFault(rec, e, { holdYears, lets, now = acThisMonth() }) {
  const shape = actualEntryFault(e);
  if (shape) return shape.replace(/^an entry('s)?/, 'it').replace(/^a month entry's period/, 'the month').replace(/^a year entry/, 'the year');
  if (!lets && (isNum(e.rent) || isNum(e.vacancy))) return 'a bare parcel earns no rent: record its costs only';
  if (isNum(e.vacancy) && e.vacancy > e.months) return `${fmtNum(e.vacancy, 1)} months vacant is more than the ${e.months} month${e.months === 1 ? '' : 's'} it covers`;
  if (e.kind === 'month' && acMonthIndex(e.period) > acMonthIndex(now)) return `${ndMonthWords(e.period)} has not begun: nothing has been received for it yet`;
  const at = actualYearOf(e, rec.start);
  if (at.why) return at.why;
  if (at.y > holdYears) return `it falls in year ${at.y}, after the ${holdYears}-year hold modelled: nothing modelled to set it beside`;
  const others = rec.entries.filter(x => !(x.kind === e.kind && x.period === e.period));
  const clash = others.find(x => x.kind !== e.kind && actualYearOf(x, rec.start).y === at.y);
  if (clash) return e.kind === 'year' ? `months of year ${at.y} are already recorded one by one: a year and its months would count twice` : `year ${at.y} is already recorded as a whole: a year and its months would count twice`;
  return null;
}
/* Actual beside modelled, entry by entry and year by year. `m`: the
   property as saved, modelled. */
function actualsCompare(d, m, rec, { now = acThisMonth() } = {}) {
  const lets = !!m.letsToTenant, price = num0(d.price);
  const rows = rec.entries.map(e => {
    const at = actualYearOf(e, rec.start);
    const yr = at.y ? m.path?.[at.y - 1] : null;
    const share = e.months / 12;
    const modelled = !yr ? null : { rent: lets ? yr.rent * share : null, vacancy: lets ? num0(d.vacancyPct) / 100 * e.months : null, costs: yr.opex * share };
    if (modelled) modelled.net = (lets ? modelled.rent : 0) - modelled.costs;
    const actual = { rent: isNum(e.rent) ? e.rent : null, vacancy: isNum(e.vacancy) ? e.vacancy : null, costs: isNum(e.costs) ? e.costs : null };
    actual.net = isNum(actual.costs) && (!lets || isNum(actual.rent)) ? (lets ? actual.rent : 0) - actual.costs : null;
    const diff = Object.fromEntries(['rent', 'vacancy', 'costs', 'net'].map(k => [k, modelled && isNum(actual[k]) && isNum(modelled[k]) ? actual[k] - modelled[k] : null]));
    const partial = e.kind === 'year' ? (e.months < 12 ? `${e.months} of 12 months` : null) : e.period === now ? 'the month is not over' : null;
    return { e, y: at.y || null, month: at.month || null, why: at.why || null, months: e.months, modelled, actual, diff, partial };
  }).sort((a, b) => (a.y || 99) - (b.y || 99) || (a.month || 0) - (b.month || 0));
  const years = [...new Set(rows.filter(r => r.y).map(r => r.y))].map(y => {
    const rs = rows.filter(r => r.y === y);
    const months = rs.reduce((t, r) => t + r.months, 0);
    const open = rs.some(r => r.e.kind === 'month' && r.partial);
    const whole = months >= 12 && !open;
    const allNet = rs.every(r => isNum(r.actual.net));
    const net = allNet ? rs.reduce((t, r) => t + r.actual.net, 0) : null;
    const modelledNet = rs.every(r => r.modelled) ? rs.reduce((t, r) => t + r.modelled.net, 0) : null;
    const realised = whole && allNet && lets && price > 0 ? { net, yieldPct: net / price * 100 } : null;
    return { y, months, whole, open, allNet, net, modelledNet, realised };
  });
  return { rows, years, lets, price };
}
/* A year's line, in words: a realised yield only for a whole year. */
function actualYearWords(Y, { lets, price }) {
  const vs = isNum(Y.net) && isNum(Y.modelledNet) ? `: net before the loan ${acSigned(Y.net)} against ${acSigned(Y.modelledNet)} modelled (${acSigned(Y.net - Y.modelledNet, true)})` : '';
  if (Y.realised) return `Year ${Y.y} of the hold, all 12 months recorded${vs}. ${acSigned(Y.realised.net)} on the ${clMoney(price)} price is a realised net yield of ${fmtPct(Y.realised.yieldPct, 2)} for the year, before the loan — from the figures you recorded.`;
  if (!lets) return `Year ${Y.y} of the hold, ${Y.months} of 12 months recorded${vs}. A bare parcel earns no rent: no yield is stated.`;
  if (!Y.whole) return `Year ${Y.y} of the hold: ${Y.months} of 12 months recorded${Y.open ? ', one of them not over' : ''} — partial${vs}. No yield for the year is stated.`;
  return `Year ${Y.y} of the hold: 12 months recorded, but not every one with its rent and its costs${vs}. No yield for the year is stated.`;
}
const acSigned = (v, plus = false) => (isNum(v) ? `${v < 0 ? '−' : plus && v > 0 ? '+' : ''}${clMoney(Math.abs(Math.round(v * 100) / 100))}` : '—');
const acMonths = (v, plus = false) => (isNum(v) ? `${v < 0 ? '−' : plus && v > 0 ? '+' : ''}${fmtNum(Math.abs(v), Number.isInteger(Math.round(Math.abs(v) * 100) / 100) ? 0 : 2)} mo` : '—');
const acPeriodWords = (r) => (r.e.kind === 'year' ? `Year ${r.e.period} of the hold${r.months < 12 ? `, ${r.months} months` : ''}` : `${ndMonthWords(r.e.period)}${r.y ? ` — year ${r.y}, month ${r.month} of the hold` : ''}`);

/* THE CARD, in the Lab on a saved property (labDraw, 82-property-lab.js). */
const AC_FORM = {};
function labActualsCard(P, lab) {
  const rec = pmFind(lab.model);
  if (!rec) return null;
  const d = pmInputsOf(rec), m = dealModel(d);
  const lets = !!m.letsToTenant;
  const pre = labId(P, 'ac');
  const card = el('section', { class: 'card ls-section lab-ac', id: pre, 'aria-labelledby': `${pre}-h` });
  card.append(el('h2', { class: 'h-card', id: `${pre}-h` }, 'Actual against modelled'));
  card.append(el('p', { class: 'metaline lab-xr-lede' }, `What “${rec.name}” actually did, beside what was modelled for the same period — the property as saved, before the loan. Kept in this browser only. A period not whole says so, and no yield is stated for a year not fully recorded.`));
  const ac = actualsOf(rec.id);
  const form = AC_FORM[rec.id] ||= { kind: 'month' };
  const f = (k, label, attrs = {}, cls = '') => el('div', { class: `au-field ac-f ac-f-${k}${cls}`, 'data-for': attrs['data-for'] || null, hidden: attrs.hidden ? '' : null }, [
    el('label', { for: `${pre}-${k}`, class: 'au-label' }, label), el('input', { class: 'input au-in', id: `${pre}-${k}`, autocomplete: 'off', ...attrs, 'data-for': null, hidden: null })]);
  const kindSel = el('select', { class: 'select au-in', id: `${pre}-kind`, onchange: (e) => {
    form.kind = e.target.value;
    box.querySelectorAll('[data-for]').forEach(n => { n.hidden = n.dataset.for !== form.kind; });
  } }, [el('option', { value: 'month', selected: form.kind === 'month' ? '' : null }, 'A month'), el('option', { value: 'year', selected: form.kind === 'year' ? '' : null }, 'A year of the hold')]);
  const box = el('fieldset', { class: 'au-group ac-form', id: `${pre}-form` });
  box.append(el('legend', { class: 'au-legend' }, 'Record what it did'), el('div', { class: 'au-grid ac-grid' }, [
    f('start', 'First month of the hold', { type: 'month', value: ac.start || '' }),
    el('div', { class: 'au-field ac-f ac-f-kind' }, [el('label', { for: `${pre}-kind`, class: 'au-label' }, 'Recording'), kindSel]),
    f('month', 'Month', { type: 'month', 'data-for': 'month', hidden: form.kind !== 'month' }),
    f('year', 'Year of the hold', { type: 'number', min: '1', max: String(normHoldYears(d.holdYears)), step: '1', inputmode: 'numeric', 'data-for': 'year', hidden: form.kind !== 'year' }),
    f('months', 'Months it covers', { type: 'number', min: '1', max: '12', step: '1', inputmode: 'numeric', value: '12', 'data-for': 'year', hidden: form.kind !== 'year' }),
    lets ? f('rent', 'Rent received (RM)', { type: 'text', inputmode: 'decimal' }) : null,
    lets ? f('vacancy', 'Months vacant', { type: 'text', inputmode: 'decimal' }) : null,
    f('costs', 'Running costs paid (RM)', { type: 'text', inputmode: 'decimal' }),
  ]));
  box.querySelectorAll('[data-for]').forEach(n => { n.hidden = n.dataset.for !== form.kind; });
  const msg = el('p', { class: 'cl-msg metaline', id: `${pre}-msg`, role: 'status', 'aria-live': 'polite' }, CL_SAID[pre] || '');
  const redraw = (focus) => { for (const Q of [...LAB_PANELS]) if (Q.key === lab.key && Q.node.isConnected) labDraw(Q, focus); };
  box.append(el('div', { class: 'cl-acts' }, [el('button', { type: 'button', class: 'btn btn-ghost btn-sm ac-record', id: `${pre}-record`, onclick: () => {
    const v = (k) => String(box.querySelector(`#${pre}-${k}`)?.value ?? '').trim();
    const num = (k) => { const s = v(k); return s === '' ? null : /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN; };
    const say = (t) => { CL_SAID[pre] = t; msg.textContent = t; };
    const start = v('start');
    if (start && !ansMonth(start)) return say(`Not recorded — the first month “${start}” is not a month written YYYY-MM.`);
    const kind = kindSel.value;
    const e = { kind, period: kind === 'month' ? v('month') : (/^\d{1,2}$/.test(v('year')) ? Number(v('year')) : NaN), months: kind === 'month' ? 1 : (/^\d{1,2}$/.test(v('months')) ? Number(v('months')) : NaN),
      rent: lets ? num('rent') : null, vacancy: lets ? num('vacancy') : null, costs: num('costs'), at: new Date().toISOString() };
    const bad = ACTUAL_FIGURES.find(k => Number.isNaN(e[k]));
    if (bad) return say(`Not recorded — the ${bad === 'costs' ? 'costs' : bad === 'rent' ? 'rent' : 'months vacant'} “${v(bad)}” is not a figure written 1200 or 1200.50.`);
    const next = { start: start || ac.start, entries: ac.entries };
    const fault = actualRecordFault(next, e, { holdYears: normHoldYears(d.holdYears), lets });
    if (fault) return say(`Not recorded — ${fault}.`);
    const replaced = next.entries.some(x => x.kind === e.kind && x.period === e.period);
    next.entries = [...next.entries.filter(x => !(x.kind === e.kind && x.period === e.period)), e];
    if (!actualsWrite(rec.id, next)) return say(STORE_REFUSED);
    CL_SAID[pre] = `${replaced ? 'Replaced' : 'Recorded'} ${kind === 'month' ? ndMonthWords(e.period) : `year ${e.period} of the hold`} — in this browser only.`;
    redraw(`${pre}-record`);
  } }, 'Record')]), msg);
  card.append(box);
  /* The entries, actual beside modelled. */
  const cmp = actualsCompare(d, m, ac);
  if (cmp.rows.length) {
    const modelledKind = dealKind(d, m).kind === 'illustrative' ? 'illustrative' : 'modelled';
    const diffKind = kindFirst(['yours', modelledKind]);
    const list = el('div', { class: 'ac-list', id: `${pre}-list` });
    list.append(el('div', { class: 'ac-row ac-head', 'aria-hidden': 'true' }, [el('span', {}, ''), el('span', { class: 'ac-h' }, ['Actual ', kindBadge('yours', { link: false })]),
      el('span', { class: 'ac-h' }, ['Modelled ', kindBadge(modelledKind, { link: false })]), el('span', { class: 'ac-h' }, ['Difference ', kindBadge(diffKind, { link: false })])]));
    cmp.rows.forEach((r, i) => {
      const ent = el('div', { class: 'ac-entry', 'data-ac-entry': `${r.e.kind}:${r.e.period}`, role: 'group', 'aria-labelledby': `${pre}-e-${i}` });
      ent.append(el('div', { class: 'ac-entry-hd' }, [el('p', { class: 'ac-period', id: `${pre}-e-${i}` }, [acPeriodWords(r), r.partial ? el('span', { class: 'ac-partial', 'data-ac-partial': '1' }, ` — partial: ${r.partial}`) : null]),
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm ac-del', id: `${pre}-del-${i}`, onclick: () => {
          const now = actualsOf(rec.id);
          if (!actualsWrite(rec.id, { start: now.start, entries: now.entries.filter(x => !(x.kind === r.e.kind && x.period === r.e.period)) })) { toast(STORE_REFUSED); return; }
          CL_SAID[pre] = `Removed ${acPeriodWords(r)}.`;
          redraw(`${pre}-record`);
        } }, ['Remove', el('span', { class: 'sr-only' }, ` ${acPeriodWords(r)}`)])]));
      const figs = [lets ? ['rent', 'Rent received', acSigned] : null, lets ? ['vacancy', 'Months vacant', acMonths] : null, ['costs', 'Running costs paid', acSigned], ['net', lets ? 'Net, before the loan' : 'Net cost', acSigned]].filter(Boolean);
      for (const [k, label, fmt] of figs) ent.append(el('div', { class: 'ac-row', 'data-ac-fig': k }, [el('span', { class: 'ac-label' }, label),
        el('span', { class: 'ac-v num', 'data-ac': 'actual', 'data-value': isNum(r.actual[k]) ? String(Math.round(r.actual[k] * 100) / 100) : '' }, [el('span', { class: 'sr-only' }, 'Actual: '), isNum(r.actual[k]) ? fmt(r.actual[k]) : 'not recorded']),
        el('span', { class: 'ac-v num', 'data-ac': 'modelled', 'data-value': r.modelled && isNum(r.modelled[k]) ? String(Math.round(r.modelled[k] * 100) / 100) : '' }, [el('span', { class: 'sr-only' }, 'Modelled: '), r.modelled ? fmt(r.modelled[k]) : 'not modelled']),
        el('span', { class: 'ac-v num', 'data-ac': 'diff', 'data-value': isNum(r.diff[k]) ? String(Math.round(r.diff[k] * 100) / 100) : '' }, [el('span', { class: 'sr-only' }, 'Difference: '), isNum(r.diff[k]) ? fmt(r.diff[k], true) : '—'])]));
      if (r.why) ent.append(el('p', { class: 'metaline' }, `Not set beside the model: ${r.why}.`));
      list.append(ent);
    });
    card.append(list);
    card.append(el('ul', { class: 'ac-years', id: `${pre}-years` }, cmp.years.map(Y => el('li', { 'data-ac-year': String(Y.y), 'data-ac-realised': Y.realised ? fmtNum(Y.realised.yieldPct, 2) : '' }, actualYearWords(Y, cmp)))));
    card.append(el('details', { class: 'pc-more ls-l3 au-more', id: `${pre}-how` }, [el('summary', { class: 'pc-more-sum' }, 'How actual is set against modelled'),
      el('p', { class: 'pc-more-body au-note' }, 'Modelled is the calculator’s own year of the hold the period falls in, for the property as saved: the rent after its vacancy allowance, and the running costs, as a share of the year (one month is a twelfth). The difference is actual less modelled. Net is the rent less the running costs, before the loan, as the net yield is. A realised net yield is a year’s recorded net over the price, stated only when all twelve months of that year are recorded, each with its rent and its costs.')]));
  } else card.append(el('p', { class: 'metaline', 'data-ac-none': '1' }, 'Nothing recorded yet. A month needs the first month of the hold, so it can be set beside the year of the model it falls in.'));
  return card;
}
