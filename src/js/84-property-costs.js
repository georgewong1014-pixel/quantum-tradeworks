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
    f('item', ptr('cl.item', 'Item'), { type: 'text', maxlength: String(COST_TEXT_MAX.item), placeholder: 'e.g. Kitchen cabinets' }),
    f('amount', ptr('cl.amount', 'Amount (RM)'), { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 12000' }),
    el('div', { class: 'au-field cl-f cl-f-kind' }, [el('label', { for: `${id}-kind`, class: 'au-label' }, ptr('cl.kind', 'Kind')), kindSel]),
    f('source', ptr('cl.source', 'Source — where it came from, in your words'), { type: 'text', maxlength: String(COST_TEXT_MAX.source), placeholder: 'e.g. Written quote ref. 123' }),
    f('date', ptr('cl.date', 'Date'), { type: 'date' }),
    f('includes', ptr('cl.includes', 'What it includes'), { type: 'text', maxlength: String(COST_TEXT_MAX.includes) }),
    f('excludes', ptr('cl.excludes', 'What it excludes'), { type: 'text', maxlength: String(COST_TEXT_MAX.excludes) }),
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
  /* A cost schedule, imported as lines (item 4). */
  body.append(costImportControl({ id, lines, write }));
  body.append(el('p', { class: 'metaline cl-note' }, s.sample
    ? 'A line added replaces the calculator’s sample figure. The total is the cost; each line keeps where it came from.'
    : 'The lines’ total is the cost. Each keeps its source, its date and what it covers; the total carries the weakest line’s badge.'));
  box.append(body);
  return box;
}

/* ==========================================================================
   THE COST-SCHEDULE IMPORT (the owner's approval of 10 Oct 2026, Track A,
   item 4). A versioned JSON or CSV file of cost lines — item, amount,
   currency (RM), source, date, includes, excludes, kind — read into an
   improvement's lines (QT-03's structure), keeping each line's source and
   date and where it came from (the file's name and row). A manual file
   only: chosen by the reader, read in the page; nothing is fetched and
   nothing is linked to any other system. Validated strictly: a file not in
   the format, or of another version, is refused whole; a bad row is
   refused with the reason and the rest imported; nothing is guessed (no
   separators in an amount, no currency but RM, a quote names its source
   and date). A line already among the lines — the same item, amount,
   kind, source, date, includes and excludes — is skipped, so importing a
   file twice does not double it. The format is published at
   /data-sources#cost-schedule, with a synthetic example of each kind.
   ========================================================================== */
const COST_SCHEDULE = {
  format: 'qt-cost-schedule', version: 1, currency: 'RM',
  fields: ['item', 'amount', 'currency', 'source', 'date', 'includes', 'excludes', 'kind'],
  maxRows: 200, maxBytes: 200 * 1024,
  examples: { json: '/data/examples/cost-schedule-v1.json', csv: '/data/examples/cost-schedule-v1.csv' },
};
/* What each field takes, as /data-sources publishes it. */
const COST_SCHEDULE_RULES = {
  item: 'Required. What the line is, up to 80 characters.',
  amount: 'Required. Ringgit, above nought, at most two decimal places, no separators or symbol: 12000 or 12000.50. In JSON a number.',
  currency: 'Required. RM — the only currency the format takes.',
  source: 'Where the figure came from, in your words, up to 120 characters. Required for a quoted line.',
  date: 'A date written YYYY-MM-DD. Required for a quoted line.',
  includes: 'What it covers, up to 200 characters. Optional.',
  excludes: 'What it leaves out, up to 200 characters. Optional.',
  kind: 'Required. quoted (a written quote), estimate (your own) or placeholder.',
};
/* A CSV of the format: its rows of cells, quotes as RFC 4180 has them
   (a field in double quotes may hold commas, line breaks and "" for a
   quote). Null where a quote is never closed. */
function costCsvRows(text) {
  const rows = []; let row = [], cell = '', q = false, line = 1, rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"' && cell === '') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(cell); rows.push({ cells: row, line: rowLine }); row = []; cell = ''; line++; rowLine = line; }
    else cell += c;
  }
  if (q) return null;
  if (cell !== '' || row.length) { row.push(cell); rows.push({ cells: row, line: rowLine }); }
  return rows;
}
/* One row of the format, read: a line, or the reason it is refused. */
function costScheduleRow(rec, { json }) {
  const extra = Object.keys(rec).filter(k => !COST_SCHEDULE.fields.includes(k));
  if (extra.length) return { why: `it carries “${extra[0].slice(0, 30)}”, which the format does not have` };
  const txt = (k) => (rec[k] == null ? '' : rec[k]);
  for (const k of ['item', 'source', 'date', 'includes', 'excludes', 'kind', 'currency']) if (rec[k] != null && typeof rec[k] !== 'string') return { why: `its ${k} is not text` };
  if (String(txt('currency')).trim() === '') return { why: 'it gives no currency: the format takes RM' };
  if (String(txt('currency')).trim() !== COST_SCHEDULE.currency) return { why: `its currency is “${String(rec.currency).trim().slice(0, 12)}”: the format takes RM only` };
  let amount;
  if (json) {
    if (typeof rec.amount !== 'number') return { why: rec.amount == null ? 'it has no amount' : 'its amount is not a number' };
    amount = rec.amount;
  } else {
    const s = String(txt('amount')).trim();
    if (!s) return { why: 'it has no amount' };
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { why: `its amount “${s.slice(0, 20)}” is not ringgit and sen written 12000 or 12000.50 (no separators or symbol)` };
    amount = Number(s);
  }
  const kind = String(txt('kind')).trim().toLowerCase();
  if (!kind) return { why: 'it gives no kind: quoted, estimate or placeholder' };
  const x = { item: txt('item'), amount, kind, source: txt('source'), date: String(txt('date')).trim(), includes: txt('includes'), excludes: txt('excludes') };
  const fault = costLineFault(x);
  if (fault) return { why: fault };
  return { line: x };
}
/* The file, read: { ok: false, err } refused whole, or { ok: true, kind,
   rows: [{ row, line }], refused: [{ row, why }] }. */
