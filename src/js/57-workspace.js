/* ==========================================================================
   RESEARCH WORKSPACE — everything saved, in one place, with its stamp

   Five kinds of saved object lived on five screens: valuation runs reachable
   only through a thesis that linked one, saved screens in the screener's
   drawer, tool snapshots in a table on Your data, investment cases on their
   own page, and — until this batch — no saved comparisons at all. Nothing
   listed them together, so nothing could say which of them had been saved
   under a model or a dataset this build no longer carries.

   This page is a list, fed by one adapter per kind over the stores that
   already exist. It owns no data of its own: open, duplicate and delete call
   the kind's own functions, so an item behaves here exactly as it does where
   it was made. Every row carries the stamp buildStamp wrote when the item was
   saved, and stampDiff says whether the model, the data, or both have moved
   since. An item saved before stamping says so instead of being shown as
   current.

   WHAT IT IS NOT. It is not shared, synced or backed by an account — there is
   none. It lives in this browser and says so at the top; the export on Your
   data is the only copy that travels, and it carries every kind listed here.
   ========================================================================== */

const WORKSPACE_KINDS = [
  { id: 'run',        label: 'Valuation runs' },
  { id: 'comparison', label: 'Comparisons' },
  { id: 'screen',     label: 'Screens' },
  { id: 'thesis',     label: 'Investment cases' },
  { id: 'work',       label: 'Tool snapshots' },
];
const WORKSPACE_KIND_ONE = { run: 'Valuation run', comparison: 'Comparison', screen: 'Saved screen', thesis: 'Investment case', work: 'Tool snapshot' };
const WORK_PATHS = { property: '/property/calculator', wheel: '/us-options/wheel', trading: '/research/trading-index' };
State.workspace = { kind: 'all', q: '' };

/* Whether a subject is synthetic, from a stamp when there is one and from the
   company as loaded now when there is not. */
const illusOf = (stamp, ids) => {
  if (stamp && stamp.illustrative) return stamp.illustrative;
  const rows = (ids || []).map(id => BY_ID.get(id)).filter(Boolean);
  if (!rows.length) return null;
  const n = rows.filter(r => !r.c.real).length;
  return n === 0 ? 'none' : n === rows.length ? 'all' : 'some';
};
const tkOf = (id) => BY_ID.get(id)?.c.tk || id;

