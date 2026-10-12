/* ==========================================================================
   THE PROPERTY FLOW — EXPLORE → ANALYSE → COMPARE → SAVE (the 11 Oct 2026
   daily audit, #8, owner-approved 12 Oct 2026)
   --------------------------------------------------------------------------
   Property's tools were five separate pages — the Scenario Lab, the
   calculator, the area screen, the comparables and the opportunity
   register — and nothing carried the property a reader was working on from
   one to the next: a record opened from the register, a column moved in the
   Lab, a route answered for it, were all on the Lab's page alone, and the
   tab row's "Scenario Lab" opened whatever the calculator held.

   ONE LINE OF STEPS, ON EVERY PROPERTY PAGE, at the top of the page:
     Explore   the area screen, the comparables, the opportunity register
               (the one last visited)
     Analyse   the Scenario Lab — on the work it holds — and the calculator
     Compare   the Lab's comparison: across routes and assets (P6) where the
               columns are of more than one property, else A, B and C
     Save      the Lab's Save while it holds what-ifs not saved; else
               My properties, where what is saved is listed
   the step of the page on screen marked (aria-current="step"). And on any
   Property page but the Lab, the work the Lab holds — its property, the
   column the sliders move where that is another property's, how many moves
   are not saved — with "Resume in the Lab": the same subject, its columns,
   its moves and its answers, as this tab holds them (labResume, read by
   labArrive before the address).

   NOTHING IS WRITTEN BEFORE SAVE (the owner's rule). The work is the Lab's
   own state in this tab's memory (LAB, 82-property-lab.js) — no store key,
   no session storage, no address of moves — so it lasts as long as the
   tab, and the reader is told so where it could be lost:
     - here, "N moves not saved — kept in this tab until you save; lost on
       reload or close";
     - by the browser's own prompt when the tab is reloaded, closed or left
       for another site with moves not saved (beforeunload);
     - before a register record replaces a column holding moves
       (labAddOpportunity's confirm).
   Nothing is ranked and no figure is shown here: the flow names steps and
   a property, never a result.

   ON A PHONE (under 640px) the Lab and the calculator carry the last three
   steps in their action bar — Analyse · Compare · Save (the layout
   system) — so the line of steps stands on the other Property pages only,
   as one line of 44px chips; the calculator keeps the work's line where the
   Lab holds moves not saved. Every rule is the window's (styles.css,
   property-flow): the page served before the script is the page drawn.
   ========================================================================== */
const PF_STEPS = [
  { id: 'explore', label: 'Explore' },
  { id: 'analyse', label: 'Analyse' },
  { id: 'compare', label: 'Compare' },
  { id: 'save', label: 'Save' },
];
const PF_STEP_OF = { areas: 'explore', comparables: 'explore', opportunities: 'explore', propertyLab: 'analyse', property: 'analyse', propertyModels: 'save' };
const PF_EXPLORE_PATH = { areas: '/property/areas', comparables: '/property/comparables', opportunities: '/property/opportunities' };
/* The explore page last visited, this tab: where Explore goes back to. */
let pfExplore = '/property/opportunities';

/* WHAT THE LAB HOLDS NOT SAVED, in moves: every column's (an answer is a
   move of each column it moves) and the figures a lab copy was copied with. */
function labUnsavedOf(lab) {
  if (!lab) return 0;
  return lab.cols.reduce((n, c) => n + labMoveCount(c) + (c.source === 'variant' ? Object.keys(c.inherited || {}).length : 0), 0);
}
const labUnsavedAll = () => Object.values(LAB).reduce((n, lab) => n + labUnsavedOf(lab), 0);

/* THE WORK IN THE LAB, as the other Property pages name it: its property,
   the column the sliders move where that is another property's, the moves
   not saved, and the lab's address for it. Null until the Lab has been
   opened in this tab. */
function pfContext() {
  const lab = labSubject && LAB[labSubject];
  if (!lab) return null;
  const rec = lab.model ? pmFind(lab.model) : null;
  if (lab.model && !rec) return null;
  const name = rec ? `“${rec.name}”` : propertyStatus(State.deal).kind === 'sample' ? 'the sample deal' : 'the deal on the calculator';
  const act = lab.cols.find(c => c.key === lab.active);
  const q = labQueryOf(lab);
  return { lab, name, other: act?.prop ? `${act.key} — ${act.name}` : null, moves: labUnsavedOf(lab), path: `/property/lab${q ? `?${q}` : '?'}` };
}
/* Where the work's property is: the column the sliders move. */
function pfPlace() {
  const lab = labSubject && LAB[labSubject];
  const col = lab && lab.cols.find(c => c.key === lab.active);
  return col?.work?.city ? { city: col.work.city, district: col.work.district || null } : null;
}
/* To the Lab, on its work (labResume): the columns, their moves and the
   answers given, as they were — then, for Compare or Save, that place. */
