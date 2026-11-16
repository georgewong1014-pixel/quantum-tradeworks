/* ==========================================================================
   THE PROPERTY FLOW — EXPLORE → ANALYSE → EVIDENCE → COMPARE → SAVE (the
   11 Oct 2026 daily audit, #8, owner-approved 12 Oct 2026; the journey bar,
   the 13 Oct 2026 audit, #7, owner's choice 13 Oct 2026)
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
     Analyse   the Scenario Lab — on the work it holds
     Evidence  the calculator: where a property's figures become the
               reader's (see WHERE EVIDENCE LANDS)
     Compare   the Lab's comparison: across routes and assets (P6) where the
               columns are of more than one property, else A, B and C
     Save      the Lab's Save while it holds what-ifs not saved; else
               My properties, where what is saved is listed
   the step of the page on screen marked (aria-current="step").

   WHERE EVIDENCE LANDS (decided 13 Oct 2026). Evidence is where the active
   property's figures are entered, graded or named, and its page is the
   calculator: the step is marked there, and pressed from any page it goes
   to the property's evidence —
     - the calculator's own deal (the sample, an unsaved deal, a saved
       property open there), or the Lab's work on it: the calculator, at its
       review of the figures still the sample's ("N sample inputs need your
       evidence", opened, its first "Go to it" next), or — every figure the
       reader's — at Evidence quality, where each driving figure's source is
       graded;
     - a register record the Lab's sliders move (not saved as a property):
       the record's card in the opportunity register, at its source line —
       the record's evidence is where it was found and the date that is from;
     - another saved property the sliders move, not open on the calculator
       (or the sample beside the reader's own): My properties, at its Open —
       the calculator edits it once opened, and nothing is opened (or
       written) by the step itself.
   The landing is pfLand, read once the page it goes to is drawn.

   THE CONTEXT LINE, under the steps on every Property page — one line at
   1440, wrapping between its parts on a phone. Which property it is, how it
   is being bought and what it is (pqSummaryText, the route questions' own
   summary), its evidence as a count — the figures still the sample's, out
   of those the review queue holds for its class (propertyReviewQueue, the
   calculator's "Review N sample inputs"), never a figure — and what is not
   saved, with Resume in the Lab or Save where either applies:
     - on the calculator: its deal, and the Lab's moves not saved while the
       Lab holds any;
     - on the explore pages and My properties: the Lab's work where this tab
       has opened the Lab — the column the sliders move — else the
       calculator's deal (the sample deal on a first visit, as served);
     - on the Lab: the evidence and the moves only — its identity line
       names the property and, on a phone, how it is bought; its questions
       stand above the tiles from 640px. From 640px the line stands under
       the steps (from 1440 at the top right with them), and the line above
       the sliders that said what a move becomes says nothing there; under
       640px, where the action bar carries the steps, that line beside the
       sliders carries the same words (labPaintPanel). The Lab's words
       before its first slider are counted (mobile.mjs, lab-words): the
       line takes the place of that sentence, word for word.
   The figures the count reads are the property's as kept, never a what-if:
   a move in the Lab marks nothing as the reader's (labNext does, on Save).

   NOTHING IS WRITTEN BEFORE SAVE (the owner's rule). The work is the Lab's
   own state in this tab's memory (LAB, 82-property-lab.js) — no store key,
   no session storage, no address of moves — so it lasts as long as the
   tab, and the reader is told so where it could be lost:
     - here, "N moves not saved — lost on reload or close";
     - by the browser's own prompt when the tab is reloaded, closed or left
       for another site with moves not saved (beforeunload);
     - before a register record replaces a column holding moves
       (labAddOpportunity's confirm).
   Nothing is ranked and no figure is shown here: the flow names steps, a
   property and counts, never a result.

   ON A PHONE (under 640px) the Lab and the calculator carry Analyse ·
   Compare · Save in their action bar — the layout system — so the line of
   steps stands on the other Property pages only, as one line of 44px chips;
   the calculator keeps its context line. Every rule is the window's
   (styles.css, property-flow): the page served before the script is the
   page drawn.

   ONE NAVIGATION, ONE PROGRESS INDICATOR (the owner's decision, 16 Nov
   2026: "The tab row remains the primary navigation. Convert the five-step
   strip into a compact progress indicator showing: You are here — current
   stage; Next — recommended action; Progress — completed steps"). The five
   steps are drawn as a progress track, not a second row of tabs:
     - the step of the page on screen reads "You are here: …";
     - each step whose outcome the site can see is ticked, and the track
       ends in a count, "N of 5 done" (pfDoneOf says what "done" is, each
       from state the site holds — never a judgement of the property);
     - the context line carries one recommended action, "Next" (pfNextOf):
       Resume in the Lab while it holds moves not saved, else the first of
       Evidence, Compare and Save not yet done; and, once saved, "Export a
       backup" while the work is in no backup file. It does what that step
       does — it presses it.
   Nothing a step did is removed: each still answers a press, so the
   Evidence landing, the Lab's comparison and its Save are reached as
   before. The Lab keeps its own numbered stages 1-2-3 as its next action
   and carries no "Next" in its line. Under 640px the track is the same
   line of 44px chips, ticked, and "Next" is not drawn (the Lab and the
   calculator carry Analyse · Compare · Save in their bar there).
   ========================================================================== */