function workspaceItems() {
  const items = [];

  /* Valuation runs. Deleting one unlinks it from any thesis that pointed at it,
     so the thesis card does not offer a run that is gone. */
  (store.read('runs', []) || []).forEach(run => {
    const r = BY_ID.get(run.id);
    items.push({
      kind: 'run', key: run.runId, name: `${run.ticker || tkOf(run.id)} — ${run.pack || 'valuation run'}`,
      subject: run.ticker || tkOf(run.id), ids: [run.id],
      created: run.stamp?.savedAt || run.saved, stamp: run.stamp, legacy: { model: run.model },
      illustrative: illusOf(run.stamp, [run.id]),
      detail: run.vals && isNum(run.vals.base) ? `Base case ${fmtMoney(run.vals.base, r?.c.ccy || 'USD')} a share when saved` : 'No estimate stored with this run',
      open: () => openRunDrawer(run.runId, run.id),
      extra: r ? [['Report', `${companyPath(r.c)}/report?run=${encodeURIComponent(run.runId)}`]] : [],
      remove: () => {
        store.write('runs', (store.read('runs', []) || []).filter(x => x.runId !== run.runId));
        let touched = false;
        (State.theses || []).forEach(t => { if (t.runRef === run.runId) { delete t.runRef; touched = true; } });
        if (touched) saveTheses();
      },
    });
  });

  loadComparisons().forEach(s => items.push({
    kind: 'comparison', key: s.id, name: s.name, subject: (s.tks || s.ids.map(tkOf)).join(', '), ids: s.ids,
    created: s.created, stamp: s.stamp, legacy: null, illustrative: illusOf(s.stamp, s.ids),
    detail: `${s.ids.length} compan${s.ids.length === 1 ? 'y' : 'ies'} · every cell kept as it read when saved`,
    open: () => openComparison(s.id),
    duplicate: () => saveComparisons([{ ...s, id: `cmp-${Date.now().toString(36)}${(CMP_SEQ++).toString(36)}`, name: `${s.name} (copy)`.slice(0, 80) }, ...loadComparisons()]),
    remove: () => saveComparisons(loadComparisons().filter(x => x.id !== s.id)),
  }));

  (State.savedScreens || []).forEach((s, idx) => items.push({
    kind: 'screen', key: `screen-${idx}-${s.name}`, name: s.name,
    subject: `${(s.snapshot?.matches || []).length} matches when saved`, ids: [],
    created: s.snapshot?.stamp?.savedAt || s.snapshot?.saved || null, stamp: s.snapshot?.stamp, legacy: { model: s.snapshot?.model ?? s.model },
    illustrative: null, detail: 'Criteria, and every match with its scores as saved',
    open: () => { navigate('/discover/screener'); openSavedScreen(idx); },
    remove: () => { State.savedScreens = State.savedScreens.filter((_, i) => i !== idx); store.write('savedScreens', State.savedScreens); },
  }));

  /* The two sample cases seeded on a first visit are listed as samples, not
     as the reader's work. */
  (State.theses || []).forEach(t => {
    const reviews = (store.read('reviews', {}) || {})[t.id];
    const nReviews = Array.isArray(reviews) ? reviews.length : 0;
    items.push({
      kind: 'thesis', key: t.id, name: `${tkOf(t.ticker)} — ${t.oneLine || 'no one-line case written yet'}`,
      sample: SEEDED_THESIS_IDS.includes(t.id), subject: tkOf(t.ticker), ids: [t.ticker],
      created: t.stamp?.savedAt || t.created, stamp: t.stamp, legacy: null, illustrative: illusOf(t.stamp, [t.ticker]),
      detail: `${nReviews} review${nReviews === 1 ? '' : 's'}${t.runRef ? ' · linked to a saved run' : ''}`,
      open: () => { navigate('/my/theses'); openThesisEditor(t); },
      remove: () => {
        const rv = store.read('reviews', {});
        if (rv && t.id in rv) { delete rv[t.id]; store.write('reviews', rv); }
        State.theses = State.theses.filter(x => x.id !== t.id); saveTheses();
      },
    });
  });

  /* A snapshot of the tool's sample inputs or worked example is a sample
     (workIsSample, 15-derivation.js), and says so. */
  loadWork().forEach(w => { const sample = workIsSample(w); items.push({
    kind: 'work', key: w.id, name: w.name, subject: WORK_KINDS[w.kind]?.label || w.kind, ids: [],
    created: w.stamp?.savedAt || w.savedAt, stamp: w.stamp, legacy: { model: w.modelVersion }, illustrative: null,
    sample, sampleWhy: sample ? 'Every input in it is the tool’s own sample or worked example. Not your work.' : null,
    detail: sample ? (w.kind === 'property' ? 'The calculator’s sample inputs, as saved — none of them is yours' : 'The worked example, as saved — none of it is yours')
      : 'Your own inputs to the tool, as saved',
    open: () => {
      if (!resumeWork(w.id)) { toast('That record holds nothing to restore'); return; }
      navigate(WORK_PATHS[w.kind] || '/my/data'); toast(`Resumed "${w.name}"`);
    },
    duplicate: () => duplicateWork(w.id),
    remove: () => deleteWork(w.id),
  }); });

  items.forEach(it => { it.diff = stampDiff(it.stamp, it.legacy); });
  return items;
}

const WS_STATUS_CLASS = { current: 'chip chip-ok', model: 'chip chip-warn', data: 'chip chip-warn', both: 'chip chip-warn', unstamped: 'chip' };
/* Every clock time saved here comes from toISOString, so it is UTC in both of
   its forms — the ISO one, and the tool snapshot's "2026-09-28 07:28", which
   was printed with no zone and read eight hours early in Malaysia. A bare
   date has no clock time to place. */
const fmtSaved = (v) => {
  if (!v) return 'date not recorded';
  const s = String(v);
  return s.length > 10 ? `${s.slice(0, 16).replace('T', ' ')} UTC` : s;
};