function parseCostSchedule(text, name = '') {
  const file = String(name || 'the file');
  const ext = /\.json$/i.test(file) ? 'json' : /\.csv$/i.test(file) ? 'csv' : null;
  if (!ext) return { ok: false, err: `“${file}” is neither a .json nor a .csv file: a cost schedule is one or the other` };
  const body = String(text ?? '').replace(/^﻿/, '');
  if (!body.trim()) return { ok: false, err: `“${file}” is empty` };
  if (body.length > COST_SCHEDULE.maxBytes) return { ok: false, err: `“${file}” is over ${COST_SCHEDULE.maxBytes / 1024} KB` };
  const rows = [], refused = [], seen = new Map();
  const take = (row, rec, json) => {
    const r = isRecord(rec) ? costScheduleRow(rec, { json }) : { why: 'it is not a record of the format’s fields' };
    if (r.why) { refused.push({ row, why: r.why }); return; }
    const fp = costLineFingerprint(r.line);
    if (seen.has(fp)) { refused.push({ row, why: `the same line as ${seen.get(fp)}` }); return; }
    seen.set(fp, row);
    rows.push({ row, line: r.line });
  };
  if (ext === 'json') {
    let doc;
    try { doc = JSON.parse(body); } catch (e) { return { ok: false, err: `“${file}” is not JSON: ${String(e.message).split('\n')[0].slice(0, 80)}` }; }
    if (!isRecord(doc) || doc.format !== COST_SCHEDULE.format) return { ok: false, err: `“${file}” is not a cost schedule: it does not say "format": "${COST_SCHEDULE.format}"` };
    if (doc.version !== COST_SCHEDULE.version) return { ok: false, err: `“${file}” is version ${JSON.stringify(doc.version ?? null)} of the format; this tool reads version ${COST_SCHEDULE.version}` };
    const extra = Object.keys(doc).filter(k => !['format', 'version', 'currency', 'title', 'lines'].includes(k));
    if (extra.length) return { ok: false, err: `“${file}” carries “${extra[0].slice(0, 30)}”, which the format does not have` };
    if (doc.currency != null && doc.currency !== COST_SCHEDULE.currency) return { ok: false, err: `“${file}” is in ${String(doc.currency).slice(0, 12)}: the format takes RM only` };
    if (!Array.isArray(doc.lines) || !doc.lines.length) return { ok: false, err: `“${file}” holds no lines` };
    if (doc.lines.length > COST_SCHEDULE.maxRows) return { ok: false, err: `“${file}” holds ${doc.lines.length} lines, over the ${COST_SCHEDULE.maxRows} the format takes` };
    doc.lines.forEach((x, i) => take(`entry ${i + 1}`, x, true));
  } else {
    const all = costCsvRows(body);
    if (!all) return { ok: false, err: `“${file}” opens a quoted field it never closes` };
    const lines = all.filter(r => r.cells.some(c => c.trim() !== ''));
    const head = lines[0]?.cells.map(c => c.trim()) || [];
    while (head.length && head.at(-1) === '') head.pop();
    if (head[0] !== COST_SCHEDULE.format || head.length !== 2) return { ok: false, err: `“${file}” does not begin with the line “${COST_SCHEDULE.format},${COST_SCHEDULE.version}”, which names the format and its version` };
    if (head[1] !== String(COST_SCHEDULE.version)) return { ok: false, err: `“${file}” is version ${head[1]} of the format; this tool reads version ${COST_SCHEDULE.version}` };
    const cols = (lines[1]?.cells || []).map(c => c.trim().toLowerCase());
    while (cols.length && cols.at(-1) === '') cols.pop();
    const missing = COST_SCHEDULE.fields.filter(f => !cols.includes(f));
    const unknown = cols.filter(c => !COST_SCHEDULE.fields.includes(c));
    const twice = cols.filter((c, i) => cols.indexOf(c) !== i);
    if (missing.length || unknown.length || twice.length) return { ok: false, err: `“${file}”’s second line is not the header the format names (${COST_SCHEDULE.fields.join(', ')}): ${[missing.length ? `${missing.join(', ')} missing` : null, unknown.length ? `“${unknown[0].slice(0, 30)}” not a field` : null, twice.length ? `“${twice[0]}” twice` : null].filter(Boolean).join('; ')}` };
    const data = lines.slice(2);
    if (!data.length) return { ok: false, err: `“${file}” holds no lines` };
    if (data.length > COST_SCHEDULE.maxRows) return { ok: false, err: `“${file}” holds ${data.length} lines, over the ${COST_SCHEDULE.maxRows} the format takes` };
    for (const r of data) {
      const cells = r.cells.slice();
      while (cells.length > cols.length && cells.at(-1).trim() === '') cells.pop();
      if (cells.length !== cols.length) { refused.push({ row: `row ${r.line}`, why: `it has ${cells.length} cells where the header has ${cols.length}` }); continue; }
      take(`row ${r.line}`, Object.fromEntries(cols.map((c, i) => [c, cells[i]])), false);
    }
  }
  return { ok: true, kind: ext, file, rows, refused };
}
/* Into the lines a target holds: each new line kept with where it came
   from; a line already among them skipped. */