const PF_STEPS = [
  { id: 'explore', label: 'Explore' },
  { id: 'analyse', label: 'Analyse' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'compare', label: 'Compare' },
  { id: 'save', label: 'Save' },
];
const PF_STEP_OF = { areas: 'explore', areaMap: 'explore', comparables: 'explore', opportunities: 'explore', propertyLab: 'analyse', property: 'analyse', propertyModels: 'save' };
/* THE STEP THE CALCULATOR MARKS (the owner, 16 Nov 2026: "ensure the
   highlighted stage matches the activity being performed"). It marked
   Evidence always, over a reader typing a price into the Quick model. It
   marks Analyse, as the Lab does, and Evidence only where the reader asked
   for the evidence: the Evidence step pressed, here or from another page,
   which lands on the review of the figures still the sample's. Analyse
   pressed here, or the page left, ends that. */
let pfAtEvidence = false;
function pfHereOf(view) {
  if (view !== 'property') { pfAtEvidence = false; return PF_STEP_OF[view]; }
  if (State.pfLand && State.pfLand.kind === 'calc') pfAtEvidence = true;
  return pfAtEvidence ? 'evidence' : 'analyse';
}
/* The mark moved in place, where the step pressed is on the page it acts on
   and nothing is redrawn. */
function pfMark(id) {
  const flow = document.querySelector('#views .pf-flow');
  if (!flow) return;
  flow.dataset.pfHere = id;
  flow.querySelectorAll('.pf-step').forEach(n => {
    const on = n.dataset.pfStep === id;
    n.classList.toggle('is-here', on);
    if (on) n.setAttribute('aria-current', 'step'); else n.removeAttribute('aria-current');
  });
}
/* WHAT "DONE" IS, step by step, for the property the line names — each a
   fact the site holds, said in the step's title:
     Explore   an explore page was opened on this visit (this tab's memory),
               and the reader has moved on from it;
     Analyse   at least one of the figures the review counts is the
               reader's (or the record's), not the sample's;
     Evidence  none of them is the sample's any longer;
     Compare   the Lab's comparison was opened on this visit (labGoTo);
     Save      it is saved as a property, with no change and no move in the
               Lab left unsaved.
   Nothing here reads a result: no figure makes a step done. */