function pfToLab(ctx, goTo = null) {
  if (ctx) State.labResume = ctx.lab.key;
  State.labGoTo = goTo;
  navigate(ctx ? ctx.path : '/property/lab?');
}
/* "Use it in the Scenario Lab" and the like from another Property page: the
   work the Lab holds, where it holds one; else /property, as before. */
function pfResumeLab() {
  const ctx = pfContext();
  if (ctx) pfToLab(ctx); else navigate('/property');
}

const pfPlain = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button);
/* THE LINE, drawn above every Property page (drawPage, 35-ui.js). */
function propertyFlowNode(view = State.view) {
  const here = PF_STEP_OF[view];
  if (!here) return null;
  if (here === 'explore') pfExplore = PF_EXPLORE_PATH[view];
  const ctx = pfContext();
  const onLab = view === 'propertyLab';
  const unsaved = ctx ? ctx.moves : 0;
  /* Explore is a page — a link. Analyse, Compare and Save act on the work
     this tab holds (the Lab's columns, moves and answers, in its memory): a
     link to them would open a new tab without it, so each is a button, and
     the line is no second strip of the tab row's links. */
  const step = (s) => {
    const save = s.id === 'save', toModels = save && !unsaved && !onLab;
    const current = s.id === here;
    const attrs = { class: `pf-step${current ? ' is-here' : ''}`, id: `pf-${s.id}`, 'aria-current': current ? 'step' : null, 'data-pf-step': s.id };
    if (s.id === 'explore') return el('li', { class: 'pf-li' }, el('a', { ...attrs, href: href(pfExplore),
      onclick: (e) => { if (!pfPlain(e)) return; e.preventDefault(); navigate(pfExplore); } }, s.label));
    return el('li', { class: 'pf-li' }, el('button', { ...attrs, type: 'button',
      onclick: () => {
        if (toModels) { navigate('/property/models'); return; }
        /* On the Lab itself: the comparison, or its Save, where they are —
           and, with nothing to save there, the saved properties. */
        if (onLab) {
          if (s.id === 'analyse') { const t = document.getElementById('lab-root'); if (t) lsGoTo(t.closest('.lab-page') || t); return; }
          if (labGoTo(s.id === 'compare' ? 'compare' : 'save')) return;
          if (save) { navigate('/property/models'); return; }
        }
        pfToLab(ctx, s.id === 'compare' ? 'compare' : save ? 'save' : null);
      } }, s.label));
  };
  const kids = [el('ol', { class: 'pf-steps' }, PF_STEPS.map(step))];
  /* The work, on any Property page but the Lab's own — on the calculator
     and My properties only while it holds moves not saved. */
  if (ctx && !onLab && (here === 'explore' || unsaved)) {
    kids.push(el('div', { class: `pf-ctx${unsaved ? ' is-unsaved' : ''}`, id: 'pf-ctx' }, [
      el('p', { class: 'pf-ctx-text' }, [
        el('span', { class: 'pf-ctx-what' }, ['In the Scenario Lab: ', el('strong', {}, ctx.name), ctx.other ? `, sliders on ${ctx.other}` : '', '.']), ' ',
        el('span', { class: 'pf-ctx-state', id: 'pf-unsaved', 'data-unsaved': String(unsaved) },
          unsaved ? `${unsaved} move${unsaved === 1 ? '' : 's'} not saved — kept in this tab until you save; lost on reload or close.` : 'Nothing there is unsaved.')]),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm pf-resume', id: 'pf-resume', onclick: () => pfToLab(ctx) },
        ['Resume in the Lab', el('span', { 'aria-hidden': 'true' }, ' →')]),
    ]));
  }
  return el('nav', { class: 'pf-flow', 'aria-label': 'Property: explore, analyse, compare, save', 'data-pf-view': view, 'data-pf-here': here }, kids);
}

/* THE BROWSER'S OWN PROMPT, where the work would be lost: a reload, a closed
   tab, another site — never a move between this site's pages, which keeps
   it. Only while the Lab holds moves not saved. */
addEventListener('beforeunload', (e) => {
  if (labUnsavedAll() > 0) { e.preventDefault(); e.returnValue = ''; }
});
