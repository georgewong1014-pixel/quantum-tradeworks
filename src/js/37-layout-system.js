/* ==========================================================================
   THE QUANTUM RESPONSIVE LAYOUT SYSTEM (the owner's decision, 7 Oct 2026)
   --------------------------------------------------------------------------
   Defined once, here and in styles.css (layout-system), and checked: build
   --check holds the stylesheet to its tokens, served-check holds a served
   page's cards to the four types, mobile.mjs holds the phone patterns and
   the measure, coverage-frames holds an L3 drawer to moving nothing.

   FIVE RULES. One screen, one primary question. Numbers and visuals before
   explanation. Desktop compares; mobile sequences. Evidence is available,
   not imposed. The main action is always visible.

   THREE INFORMATION LEVELS, never all three at equal weight:
     L1 decision  the one or two figures the page exists for — the
                  card-metric size (--ls-metric), class ls-l1
     L2 context   the figures that qualify them — medium (--ls-l2), ls-l2
     L3 evidence  formulas, methodology, sources, assumptions — small and
                  collapsed: a <details>, or the evidence drawer (ls-l3)
   The disclosures that stay in sight — the status strip, "Not a
   valuation", "not a real listing" — are never L3.

   FOUR CARD TYPES, and no others (data-card): metric (a value, its label,
   its data badge), action (a title, one line, one call to action), alert
   ("N assumptions need evidence", "Review →"), insight (a finding, its
   figure, "See why →"). A region headed by its own heading is a section
   (ls-section), not a card; a figure inside a section that qualifies it
   is a figure (ls-fig), not a card.

   BREAKPOINTS, BY BEHAVIOUR (LS_BP; the media queries in styles.css):
     under 640    one column; the sticky action bar; tables become cards;
                  tab rows become one line of chips that scrolls
     640–1023     one or two columns; the navigation collapsible
     1024–1439    sidebar and workspace (up to --ls-workspace-max)
     1440 and up  sidebar, workspace and, where the page has evidence, the
                  evidence drawer on the right (--ls-drawer-w)
   Every rule is the window's, never the script's, so the page served
   before the script runs is laid out as the page it draws (prerender).

   THE CTA LADDER on what is built here: one site action; a product's
   action ("Analyse a property"); the conversion, "Save this"; no paid
   call to action.

   Pages on the system (LS_VIEWS): /property (and /property/lab, the same
   view) and /property/calculator. The rest come later, one at a time.
   ========================================================================== */

const LS_VIEWS = ['propertyLab', 'property'];
const LS_BP = { tablet: 640, desktop: 1024, wide: 1440 };
const LS_CARD_TYPES = ['metric', 'action', 'alert', 'insight'];
const lsOn = (view = State.view) => LS_VIEWS.includes(view);
/* The window, as the stylesheet reads it. */
const lsWide = () => typeof matchMedia === 'function' && matchMedia(`(min-width: ${LS_BP.wide}px)`).matches;
const lsPhone = () => typeof matchMedia === 'function' && matchMedia(`(max-width: ${LS_BP.tablet - 0.02}px)`).matches;

/* ------------------------------------------------------------------- cards */
/* METRIC: its label, its value and its data badge — the figure's kind (the
   evidence words today; the shared badge set, plan 3.7, when it lands).
   level 1 is the decision's size, level 2 the context's. */
function lsMetricCard({ label, value, badge = null, sub = null, level = 1, tone = null, cls = '', attrs = {}, valueAttrs = {} }) {
  return el('div', { ...attrs, class: `ls-card ls-l${level}${cls ? ` ${cls}` : ''}`, 'data-card': 'metric', 'data-level': String(level) }, [
    el('p', { class: 'ls-card-hd' }, [el('span', { class: 'ls-card-label' }, label), badge ? ' ' : null, badge]),
    el('p', { ...valueAttrs, class: `ls-card-value num${tone ? ` ${tone}` : ''}${valueAttrs.class ? ` ${valueAttrs.class}` : ''}` }, value),
    sub != null ? el('p', { class: 'ls-card-sub' }, sub) : null,
  ]);
}
/* ACTION: a title, one line and one call to action, the whole card its
   target (the call's ::after reaches over it). */