let pfExplored = false, pfCompared = false;
const PF_DONE_MEANS = {
  explore: 'an explore page opened on this visit',
  analyse: 'at least one figure is yours, not the sample’s',
  evidence: 'no sample figure left to review',
  compare: 'the comparison opened on this visit',
  save: 'saved as a property, with nothing unsaved',
};
function pfSavedBase(k) {
  if (!k) return false;
  if (k.kind === 'saved') return true;
  if (k.kind !== 'calc') return false;
  const st = propertyStatus(State.deal);
  return st.kind === 'model' && !st.dirty;
}
function pfDoneOf(view, { ev = null, moves = 0, savedBase = false } = {}) {
  return {
    explore: pfExplored && PF_STEP_OF[view] !== 'explore',
    analyse: !!ev && ev.n < ev.of,
    evidence: !!ev && ev.n === 0,
    compare: pfCompared,
    save: savedBase && !moves,
  };
}
const pfDoneCount = (done) => PF_STEPS.filter(s => done[s.id]).length;
const pfDoneWords = (done) => `${pfDoneCount(done)} of ${PF_STEPS.length} done`;
const pfDoneNames = (done) => PF_STEPS.filter(s => done[s.id]).map(s => s.label).join(', ');
const pfStepTitle = (s, done) => `${s.label} — ${done[s.id] ? 'done' : 'not done yet'}: ${PF_DONE_MEANS[s.id]}`;
/* THE ONE RECOMMENDED ACTION for a page's line (null on the Lab, whose
   numbered stages are its own): the step it presses, and its words. No
   figure in them — the line carries a count and never one (served-check). */
function pfNextOf(view, line, done) {
  if (!line || line.where === 'lab') return null;
  if (line.resume) return { id: 'resume' };
  if (!done.evidence) {
    const t = pfEvidenceTarget(view);
    return { id: 'evidence', label: t.kind === 'record' ? 'Check the record’s source' : t.kind === 'saved' ? 'Open the saved property' : 'Review the sample figures' };
  }
  if (!done.compare) return { id: 'compare', label: 'Compare scenarios' };
  if (!done.save) return { id: 'save', label: 'Save this property' };
  /* Saved, and in no backup file yet: the work is in this browser alone
     (the owner, 16 Nov 2026: users "retain/export their work"). The export
     is on Your data & settings; this goes there. */
  if (typeof backupPrompt === 'function' && backupPrompt()) return { id: 'backup', label: 'Export a backup' };
  return { id: 'none' };
}
/* Next does what its step does: it presses it. Save on the calculator is
   the calculator's own Save, in sight and given the keyboard. */
function pfNextGo(view, id) {
  if (id === 'backup') { navigate('/my/data'); return; }
  if (id === 'save' && view === 'property') {
    const b = document.getElementById('wb-property-save');
    if (b && b.getClientRects().length) { lsGoTo(b.closest('.pm-bar') || b, b); return; }
  }
  document.getElementById(`pf-${id}`)?.click();
}
/* THE TRACK, WRITTEN IN PLACE where the page is not redrawn (the Lab's
   paint; the comparison opened): each tick, each title and the count, only
   where it differs. */
function pfProgressPaint(done) {
  const flow = document.querySelector('#views .pf-flow');
  if (!flow) return;
  PF_STEPS.forEach(s => {
    const n = document.getElementById(`pf-${s.id}`);
    if (!n) return;
    const on = !!done[s.id];
    if (n.classList.contains('is-done') !== on) { n.classList.toggle('is-done', on); n.title = pfStepTitle(s, done); }
  });
  const c = document.getElementById('pf-count');
  if (c && c.dataset.done !== String(pfDoneCount(done))) {
    c.dataset.done = String(pfDoneCount(done));
    c.replaceChildren(...pfCountKids(done));
  }
}
const pfCountKids = (done) => [pfDoneWords(done), pfDoneCount(done) ? el('span', { class: 'sr-only' }, `: ${pfDoneNames(done)}`) : null].filter(Boolean);
/* The comparison opened (labGoTo, 82-property-lab.js): Compare is done for
   this visit, and the track on screen says so. */
function pfComparedNow() {
  if (pfCompared) return;
  pfCompared = true;
  const flow = document.querySelector('#views .pf-flow');
  if (!flow) return;
  const done = {};
  PF_STEPS.forEach(s => { done[s.id] = !!document.getElementById(`pf-${s.id}`)?.classList.contains('is-done'); });
  done.compare = true;
  pfProgressPaint(done);
}
const PF_EXPLORE_PATH = { areas: '/property/areas', areaMap: '/property/areas/map', comparables: '/property/comparables', opportunities: '/property/opportunities' };
/* The explore page last visited, this tab: where Explore goes back to.
   Before one is visited, the Area screen: the one explore page with
   something to look at on a first visit — Kuching's localities and the
   scheme map — where the register opened empty (the Day-10 pre-audit,
   NAV-06). */
