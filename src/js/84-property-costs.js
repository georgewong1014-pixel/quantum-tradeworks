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