function lsActionCard({ title, line, cta, badge = null, cls = '', attrs = {} }) {
  cta.classList.add('ls-card-cta');
  return el('div', { ...attrs, class: `ls-card${cls ? ` ${cls}` : ''}`, 'data-card': 'action' }, [
    el('p', { class: 'ls-card-hd' }, [el('span', { class: 'ls-card-label' }, title), badge ? ' ' : null, badge]),
    el('p', { class: 'ls-card-act' }, cta),
    el('p', { class: 'ls-card-sub' }, line),
  ]);
}
/* ALERT: what needs the reader, counted, and "Review →". */
function lsAlertCard({ text, sub = null, cta, cls = '', attrs = {} }) {
  cta.classList.add('ls-card-cta');
  return el('div', { ...attrs, class: `ls-card${cls ? ` ${cls}` : ''}`, 'data-card': 'alert' }, [
    el('span', { class: 'ls-card-mark', 'aria-hidden': 'true' }, '!'),
    el('div', { class: 'ls-card-body' }, [el('p', { class: 'ls-card-title' }, text), sub ? el('p', { class: 'ls-card-sub' }, sub) : null]),
    cta,
  ]);
}
/* INSIGHT: a finding, its figure, and "See why →" into the evidence. */
function lsInsightCard({ figure, finding, sub = null, cta, cls = '', attrs = {}, label = null }) {
  cta.classList.add('ls-card-cta');
  return el('div', { ...attrs, class: `ls-card${cls ? ` ${cls}` : ''}`, 'data-card': 'insight' }, [
    label ? el('p', { class: 'ls-card-hd' }, el('span', { class: 'ls-card-label' }, label)) : null,
    el('div', { class: 'ls-card-row' }, [figure, el('div', { class: 'ls-card-body' }, [finding, sub])]),
    cta,
  ]);
}
/* The call to action a card ends on, as a link (an address) or a button. */
function lsCta(words, { path = null, onclick = null, id = null, sr = null } = {}) {
  const kids = [words, el('span', { class: 'ls-arrow', 'aria-hidden': 'true' }, ' →'), sr ? el('span', { class: 'sr-only' }, sr) : null];
  if (path) return el('a', { class: 'ls-cta', id, href: href(path), onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); if (onclick) onclick(e); else navigate(path);
  } }, kids);
  return el('button', { type: 'button', class: 'ls-cta', id, onclick }, kids);
}

/* ------------------------------------------------------- the evidence (L3) */
/* THE EVIDENCE DRAWER. One <aside> of L3 sections, each a <details>: from
   1440px it stands in the page's right-hand column (--ls-drawer-w), so a
   section opened or closed there moves nothing in the workspace; under
   1440px it is a collapsed section where the page puts it. Its sections
   open where they are; nothing in it is open until the reader opens it. */
function lsEvidence({ id, title = 'Evidence', lede = null, sections = [] }) {
  return el('aside', { class: 'ls-evidence ls-l3', id, 'data-level': '3', 'aria-labelledby': `${id}-h` }, el('div', { class: 'ls-evidence-in' }, [
    el('h2', { class: 'ls-evidence-h', id: `${id}-h` }, title),
    lede ? el('p', { class: 'ls-evidence-lede' }, lede) : null,
    ...sections,
  ]));
}
function lsEvidenceSection({ id = null, summary, body, cls = '' }) {
  return el('details', { class: `ls-ev${cls ? ` ${cls}` : ''}`, id }, [
    el('summary', { class: 'ls-ev-sum' }, el('span', { class: 'ls-ev-t' }, summary)),
    el('div', { class: 'ls-ev-body' }, body),
  ]);
}
/* "See why →": the section opened, in sight and given the keyboard —
   in the drawer from 1440px, under its summary below it. */
function lsOpenEvidence(details) {
  if (!details) return;
  details.open = true;
  const sum = details.querySelector(':scope > summary');
  const box = details.closest('.ls-evidence');
  const r = details.getBoundingClientRect();
  if (!(r.top >= 0 && r.bottom <= innerHeight)) details.scrollIntoView({ block: lsWide() && box ? 'nearest' : 'start' });
  sum?.focus({ preventScroll: true });
}

/* --------------------------------------------------------- the action bar */
/* THE STICKY ACTION BAR (under 640px). A page's own actions — never the
   site's navigation: no new tab bar (the owner's decision). At most three,
   each a 44px target, the conversion last and the only filled one. Drawn
   into the page's dock (decisionDock, 30-charts.js), which is fixed to the
   bottom, respects the safe area, publishes its height (--dock-h) so the
   page's end is reserved above it, and goes inert behind an open drawer;
   from 640px the bar is not shown, and on a page with no dock of its own
   neither is the dock (.dock.ls-dock-phone). */