let pfExplore = '/property/areas';

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
  return { lab, name, other: act?.prop ? `${act.key} — ${act.name}` : null, moves: labUnsavedOf(lab), path: `/property${q ? `?${q}` : '?'}` };
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
  navigate(ctx ? ctx.path : '/property?');
}
/* "Use it in the Scenario Lab" and the like from another Property page: the
   work the Lab holds, where it holds one; else /property, as before. */
function pfResumeLab() {
  const ctx = pfContext();
  if (ctx) pfToLab(ctx); else navigate('/property');
}

/* ------------------------------------------------------------ the property */
/* THE FIGURES OF THE PROPERTY A COLUMN IS OF, AS THEY ARE KEPT — never a
   what-if: the calculator's deal where it holds that property (its figures
   as entered there), a saved property as saved, a register record as
   recorded (oppDeal), the sample as the tool has it. `kind` says which. */
function pfKept(lab, col) {
  const p = col?.prop || null;
  if (p && p.startsWith('opp:')) { const o = oppById(p.slice(4)); return o ? { d: oppDeal(o), kind: 'record', opp: o } : null; }
  if (p === 'sample') return { d: pmSampleDeal(), kind: 'sample' };
  const id = p ? p.slice(3) : lab?.model || null;
  if (!id || State.deal?.modelId === id) return { d: pmBare(State.deal), kind: 'calc' };
  const rec = pmFind(id);
  return rec ? { d: pmInputsOf(rec), kind: 'saved', rec } : null;
}
/* HOW MUCH OF IT IS STILL THE SAMPLE'S, AS A COUNT: the figures the review
   queue holds (propertyReviewQueue, 70-property.js — the calculator's
   "Review N sample inputs"), out of those it holds for the class. A record
   states only what it states; the rest stand in from the calculator. */
function pfEvidenceOf(k) {
  if (!k?.d) return null;
  const n = propertyReviewQueue(k.d).length;
  const of = PROPERTY_REVIEW.filter(f => propertyInputApplies(k.d, f.k)).length;
  const words = k.kind === 'record' ? `Figures not in the record: ${n} of ${of}`
    : n ? `Sample figures: ${n} of ${of}` : 'Every figure yours';
  return { n, of, words };
}
/* What a move becomes, in the Lab's words: each column holding moves, or
   none (the line above the sliders said it so from the first drawing). */
function pfLabMovesWords(lab) {
  const withMoves = lab.cols.filter(c => labMoveCount(c));
  if (!withMoves.length) return { n: 0, words: 'No unsaved moves' };
  return { n: withMoves.reduce((s, c) => s + labMoveCount(c), 0),
    words: `${withMoves.map((c, i) => `${c.key} has ${labMoveCount(c)}${i === 0 ? ` move${labMoveCount(c) === 1 ? '' : 's'}` : ''}`).join(' and ')} not saved — lost on reload or close` };
}
const pfMovesWords = (n) => (n ? `${n} move${n === 1 ? '' : 's'} not saved — lost on reload or close` : 'No unsaved moves');
/* THE LINE'S PARTS FOR A PAGE: { where, what, route, ev, moves, resume }.
   `where` is whose property it names: 'calc' (the calculator's deal),
   'work' (the Lab's work, from another page) or 'lab' (the Lab itself,
   which names neither the property nor the route: its identity line does). */