VIEWS.workspace = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(mySubnav('workspace'));
  const all = workspaceItems();

  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Workspace · this browser only'),
    el('h1', {}, 'Everything you have saved'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Valuation runs, comparisons, screens, investment cases and tool snapshots, each with the model and data version it was saved against — and whether either has moved since.'),
  ]));
  wrap.append(hd);

  /* The limits, before the list: where this lives, and what "moved" means. */
  const lim = el('div', { class: 'card ws-limits' });
  lim.append(el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:8px' }, [
    el('span', { class: 'chip chip-bronze' }, 'Beta'),
    el('span', { class: 'chip' }, 'Stored in this browser'),
    el('span', { class: 'chip' }, 'No account, no sync, no sharing'),
  ]));
  lim.append(el('p', { class: 'body', style: 'font-size:13px;max-width:72ch' },
    `Nothing here leaves this device. A cleared browser, private mode or a second machine starts empty; the export on Your data is the only copy that travels, and it carries every kind listed here. “Model moved” means the arithmetic has changed since the item was saved (now ${MODEL_VERSION}); “Data moved” means the statements under it are not the ones it was built on (this build: ${currentDataText()}).`));
  lim.append(el('a', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--sm)', href: href('/my/data'),
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/my/data'); } },
    'Export or restore everything'));
  wrap.append(lim);

  if (!all.length) {
    wrap.append(emptyStateCta('Nothing saved yet',
      'Save a valuation run in a company’s Valuation Studio, save a comparison, a screen or an investment case, or take a snapshot in the property, Cash Wheel or Trading Index tools — each appears here with its stamp.',
      'Open the company explorer', '/research'));
    return wrap;
  }

  /* Filters: by kind, and by the company or name a row carries. */
  const W = State.workspace;
  const counts = Object.fromEntries(WORKSPACE_KINDS.map(k => [k.id, all.filter(i => i.kind === k.id).length]));
  /* A kind with nothing left has no button below, so a filter still set to it
     could be neither seen nor pressed off. Deleting the last screen with
     Screens pressed left no button pressed and "Nothing saved matches that
     filter" over two saved cases. The filter goes back to All. */
  if (W.kind !== 'all' && !counts[W.kind]) W.kind = 'all';
  const moved = all.filter(i => ['model', 'data', 'both'].includes(i.diff.status)).length;
  const bar = el('div', { class: 'card ws-filters' });
  const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Show saved items of one kind', style: 'flex-wrap:wrap' });
  [{ id: 'all', label: 'All' }, ...WORKSPACE_KINDS].forEach(k => {
    const n = k.id === 'all' ? all.length : counts[k.id];
    if (k.id !== 'all' && !n) return;
    seg.append(el('button', { id: `ws-kind-${k.id}`, 'aria-pressed': W.kind === k.id ? 'true' : 'false', 'aria-selected': W.kind === k.id ? 'true' : 'false',
      onclick: () => { W.kind = k.id; renderKeepFocus(); } }, `${k.label} · ${n}`));
  });
  const q = el('div', { class: 'field ws-search' });
  q.append(el('label', { for: 'ws-q' }, 'Company or name'));
  q.append(el('input', { class: 'input', id: 'ws-q', type: 'search', value: W.q, placeholder: 'AAPL, Maybank, deal…', autocomplete: 'off',
    /* The re-render replaces the field, and focus alone put the caret back at
       the start: every keystroke after the first landed in front of the last,
       so typing "alpha" searched for "ahpla". The caret goes back where it was. */
    oninput: e => {
      const at = e.target.selectionStart;
      W.q = e.target.value; renderKeepFocus();
      const f = document.getElementById('ws-q');
      if (f && at != null) f.setSelectionRange(at, at);
    } }));
  bar.append(el('div', { class: 'row row-wrap', style: 'gap:var(--md);align-items:flex-end' }, [seg, q]));
  bar.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `${all.length} saved item${all.length === 1 ? '' : 's'}${moved ? `; ${moved} saved under a model or data version this build no longer carries` : '; none saved under a model or data version this build has since replaced'}.`));
  wrap.append(bar);

  const needle = W.q.trim().toLowerCase();
  const shown = all.filter(i => (W.kind === 'all' || i.kind === W.kind)
    && (!needle || `${i.name} ${i.subject} ${(i.ids || []).join(' ')}`.toLowerCase().includes(needle)));

  const listCard = el('div', { class: 'card', style: 'padding:0' });
  if (!shown.length) {
    listCard.append(el('div', { style: 'padding:var(--lg)' }, emptyState('Nothing saved matches that filter.')));
    wrap.append(listCard);
    return wrap;
  }
  const list = el('ul', { class: 'ws-list', 'aria-label': 'Saved items' });
  list.append(el('li', { class: 'ws-row ws-head', 'aria-hidden': 'true' }, [
    el('span', {}, 'Item'), el('span', {}, 'Saved'), el('span', {}, 'Calculation and data versions'), el('span', {}, 'Status'), el('span', {}, ''),
  ]));
  shown.forEach((i, idx) => {
    const status = el('span', { class: WS_STATUS_CLASS[i.diff.status] || 'chip', title: i.diff.text }, i.diff.label);
    const acts = el('div', { class: 'ws-acts' });
    /* Outline, not primary: a filled Open on every row was a page of primary
       actions, none of them dominant. Named for its row, as Delete is. */
    acts.append(el('button', { class: 'btn btn-ghost btn-sm ws-open', 'aria-label': `${i.kind === 'work' ? 'Resume' : 'Open'} ${i.name}`, onclick: () => i.open() }, i.kind === 'work' ? 'Resume' : 'Open'));
    (i.extra || []).forEach(([label, path]) => acts.append(el('a', { class: 'btn btn-ghost btn-sm', href: href(path),
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(path); } }, label)));
    /* Confirmed only if the browser kept it: a refused write left the list as
       it was under a toast that said otherwise. And focus is put back: the
       re-render destroyed the button that was pressed and dropped focus on
       <body>, so the next Tab started from the top of the page. A duplicate
       returns to its own Duplicate button; a deletion to the Open button of
       the row that took its place, or the search field when none is left. */
    const kept = (act, done, refocus) => {
      const refused = store.failed; act(); render(); refocus();
      toast(store.failed !== refused ? STORE_REFUSED : done);
    };
    if (i.duplicate) acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: `ws-dup-${i.key}`,
      onclick: () => kept(i.duplicate, 'Duplicated', () => document.getElementById(`ws-dup-${i.key}`)?.focus()) }, 'Duplicate'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Delete ${i.name}`,
      onclick: () => { if (!confirm(`Delete "${i.name}"? This browser holds the only copy.`)) return;
        kept(i.remove, 'Deleted', () => {
          const opens = $$('#views .ws-row .ws-acts > .ws-open');
          const next = opens[Math.min(idx, opens.length - 1)] || document.getElementById('ws-q');
          if (next) next.focus(); else focusMain();
        }); } }, 'Delete'));
    list.append(el('li', { class: 'ws-row' }, [
      el('div', { class: 'ws-name' }, [
        el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [
          el('span', { class: 'chip' }, WORKSPACE_KIND_ONE[i.kind]),
          i.sample ? el('span', { class: 'chip chip-bronze', title: i.sampleWhy || 'Seeded on a first visit to show what a case looks like. Not your work.' }, 'sample') : null,
          i.illustrative === 'all' ? el('span', { class: 'chip chip-bronze', title: ILLUS_TITLE }, 'illustrative figures')
            : i.illustrative === 'some' ? el('span', { class: 'chip chip-bronze', title: 'Some of the companies in it carry synthetic figures.' }, 'partly illustrative') : null,
        ]),
        el('strong', {}, i.name),
        el('span', { class: 'metaline' }, i.detail),
      ]),
      el('div', { class: 'ws-cell' }, [el('span', { class: 'ws-label' }, 'Saved'), el('span', { class: 'num' }, fmtSaved(i.created))]),
      el('div', { class: 'ws-cell ws-ver' }, [el('span', { class: 'ws-label' }, 'Versions'),
        el('span', {}, i.stamp?.model || i.legacy?.model || 'model not recorded'),
        el('span', { class: 'caption' }, i.stamp ? stampDataText(i.stamp) : 'data version not recorded')]),
      el('div', { class: 'ws-cell' }, [el('span', { class: 'ws-label' }, 'Status'), status,
        i.diff.status !== 'current' ? el('span', { class: 'caption ws-why' }, i.diff.text) : null]),
      acts,
    ]));
  });
  listCard.append(list);
  wrap.append(listCard);
  return wrap;
};