function costImportMerge(current, parsed) {
  const have = new Set(current.map(costLineFingerprint));
  const added = [], skipped = [...parsed.refused];
  for (const r of parsed.rows) {
    const fp = costLineFingerprint(r.line);
    if (have.has(fp)) { skipped.push({ row: r.row, why: 'already among the lines' }); continue; }
    have.add(fp);
    added.push({ ...r.line, from: { file: parsed.file, version: COST_SCHEDULE.version, row: Number(String(r.row).replace(/\D/g, '')) || null } });
  }
  return { lines: [...current, ...added], added, skipped };
}
/* What an import did, in one sentence or two. */
function costImportWords(parsed, merged) {
  if (!parsed.ok) return `Nothing imported — ${parsed.err}.`;
  const sum = merged.added.reduce((t, x) => t + x.amount, 0);
  const skip = merged.skipped.slice(0, 8).map(x => `${x.row} — ${x.why}`).join('; ') + (merged.skipped.length > 8 ? `; and ${merged.skipped.length - 8} more` : '');
  return merged.added.length
    ? `Imported ${merged.added.length} line${merged.added.length === 1 ? '' : 's'} from “${parsed.file}” (${COST_SCHEDULE.format}, version ${COST_SCHEDULE.version}): ${clMoney(Math.round(sum * 100) / 100)}.${merged.skipped.length ? ` Skipped ${merged.skipped.length}: ${skip}.` : ''}`
    : `Nothing imported from “${parsed.file}”${merged.skipped.length ? `. Skipped ${merged.skipped.length}: ${skip}.` : '.'}`;
}
/* The control, in the editor: a file the reader chooses, read here. */
function costImportControl({ id, lines, write }) {
  const fid = `${id}-file`;
  const say = el('p', { class: 'cl-msg metaline cl-import-msg', id: `${id}-import-msg`, role: 'status', 'aria-live': 'polite' }, CL_SAID[`${id}-import`] || '');
  const input = el('input', { type: 'file', class: 'input au-in cl-file', id: fid, accept: '.json,.csv,application/json,text/csv', onchange: async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const parsed = f.size > COST_SCHEDULE.maxBytes ? { ok: false, err: `“${f.name}” is over ${COST_SCHEDULE.maxBytes / 1024} KB` } : parseCostSchedule(await f.text(), f.name);
    const merged = parsed.ok ? costImportMerge(clStart(lines), parsed) : null;
    CL_SAID[`${id}-import`] = costImportWords(parsed, merged);
    CL_OPEN.add(id);
    if (merged?.added.length) write(merged.lines);
    else say.textContent = CL_SAID[`${id}-import`];
    e.target.value = '';
  } });
  return el('div', { class: 'au-field cl-import', id: `${id}-import` }, [
    el('label', { for: fid, class: 'au-label' }, ptr('cl.import', 'Import a cost schedule — a .json or .csv file in the published format')),
    /* In a box of the control's own height: a served page carries no file
       field (prerender.mjs removes it), and the words under it must stand
       where the drawn page puts them. */
    el('span', { class: 'cl-file-box' }, input),
    el('p', { class: 'metaline cl-import-note' }, 'Read in this page from the file you choose; nothing is fetched or sent.'),
    el('a', { class: 'cl-import-link metaline', href: '/data-sources#cost-schedule' }, 'The format, and an example'),
    say]);
}