function pfLineOf(view) {
  const ctx = pfContext();
  if (view === 'propertyLab') {
    const lab = ctx?.lab || (labSubject && LAB[labSubject]) || null;
    if (!lab) return null;
    const col = labActive(lab);
    const mv = pfLabMovesWords(lab);
    const k = pfKept(lab, col);
    return { where: 'lab', k, ev: pfEvidenceOf(k), moves: mv.n, movesWords: mv.words };
  }
  if (view !== 'property' && ctx) {
    const col = labActive(ctx.lab), k = pfKept(ctx.lab, col);
    /* How it is bought and what it is: the column's, its answers given in
       the Lab with it (a what-if, said as one by the moves beside it). */
    const asked = k ? { ...k.d, ...(col.inherited || {}), ...col.moves } : col.work;
    return { where: 'work', k, what: ['In the Lab: ', el('strong', { class: 'pf-name' }, ctx.name), ...(ctx.other ? [', sliders on ', el('span', { class: 'pf-name' }, ctx.other)] : [])],
      title: `${ctx.name}${ctx.other ? `, sliders on ${ctx.other}` : ''}`, route: pqSummaryText(asked), ev: pfEvidenceOf(k),
      moves: ctx.moves, movesWords: pfMovesWords(ctx.moves), resume: ctx };
  }
  /* The calculator's deal: the sample deal on a first visit. */
  const st = propertyStatus(State.deal);
  const name = st.kind === 'model' ? `“${st.rec.name}”${st.sc ? ` — ${st.sc.name}` : ''}` : st.kind === 'sample' ? 'The sample deal' : 'The deal on the calculator';
  const line = { where: 'calc', k: { d: State.deal, kind: 'calc' }, what: [el('strong', { class: 'pf-name' }, name)], title: name,
    route: pqSummaryText(State.deal), ev: pfEvidenceOf({ d: State.deal, kind: 'calc' }) };
  /* The Lab's moves not saved, from the calculator: said while there are any. */
  if (ctx && ctx.moves) Object.assign(line, { moves: ctx.moves, movesWords: `In the Lab: ${pfMovesWords(ctx.moves)}`, resume: ctx });
  return line;
}

/* ----------------------------------------------------------- the evidence */
/* WHERE THE EVIDENCE STEP GOES from a page (WHERE EVIDENCE LANDS, above):
   the property the page's line names. */
function pfEvidenceTarget(view) {
  const ctx = view === 'property' ? null : pfContext();
  if (!ctx) return { kind: 'calc' };
  const k = pfKept(ctx.lab, labActive(ctx.lab));
  if (k?.kind === 'record') return { kind: 'record', id: k.opp.id };
  if (k?.kind === 'saved') return { kind: 'saved', id: k.rec.id };
  /* The sample beside the reader's own (P6): My properties opens it. */
  if (k?.kind === 'sample') return { kind: 'saved', id: 'sample' };
  return { kind: 'calc' };
}
const PF_LAND_PATH = { calc: '/property/calculator', record: '/property/opportunities', saved: '/property/models' };
function pfEvidenceGo(view) {
  const t = pfEvidenceTarget(view);
  State.pfLand = t;
  if (view === { calc: 'property', record: 'opportunities', saved: 'propertyModels' }[t.kind]) {
    if (t.kind === 'calc') { pfAtEvidence = true; pfMark('evidence'); }
    pfLand(); return;
  }
  navigate(PF_LAND_PATH[t.kind]);
}
/* THE LANDING, once the page it goes to is drawn: the review of the sample
   figures opened and its summary given the keyboard (as the dock's "Review
   N sample inputs" does); Evidence quality where none is left; a record's
   source line; a saved property's Open. */
function pfLand() {
  const t = State.pfLand;
  State.pfLand = null;
  if (!t) return false;
  if (t.kind === 'calc') {
    const det = document.getElementById('pc-review-list');
    if (det) { det.open = true; lsGoTo(det.closest('#review') || det, det.querySelector(':scope > summary')); return true; }
    const sel = document.getElementById('ev-price');
    if (sel) { pcShowFor(sel); lsGoTo(sel.closest('.assumption') || sel, sel); return true; }
    return false;
  }
  if (t.kind === 'record') {
    const card = document.querySelector(`#views [data-opp="${CSS.escape(t.id)}"]`);
    if (card) { lsGoTo(card, card.querySelector('.opp-prov') || card); return true; }
    return false;
  }
  const open = document.getElementById(`pm-open-${t.id}`);
  if (open) { lsGoTo(open.closest('.pm-row') || open, open); return true; }
  return false;
}