function lsActionBar(actions) {
  const bar = el('nav', { class: 'ls-actbar', 'aria-label': 'Page actions' });
  for (const a of actions.filter(Boolean)) {
    const cls = `ls-act${a.primary ? ' ls-act-primary' : ''}`;
    const kids = [el('span', { class: 'ls-act-ico', 'aria-hidden': 'true', html: icon(a.icon || 'chart', 18) }), el('span', { class: 'ls-act-word' }, a.label)];
    /* A disabled action stays in its place (aria-disabled, so the bar
       never changes shape) and says why when pressed. */
    const b = a.path
      ? el('a', { class: cls, id: a.id || null, href: href(a.path), 'aria-label': a.aria || null, onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
          e.preventDefault(); navigate(a.path);
        } }, kids)
      : el('button', { type: 'button', class: cls, id: a.id || null, 'aria-label': a.aria || null,
          'aria-disabled': a.disabled ? 'true' : null, onclick: (e) => {
            if (b.getAttribute('aria-disabled') === 'true') { e.preventDefault(); const s = typeof a.said === 'function' ? a.said() : a.said; if (s) toast(s); return; }
            a.onclick?.(e);
          } }, kids);
    bar.append(b);
  }
  return bar;
}
/* A bar's action brought up to date where the page changes without a
   redraw (the Lab's Save as its columns change). */
function lsActUpdate(id, { label = null, aria = null, disabled = null } = {}) {
  const b = document.getElementById(id);
  if (!b) return;
  if (label != null) { const w = b.querySelector('.ls-act-word'); if (w && w.textContent !== label) w.textContent = label; }
  if (aria != null && b.getAttribute('aria-label') !== aria) b.setAttribute('aria-label', aria);
  if (disabled != null) { if (disabled) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); }
}
/* Where a bar's action takes the reader on the page: the place in sight,
   under the topbar and clear of the bar, and the keyboard on it. */
function lsGoTo(target, focus = null) {
  if (!target) return;
  target.scrollIntoView({ block: 'start' });
  const f = focus || target;
  if (f && !f.matches('a, button, input, select, textarea, summary, [tabindex]')) f.setAttribute('tabindex', '-1');
  f?.focus({ preventScroll: true });
}

/* -------------------------------------------------------- tables to cards */
/* UNDER 640PX A TABLE THE SYSTEM NAMES IS A CARD A ROW (ls-tcards): each
   cell says its column's name beside its figure (data-label), all from the
   stylesheet, so the page served before the script is the page drawn. The
   selected row stands as a card; the others wait behind one button —
   "Compare 70% & 80% ↓" — which from 640px is out of sight and out of
   reach, never display:none, so the served page carries it as the drawn
   one does (prerender: what is not displayed is not served). */
const LS_TCARDS_OPEN = new Set();
function lsTableCards(table, { id, selected = null, more = null } = {}) {
  table.classList.add('ls-tcards');
  table.id = table.id || id;
  const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
  for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]); });
  if (selected == null || selected < 0 || !more) return { table, toggle: null };
  table.querySelectorAll('tbody tr').forEach((tr, i) => tr.classList.toggle('ls-tcard-sel', i === selected));
  const open = LS_TCARDS_OPEN.has(table.id);
  table.classList.toggle('is-open', open);
  const toggle = el('button', { type: 'button', class: 'btn btn-ghost btn-sm ls-tcards-more', 'aria-controls': table.id, 'aria-expanded': open ? 'true' : 'false',
    onclick: () => {
      const now = !table.classList.contains('is-open');
      table.classList.toggle('is-open', now);
      if (now) LS_TCARDS_OPEN.add(table.id); else LS_TCARDS_OPEN.delete(table.id);
      toggle.setAttribute('aria-expanded', now ? 'true' : 'false');
      toggle.querySelector('.ls-tcards-word').textContent = now ? more.close : more.open;
    } }, [el('span', { class: 'ls-tcards-word' }, open ? more.close : more.open), el('span', { class: 'ls-tcards-chev', 'aria-hidden': 'true' }, '↓')]);
  return { table, toggle };
}
/* The rows a table marks selected (a 1-based index into its body, or a
   predicate on the row). */
const lsSelectedRow = (rows, pick) => Math.max(0, rows.findIndex(pick));

/* -------------------------------------------------------------------- chips */
/* UNDER 640PX A ROW OF TABS IS ONE LINE OF CHIPS THAT SCROLLS SIDEWAYS
   (ls-chips), never two lines: the stylesheet does it; this keeps the
   chosen chip in its row's sight once the row is laid out. */