/* THE FORMAT, PUBLISHED (/data-sources#cost-schedule): its name and
   version, each field's rule, and the two synthetic examples to download. */
function costScheduleCard() {
  const card = el('section', { class: 'card cost-schedule', id: 'cost-schedule', style: 'margin-bottom:var(--md)', 'aria-labelledby': 'cost-schedule-h' });
  card.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h2', { class: 'h-card', id: 'cost-schedule-h' }, `Cost schedule format, version ${COST_SCHEDULE.version}`),
    el('p', { class: 'caption', style: 'margin-top:2px' }, 'The file the property calculator and the Scenario Lab import as cost lines — renovation, refurbishment, an upgrade. A manual file only: you choose it, the page reads it, nothing is fetched and nothing is linked to any other system.'),
  ])));
  card.append(el('dl', { class: 'fee-book-dl cost-schedule-fields', 'aria-label': 'The fields of a cost line' },
    COST_SCHEDULE.fields.flatMap(f => [el('dt', {}, el('code', {}, f)), el('dd', {}, COST_SCHEDULE_RULES[f])])));
  card.append(el('p', { class: 'body cost-schedule-shape', style: 'font-size:13px' }, [
    el('strong', {}, 'JSON: '), `an object { "format": "${COST_SCHEDULE.format}", "version": ${COST_SCHEDULE.version}, "currency": "RM", "lines": [ … ] }, a line an object of the fields above. `,
    el('strong', {}, 'CSV: '), `the first line “${COST_SCHEDULE.format},${COST_SCHEDULE.version}”, the second the field names, then a line a row; a field holding a comma in double quotes. `,
    `At most ${COST_SCHEDULE.maxRows} lines and ${COST_SCHEDULE.maxBytes / 1024} KB.`]));
  card.append(el('p', { class: 'body', style: 'font-size:13px' }, 'Checked strictly: a file of another format or version is refused whole; a row that breaks a rule is refused with the reason and the others are imported; nothing is guessed. A line already among the lines is skipped, so a file imported twice is not counted twice. Each line keeps its source, its date and the file it came from.'));
  card.append(el('p', { class: 'body cost-schedule-dl', style: 'font-size:13px' }, ['Examples, made up for the format — no real quotation, business or property: ',
    el('a', { href: COST_SCHEDULE.examples.json, download: 'cost-schedule-v1.json', 'data-example': 'json' }, 'cost-schedule-v1.json'), ' · ',
    el('a', { href: COST_SCHEDULE.examples.csv, download: 'cost-schedule-v1.csv', 'data-example': 'csv' }, 'cost-schedule-v1.csv'), '.']));
  return card;
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