/* ---------------------------------------------------------------- the line */
const pfPlain = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button);
const pfSep = () => el('span', { class: 'pf-sep', 'aria-hidden': 'true' }, ' · ');
/* The context line itself, for a page's parts (pfLineOf). Every part has
   its id, so the Lab's paint writes the two that change there in place. */
function pfLineNode(line, next = null, view = State.view) {
  const parts = [];
  if (line.what) parts.push(el('span', { class: 'pf-seg pf-ctx-what', id: 'pf-ctx-what', title: line.title || null }, line.what));
  if (line.route) parts.push(el('span', { class: 'pf-seg pf-ctx-route', id: 'pf-ctx-route' }, line.route));
  if (line.ev) parts.push(el('span', { class: 'pf-seg pf-ctx-ev', id: 'pf-ctx-ev', 'data-sample': String(line.ev.n), 'data-of': String(line.ev.of) }, line.ev.words));
  if (line.movesWords) parts.push(el('span', { class: 'pf-seg pf-ctx-state', id: 'pf-unsaved', 'data-unsaved': String(line.moves || 0) }, line.movesWords));
  const text = el('p', { class: 'pf-ctx-text' }, parts.flatMap((p, i) => (i ? [pfSep(), p] : [p])));
  const resume = line.resume
    ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm pf-resume', id: 'pf-resume', onclick: () => pfToLab(line.resume) },
      ['Resume in the Lab', el('span', { 'aria-hidden': 'true' }, ' →')])
    : null;
  /* "Next": the one recommended action, where the Lab's Save is not the
     line's action (pfNextOf). */
  const nextKid = !next ? null : next.id === 'resume' ? resume
    : next.id === 'none' ? el('span', { class: 'pf-next-none', id: 'pf-next-none' }, 'Nothing outstanding')
    : el('button', { type: 'button', class: 'pf-next-btn', id: 'pf-next', 'data-pf-next': next.id, onclick: () => pfNextGo(view, next.id) },
      [next.label, el('span', { 'aria-hidden': 'true' }, ' →')]);
  const act = nextKid ? el('span', { class: 'pf-next' }, [el('span', { class: 'pf-k' }, 'Next'), ' ', nextKid])
    : resume || (line.where === 'lab' ? pfSaveButton(line.moves) : null);
  return el('div', { class: `pf-ctx${line.moves ? ' is-unsaved' : ''}`, id: 'pf-ctx', 'data-pf-ctx': line.where }, [text, act]);
}
/* On the Lab, Save with its moves: the identity line's Save, in sight and
   given the keyboard (labGoTo) — or what the phone's bar would save. Out of
   sight and out of reach while nothing is moved, so the line keeps its
   height at the first move. */
function pfSaveButton(moves) {
  return el('button', { type: 'button', class: 'pf-ctx-save', id: 'pf-ctx-save', hidden: moves ? null : '',
    onclick: () => { if (!labGoTo('save')) labBarSave().run?.(); } }, 'Save');
}
/* THE LAB'S LINE, AT A PAINT (labPaintPanel): the moves at every frame of
   a drag, the evidence (`ev`, read at a drawing: pfLabEvidence) as it was
   read — each written only where it differs. */
function pfLabEvidence(lab) { return pfEvidenceOf(pfKept(lab, labActive(lab))); }
function pfLabPaint(lab, ev) {
  const box = document.getElementById('pf-ctx');
  if (!box || box.dataset.pfCtx !== 'lab') return;
  const mv = pfLabMovesWords(lab);
  const evN = document.getElementById('pf-ctx-ev'), st = document.getElementById('pf-unsaved'), save = document.getElementById('pf-ctx-save');
  if (evN && ev) { labText(evN, ev.words); labAttr(evN, 'data-sample', ev.n); labAttr(evN, 'data-of', ev.of); }
  if (st) { labText(st, mv.words); labAttr(st, 'data-unsaved', mv.n); }
  if (save && save.hidden !== !mv.n) save.hidden = !mv.n;
  labClass(box, 'is-unsaved', mv.n > 0);
  /* The track: its ticks and its count as the moves and the evidence stand
     (whether the property is saved was read at the drawing: data-pf-saved). */
  const flow = box.closest('.pf-flow');
  if (flow && ev) pfProgressPaint(pfDoneOf('propertyLab', { ev, moves: mv.n, savedBase: flow.dataset.pfSaved === '1' }));
}
/* The words the Lab's line beside its sliders carries on a phone. */
function pfLabWords(lab, ev) { return `${ev ? `${ev.words} · ` : ''}${pfLabMovesWords(lab).words}.`; }