function lsChipsInView(row) {
  if (!row) return;
  const on = row.querySelector('.is-on, [aria-current="page"], [aria-selected="true"]');
  if (!on || row.scrollWidth <= row.clientWidth + 1) return;
  const r = row.getBoundingClientRect(), b = on.getBoundingClientRect();
  if (b.left < r.left || b.right > r.right) row.scrollLeft += (b.left + b.width / 2) - (r.left + r.width / 2);
}

/* ------------------------------------------------------------ kind badges */
/* THE EIGHT KIND BADGES (plan item 3.7; the owner's decision D6, with N6's
   eighth word). One word for what kind of figure a number is, the same
   word wherever the figure is shown — the metric card's data badge, the
   homepage's visuals, and, a round at a time, every figure on the site.
   Each badge is its word and a shape (.kind-shape: a square, a triangle, a
   diamond, a disc, a quotation mark, a ring, a dashed box, a cross), never
   a colour alone; it keeps the figure's fine label ("verified
   transaction", "assumed default") in its title; and it links to where the
   eight are defined, /data-sources#kinds. Badges are added beside what a
   page already says — the strip, the footer's paragraph, /data-sources and
   "Not a valuation" are unchanged by them.
   The words' meanings are KIND_BADGES' notes, read by /data-sources too. */
const KIND_BADGES = {
  filed:        { word: 'Filed',        note: 'Taken from a statement filed with the US SEC, as filed. Not adjusted.' },
  derived:      { word: 'Derived',      note: 'Arithmetic on figures of another kind, and exactly as reliable as they are. No assumption is involved.' },
  modelled:     { word: 'Modelled',     note: 'An output of assumptions you can see and change. Other assumptions give another figure.' },
  yours:        { word: 'Yours',        note: 'A figure you entered or imported, or evidence you recorded: a price, a close, a rent, a transaction you have seen.' },
  quoted:       { word: 'Quoted',       note: 'Quoted by a seller, a developer or their agent, and not checked against a transaction.' },
  illustrative: { word: 'Illustrative', note: 'A synthetic or sample figure that describes no real company or property: an illustrative company, or the tool’s starting deal.' },
  placeholder:  { word: 'Placeholder',  note: 'A stand-in the tool carries so the sum runs — not a quote, not checked against its source; replace it before relying on the total.' },
  unavailable:  { word: 'Unavailable',  note: 'No figure is shown, and the reason is stated beside it. Nothing is imputed.' },
};
/* When more than one applies to a figure, the first in this order wins. */
const KIND_ORDER = ['unavailable', 'illustrative', 'placeholder', 'quoted', 'yours', 'modelled', 'derived', 'filed'];
const kindFirst = (kinds) => KIND_ORDER.find(k => kinds.includes(k)) || null;
/* Each source's kinds, to exactly one badge (build --check holds every
   PROVENANCE kind, every EVIDENCE id and every fee status to one). */
const KIND_OF_PROVENANCE = { reported: 'filed', calculated: 'derived', modelled: 'modelled', market: 'yours', illustrative: 'illustrative', unavailable: 'unavailable' };
const KIND_OF_EVIDENCE = { verified: 'yours', public: 'yours', user: 'yours', developer: 'quoted', estimated: 'derived', assumed: 'illustrative', illustrative_default: 'illustrative' };
/* A fee line by its provenance in the fee rulebook (70-property.js): a
   verified scale computed is Derived; an estimate, or an amount resting on
   a rule unknown for its jurisdiction, is a Placeholder; the reader's own
   quotation is Yours; a line with no amount at all ('unset') is
   Unavailable. */
const KIND_OF_FEE = { verified: 'derived', estimated: 'placeholder', unknown: 'placeholder', quote: 'yours', unset: 'unavailable' };
/* The badge. `fine`: the figure's own label, in the title before the
   word's meaning. `link`: false where the badge stands inside a link of
   its own, or on /data-sources itself. */
function kindBadge(kind, { fine = null, link = true } = {}) {
  const k = KIND_BADGES[kind] ? kind : 'unavailable';
  const b = KIND_BADGES[k];
  const kids = [el('span', { class: 'kind-shape', 'aria-hidden': 'true' }), b.word];
  const attrs = { class: `kind-badge kind-${k}`, 'data-kind-badge': k, title: fine ? `${fine} — ${b.note}` : b.note };
  return link ? el('a', { ...attrs, href: '/data-sources#kinds' }, kids) : el('span', attrs, kids);
}