/* THE LINE OF STEPS AND THE CONTEXT LINE, drawn above every Property page
   (drawPage, 35-ui.js). */
function propertyFlowNode(view = State.view) {
  const here = pfHereOf(view);
  if (!here) return null;
  if (here === 'explore') { pfExplore = PF_EXPLORE_PATH[view]; pfExplored = true; }
  const ctx = pfContext();
  const line = pfLineOf(view);
  const savedBase = pfSavedBase(line?.k);
  const done = pfDoneOf(view, { ev: line?.ev, moves: line?.moves || 0, savedBase });
  const onLab = view === 'propertyLab';
  const unsaved = ctx ? ctx.moves : 0;
  /* Explore is a page — a link. Analyse, Evidence, Compare and Save act on
     the work this tab holds (the Lab's columns, moves and answers, in its
     memory): a link to them would open a new tab without it, so each is a
     button, and the line is no second strip of the tab row's links. */
  const step = (s) => {
    const save = s.id === 'save', toModels = save && !unsaved && !onLab;
    const current = s.id === here;
    const attrs = { class: `pf-step${current ? ' is-here' : ''}${done[s.id] ? ' is-done' : ''}`, id: `pf-${s.id}`, 'aria-current': current ? 'step' : null, 'data-pf-step': s.id, title: pfStepTitle(s, done) };
    if (s.id === 'explore') return el('li', { class: 'pf-li' }, el('a', { ...attrs, href: href(pfExplore),
      onclick: (e) => { if (!pfPlain(e)) return; e.preventDefault(); navigate(pfExplore); } }, s.label));
    return el('li', { class: 'pf-li' }, el('button', { ...attrs, type: 'button',
      onclick: () => {
        if (s.id === 'evidence') { pfEvidenceGo(view); return; }
        /* On the calculator, Analyse is the model on this page: back to its
           first figure from the evidence, never away to the Lab (Compare
           and the tab row go there). */
        if (s.id === 'analyse' && view === 'property') {
          pfAtEvidence = false; pfMark('analyse');
          const t = document.getElementById('pc-quick') || document.querySelector('#views .pc-page');
          if (t) lsGoTo(t);
          return;
        }
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
  /* The count is not drawn on the Lab: the Lab's words before its first
     figure are budgeted (mobile.mjs, lab-words: 184 at 1440), and its ticks
     and its own numbered stages already say how far the work has got. */
  const kids = [el('ol', { class: 'pf-steps' }, [...PF_STEPS.map(step),
    onLab ? null : el('li', { class: 'pf-li pf-count', id: 'pf-count', 'data-done': String(pfDoneCount(done)) }, pfCountKids(done))])];
  if (line) kids.push(pfLineNode(line, pfNextOf(view, line, done), view));
  /* Where the Evidence step was pressed from another page: its landing,
     once this page is drawn. */
  if (State.pfLand && view === { calc: 'property', record: 'opportunities', saved: 'propertyModels' }[State.pfLand.kind]) setTimeout(pfLand, 0);
  return el('nav', { class: 'pf-flow', 'aria-label': 'Property progress: explore, analyse, evidence, compare, save', 'data-pf-view': view, 'data-pf-here': here, 'data-pf-saved': savedBase ? '1' : '0' }, kids);
}

/* THE BROWSER'S OWN PROMPT, where the work would be lost: a reload, a closed
   tab, another site — never a move between this site's pages, which keeps
   it. Only while the Lab holds moves not saved. */
addEventListener('beforeunload', (e) => {
  if (labUnsavedAll() > 0) { e.preventDefault(); e.returnValue = ''; }
});
