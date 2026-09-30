/* ==========================================================================
   MY PROPERTIES — ONE STORE FOR EVERY PROPERTY A READER SAVES
   --------------------------------------------------------------------------
   Four things each held part of "the property I am working on", and none of
   them knew about the others: the calculator's deal (one, overwritten by the
   next), the work bar's snapshots of it ("Save this deal", listed again as
   tool snapshots in Saved Models, each a frozen copy that nothing could
   edit), the deal a shared link or the launcher put aside ("Restore my
   previous deal"), and an opportunity opened in the calculator, which laid
   its figures over whatever deal was there and kept nothing. A second
   property meant retyping the first to get back to it, and there was no
   list of the properties a reader had.

   So a saved property is now a model the calculator edits, in ONE store.
   The store is the saved-work list the snapshots already lived in
   (15-derivation.js), because that list is already what the export, a
   backup, Your data, Saved Models and the dashboard read, and what the
   privacy page names: a property saved here is carried and listed by every
   one of them without a second list to fall out of step with the first. A
   property record is the snapshot's record, grown:

     { id, kind: 'property', name, createdAt, updatedAt,
       payload: { deal },   ← the inputs: the calculator's whole deal — price,
                              deposit, financing, rent, vacancy, expenses,
                              district, evidence, checklist — under the name
                              the saved-work store has always given them
       scenarios: [{ id, name, overrides, createdAt, updatedAt }],
       source?: { kind: 'opportunity', id, name },
       savedAt, modelVersion, asOf, editor, stamp }   ← as saved work carries

   The calculator's deal (State.deal, the `deal` key) is the working copy of
   the ACTIVE property: `modelId` names which one, `scenarioId` which of its
   scenarios is open. Every property tool — financing, returns, sensitivity,
   the tests, the grade, the decision record, the report — reads that one
   deal, so a figure is typed once. It is written as it is edited, so a
   reload keeps it; the property is changed by "Save this property", so a
   change can be tried, compared as a scenario, or discarded, and the page
   says which state it is in ("Editing: <name> · saved <time>" or "Unsaved
   changes").

   A scenario is the property with some inputs changed. It stores only what
   differs from the property as saved (its overrides); everything else
   follows the property, so a scenario saved on a rent of 2,000 still has
   the price the property has today.

   WHAT IS NOT MOVED. The deal kept aside by a shared link or the launcher
   stays where they put it (55-views-public.js writes it), and "Restore my
   previous deal" still puts it back — now as the property it belonged to,
   because it carries its `modelId`. Work that exists nowhere else is never
   replaced without being kept aside the same way (propertySetAside).
   ========================================================================== */

/* The two fields that say which property the deal on the calculator is a
   copy of. They are never part of a property's inputs, never in a shared
   link (SHARE_KEYS is the default deal's own fields), and never compared. */
const PM_POINTERS = ['modelId', 'scenarioId'];
const pmInputsOf = (rec) => (rec && isRecord(rec.payload?.deal) ? rec.payload.deal : null);
/* A snapshot saved by the old storage-reading save before anything was
   entered holds no deal at all. It is left as it is — Saved Models still
   lists it and says it holds nothing to restore — and is not a property. */
const pmIsProperty = (rec) => rec?.kind === 'property' && !!pmInputsOf(rec);
const pmCopy = (v) => JSON.parse(JSON.stringify(v));
const pmBare = (d) => { const o = { ...(d || {}) }; PM_POINTERS.forEach(k => delete o[k]); return o; };
/* JSON with its keys in order, so two deals that hold the same inputs compare
   equal however their keys were added. */
function pmCanon(v) {
  if (Array.isArray(v)) return `[${v.map(pmCanon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort()
    .map(k => `${JSON.stringify(k)}:${pmCanon(v[k])}`).join(',')}}`;
  return v === undefined ? 'null' : JSON.stringify(v);
}
const pmSame = (a, b) => pmCanon(pmBare(a)) === pmCanon(pmBare(b));
/* The inputs as the calculator holds them once loaded: a whole-year hold and
   a district on the city's own list (normHoldYears, dealDistrict — the rules
   70-property.js applies to the deal it boots with). A property is stored so,
   or it would open already "changed". */
function pmNormalInputs(d) {
  const x = pmBare(pmCopy(d));
  x.holdYears = normHoldYears(x.holdYears);
  x.district = dealDistrict(x.city, x.district);
  return x;
}
/* A scenario's inputs: the property's, with what the scenario changes. A
   figure is replaced; a record of figures — the evidence grades, which
   figures were entered, the checklist — is changed key by key, so a grade
   the scenario did not touch follows the property. */
function pmMerge(base, overrides) {
  const out = pmCopy(base);
  for (const [k, v] of Object.entries(overrides || {})) {
    if (PM_POINTERS.includes(k)) continue;
    out[k] = isRecord(v) && isRecord(out[k]) ? { ...out[k], ...pmCopy(v) } : pmCopy(v);
  }
  return out;
}
/* What a deal changes against its property: the overrides pmMerge undoes. */
function pmDiff(work, base) {
  const w = pmBare(work), b = pmBare(base), ov = {};
  for (const k of Object.keys(w)) {
    if (pmCanon(w[k]) === pmCanon(b[k])) continue;
    if (isRecord(w[k]) && isRecord(b[k])) {
      const sub = {};
      for (const sk of Object.keys(w[k])) if (pmCanon(w[k][sk]) !== pmCanon(b[k][sk])) sub[sk] = pmCopy(w[k][sk]);
      if (Object.keys(sub).length) ov[k] = sub;
    } else ov[k] = pmCopy(w[k]);
  }
  return ov;
}

const pmAll = () => loadWork().filter(pmIsProperty);
const pmFind = (id) => (id ? pmAll().find(r => r.id === id) || null : null);
const pmScenario = (rec, id) => (rec && id ? (rec.scenarios || []).find(s => s.id === id) || null : null);
/* The inputs a property or one of its scenarios holds as saved. */
const pmSavedInputs = (rec, sc) => (sc ? pmMerge(pmInputsOf(rec), sc.overrides) : pmInputsOf(rec));

/* Stored as the saved-work store stamps a record: savedAt in its UTC
   minute, which Saved Models, Your data and the dashboard read, beside the
   ISO time this module reads. */
const pmSavedAtOf = (iso) => String(iso).replace('T', ' ').slice(0, 16);
const pmIsoOfSavedAt = (v) => (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(String(v || '')) ? `${String(v).replace(' ', 'T')}:00.000Z` : null);
function pmStampRecord(rec, at) {
  rec.updatedAt = at;
  rec.savedAt = pmSavedAtOf(at);
  rec.modelVersion = MODEL_VERSION;
  rec.asOf = AS_OF;
  rec.editor = 'this browser';
  rec.stamp = buildStamp('property');
}
/* When a property last changed. A record saved since this page loaded by
   the saved-work store's own save carries only its stamp and its UTC minute
   until the next load gives it the rest (migratePropertyStore). */
const pmUpdated = (rec) => rec?.updatedAt || rec?.stamp?.savedAt || pmIsoOfSavedAt(rec?.savedAt) || null;
/* When, on the reader's clock: "today at 14:32", or the date and time. */
function pmWhen(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || !Number.isFinite(t.getTime())) return 'date not recorded';
  const hm = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return localDay(t) === localDay() ? `today at ${hm}`
    : `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${hm}`;
}

/* --------------------------------------------------------------- migration */
/* WHAT WAS SAVED BEFORE THIS STORE IS THE STORE.
   A snapshot the work bar saved ("Save this deal"), listed as a tool
   snapshot in Saved Models, becomes a property: it gains its created and
   updated times — from its stamp, else its UTC save minute — and an empty
   list of scenarios, and its inputs are held as the calculator loads them.
   Nothing it held is dropped. The deal in progress and the deal kept aside
   before a shared link are not turned into properties nobody asked for:
   each is attached to the property it is an unchanged copy of, if there is
   one, and otherwise stays what it was — the calculator's unsaved deal,
   listed on My properties with Save, and the kept deal "Restore my previous
   deal" puts back. Run on every load, and changes nothing the second time:
   each step writes only what is absent. */
function migratePropertyStore() {
  const list = loadWork();
  let changed = false;
  for (const rec of list) {
    if (!pmIsProperty(rec)) continue;
    const before = pmCanon(rec);
    if (!('createdAt' in rec)) rec.createdAt = rec.stamp?.savedAt || pmIsoOfSavedAt(rec.savedAt) || null;
    if (!('updatedAt' in rec)) rec.updatedAt = rec.createdAt;
    if (!Array.isArray(rec.scenarios)) rec.scenarios = [];
    rec.scenarios = rec.scenarios.filter(s => isRecord(s) && s.id && isRecord(s.overrides));
    rec.payload = { ...rec.payload, deal: pmNormalInputs(rec.payload.deal) };
    if (pmCanon(rec) !== before) changed = true;
  }
  if (changed) persistWork(list);
  const props = list.filter(pmIsProperty);
  /* Newest first, as saveWork writes them: a copy of a deal saved twice is
     the later one. */
  const attach = (d) => {
    if (!isRecord(d) || 'modelId' in d) return false;
    const hit = props.find(r => pmSame(pmNormalInputs(d), pmInputsOf(r)));
    d.modelId = hit ? hit.id : null;
    d.scenarioId = null;
    return true;
  };
  /* Written only where it was stored: a first visit's default deal is not
     put into storage by being looked at. */
  const storedDeal = store.read('deal', null);
  if (attach(State.deal) && storedDeal) store.write('deal', State.deal);
  const kept = store.read('dealBeforeLink', null);
  if (attach(kept)) store.write('dealBeforeLink', kept);
}
migratePropertyStore();

/* ------------------------------------------------------------------ status */
/* Which property the calculator's deal is, and whether it differs from the
   property as saved. A pointer to a property deleted elsewhere (Saved
   Models, Your data, a restored file) is dropped here, so the deal is then
   what it is: an unsaved one. */
function propertyStatus(d = State.deal) {
  let rec = pmFind(d?.modelId);
  if (d && d.modelId && !rec) { d.modelId = null; d.scenarioId = null; }
  let sc = pmScenario(rec, d?.scenarioId);
  if (d && d.scenarioId && !sc) d.scenarioId = null;
  if (!rec) return { kind: dealIsTheReaders(d) ? 'unsaved' : 'sample', rec: null, sc: null, dirty: true };
  return { kind: 'model', rec, sc, dirty: !pmSame(d, pmSavedInputs(rec, sc)) };
}
/* Work that exists nowhere else: a deal the reader started and never saved,
   or a saved property with changes not saved. */
const propertyHasUnsavedWork = (d = State.deal) => { const st = propertyStatus(d); return st.kind === 'model' ? st.dirty : st.kind === 'unsaved'; };

/* ----------------------------------------------------------------- actions */
/* BEFORE THE CALCULATOR IS GIVEN ANOTHER DEAL, work that exists nowhere else
   is kept aside where a shared link and the launcher keep it, and "Restore
   my previous deal" puts it back. The slot holds one deal; if it already
   holds unsaved work of its own, that is saved as a property first rather
   than written over — nothing a reader entered is dropped by opening
   something else. */
function propertySetAside(d = State.deal) {
  if (!propertyHasUnsavedWork(d)) return false;
  const held = store.read('dealBeforeLink', null);
  if (held && isRecord(held) && !pmSame(held, d) && propertyHasUnsavedWork(held)) {
    const at = new Date().toISOString();
    const rec = pmNewRecord(held, `${pmNameOf(held)} — kept aside ${localDay()}`, at);
    persistWork([rec, ...loadWork()]);
  }
  store.write('dealBeforeLink', pmCopy(d));
  return true;
}
/* A property's suggested name: the district and the price, as the work bar
   named a snapshot (WORK_KINDS.property), read off the deal given. */
const pmNameOf = (d) => `${d?.district || 'Property'} — ${fmtAmount(num0(d?.price), 'MYR')}`;
function pmNewRecord(deal, name, at, extra = {}) {
  const rec = { id: nextWorkId('property'), kind: 'property', name: String(name || pmNameOf(deal)).slice(0, 80),
    createdAt: at, payload: { deal: pmNormalInputs(deal) }, scenarios: [], ...extra };
  pmStampRecord(rec, at);
  return rec;
}
/* The calculator is given a deal: the one it had is kept aside if it holds
   work kept nowhere else, and the address follows (saveDeal). */
function propertyLoad(deal, { modelId = null, scenarioId = null } = {}) {
  const kept = propertySetAside(State.deal);
  State.deal = { ...pmNormalInputs(deal), modelId, scenarioId };
  saveDeal();
  return kept;
}
/* To the calculator, or — already on it — its top, with the keyboard on the
   line that says which property it now edits. */
function propertyShowCalculator() {
  if (State.view === 'property') {
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    focusAfterRedraw('#pm-status');
  } else navigate('/property/calculator');
}
const pmKeptNote = (kept) => (kept ? ' Your unsaved deal is kept aside — “Restore my previous deal” puts it back.' : '');

function openPropertyModel(id, { scenarioId = null, show = true } = {}) {
  const rec = pmFind(id);
  if (!rec) { toast('That property is no longer saved in this browser'); return false; }
  const sc = pmScenario(rec, scenarioId);
  const kept = propertyLoad(pmSavedInputs(rec, sc), { modelId: rec.id, scenarioId: sc ? sc.id : null });
  if (show) propertyShowCalculator();
  toast(`${sc ? `Editing the scenario “${sc.name}” of` : 'Editing'} “${rec.name}”.${pmKeptNote(kept)}`);
  return true;
}
/* A new property starts from the sample deal — the figures a first visit
   sees, each marked an illustrative default until it is changed — because a
   calculator with no price, rent or tenure computes nothing. */
const pmSampleDeal = () => ({ ...PROPERTY_DEFAULT_DEAL, touched: {},
  evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: { ...PROPERTY_DEFAULT_DEAL.checks } });
function newPropertyDeal({ show = true } = {}) {
  const kept = propertyLoad(pmSampleDeal());
  if (show) propertyShowCalculator();
  toast(`A new property, from the sample deal — replace its figures with yours, then save it.${pmKeptNote(kept)}`);
}

/* SAVE THIS PROPERTY. Unsaved: it becomes a property, named by the reader.
   A saved property: its inputs are replaced by what is on the calculator —
   or, with a scenario open, the scenario's changes are. Confirmed only if
   the browser kept it (store.failed, 00-core.js). */
function saveActiveProperty({ name = null } = {}) {
  const d = State.deal;
  const st = propertyStatus(d);
  const at = new Date().toISOString();
  const refused = store.failed;
  const list = loadWork();
  if (st.kind !== 'model') {
    const suggested = pmNameOf(d);
    const typed = name ?? prompt('Name this property', suggested);
    if (typed === null) return null;
    const rec = pmNewRecord(d, typed.trim() || suggested, at);
    if (!persistWork([rec, ...list]) || store.failed !== refused) { toast(STORE_REFUSED); return null; }
    d.modelId = rec.id; d.scenarioId = null;
    saveDeal();
    toast(`Saved “${rec.name}” — it is listed in My properties`);
    return rec;
  }
  const rec = list.find(r => r.id === st.rec.id);
  if (st.sc) {
    const sc = rec.scenarios.find(s => s.id === st.sc.id);
    sc.overrides = pmDiff(d, pmInputsOf(rec));
    sc.updatedAt = at;
  } else rec.payload = { ...rec.payload, deal: pmNormalInputs(d) };
  pmStampRecord(rec, at);
  if (!persistWork(list) || store.failed !== refused) { toast(STORE_REFUSED); return null; }
  toast(st.sc ? `Saved the scenario “${st.sc.name}” of “${rec.name}”` : `Saved “${rec.name}”`);
  return rec;
}

/* SAVE AS A SCENARIO: what the calculator holds, as the property with those
   inputs changed. Only for a saved property, and only when something differs
   from it — a scenario identical to its property is the property twice. */
let PM_SC_SEQ = 0;
function saveAsScenario() {
  const d = State.deal;
  const st = propertyStatus(d);
  if (st.kind !== 'model') { toast('Save this property first — a scenario is a variation of a saved property'); return null; }
  const list = loadWork();
  const rec = list.find(r => r.id === st.rec.id);
  const overrides = pmDiff(d, pmInputsOf(rec));
  if (!Object.keys(overrides).length) { toast(`These are the inputs “${rec.name}” is saved with. Change a figure, then save the change as a scenario.`); return null; }
  /* A snapshot saved since this page loaded, by the saved-work store's own
     save, has no list yet until the next load gives it one. */
  if (!Array.isArray(rec.scenarios)) rec.scenarios = [];
  const suggested = pmOverrideLine(overrides, 2) || `Scenario ${rec.scenarios.length + 1}`;
  const typed = prompt(`Name this scenario of “${rec.name}”`, suggested);
  if (typed === null) return null;
  const at = new Date().toISOString();
  const sc = { id: `sc-${Date.now().toString(36)}-${(PM_SC_SEQ++).toString(36)}`, name: (typed.trim() || suggested).slice(0, 80),
    overrides, createdAt: at, updatedAt: at };
  rec.scenarios.push(sc);
  pmStampRecord(rec, at);
  const refused = store.failed;
  if (!persistWork(list) || store.failed !== refused) { toast(STORE_REFUSED); return null; }
  d.scenarioId = sc.id;
  saveDeal();
  /* Compared at once beside the property as saved. */
  pmCompareSelect(rec.id, ['base', sc.id]);
  toast(`Saved the scenario “${sc.name}” of “${rec.name}”`);
  return sc;
}

/* Whether the calculator holds something to save as a new scenario: changes
   not yet saved, which differ from the property as saved. */
const pmCanSaveScenario = (d, st) => st.kind === 'model' && st.dirty && Object.keys(pmDiff(d, pmInputsOf(st.rec))).length > 0;

/* Put the deal back as it was last saved. */
function discardPropertyChanges() {
  const st = propertyStatus();
  if (st.kind !== 'model' || !st.dirty) return false;
  if (!confirm(`Discard the changes made since “${st.sc ? st.sc.name : st.rec.name}” was saved?`)) return false;
  State.deal = { ...pmCopy(pmSavedInputs(st.rec, st.sc)), modelId: st.rec.id, scenarioId: st.sc ? st.sc.id : null };
  saveDeal();
  toast('Changes discarded');
  return true;
}

function duplicatePropertyModel(id) {
  const list = loadWork();
  const rec = list.find(r => r.id === id && pmIsProperty(r));
  if (!rec) return null;
  const at = new Date().toISOString();
  const copy = { ...pmCopy(rec), id: nextWorkId('property'), name: `${rec.name} (copy)`.slice(0, 80), createdAt: at };
  /* The opportunity a property was opened from opens that property, not its copy. */
  delete copy.source;
  pmStampRecord(copy, at);
  const i = list.indexOf(rec);
  list.splice(i, 0, copy);
  return persistWork(list) ? copy : null;
}
function renamePropertyModel(id, name) {
  const list = loadWork();
  const rec = list.find(r => r.id === id && pmIsProperty(r));
  const clean = String(name || '').trim().slice(0, 80);
  if (!rec || !clean) return false;
  rec.name = clean;
  return persistWork(list);
}
/* A deleted property's deal stays on the calculator if it is open there —
   as an unsaved deal, so nothing on screen goes with it. */
function deletePropertyModel(id) {
  const ok = persistWork(loadWork().filter(r => r.id !== id));
  if (ok && State.deal?.modelId === id) { State.deal.modelId = null; State.deal.scenarioId = null; saveDeal(); }
  return ok;
}
function renameScenario(modelId, scId, name) {
  const list = loadWork();
  const sc = pmScenario(list.find(r => r.id === modelId), scId);
  const clean = String(name || '').trim().slice(0, 80);
  if (!sc || !clean) return false;
  sc.name = clean;
  return persistWork(list);
}
function deleteScenario(modelId, scId) {
  const list = loadWork();
  const rec = list.find(r => r.id === modelId);
  if (!rec) return false;
  rec.scenarios = (rec.scenarios || []).filter(s => s.id !== scId);
  const ok = persistWork(list);
  /* Open on the calculator: it stays there, as the property with changes. */
  if (ok && State.deal?.modelId === modelId && State.deal.scenarioId === scId) { State.deal.scenarioId = null; saveDeal(); }
  return ok;
}

/* ------------------------------------------------------------- the handoffs */
/* An opportunity opens as ITS property. The first time, the register's own
   figures — laid over the calculator's, as the register models it
   (candidateModel, 80-registers.js) — are saved as a property named for the
   record and tied to it; after that the same property opens, with whatever
   was changed in it since. Nothing is retyped, and the deal that was on the
   calculator is kept aside if it held unsaved work. */
function openOpportunityProperty(o, modelled) {
  const tied = pmAll().find(r => r.source?.kind === 'opportunity' && r.source.id === o.id);
  if (tied) return openPropertyModel(tied.id);
  const at = new Date().toISOString();
  const rec = pmNewRecord(modelled, o.name, at, { source: { kind: 'opportunity', id: o.id, name: o.name } });
  const refused = store.failed;
  if (!persistWork([rec, ...loadWork()]) || store.failed !== refused) { toast(STORE_REFUSED); return false; }
  const kept = propertyLoad(pmInputsOf(rec), { modelId: rec.id });
  propertyShowCalculator();
  toast(`Opened “${rec.name}” — saved as a property from the opportunity register.${pmKeptNote(kept)}`);
  return true;
}
/* A locality from the area screen or the comparables register becomes the
   district of the property on the calculator. Only a district the town
   lists: the calculator models one of its city's districts, and a locality
   of the reader's own would be modelled as the town's first under a name the
   page did not show (dealDistrict, 70-property.js). The project follows the
   town, as choosing the town on the calculator does. */
const propertyPlaceListed = (city, area) => listedDistrict(city, area);
function usePlaceInCalculator(city, area) {
  const district = listedDistrict(city, area);
  if (!district) return false;
  const d = State.deal;
  if (d.city !== city) {
    d.city = city;
    if (!projectsForCity(city).some(x => x.id === d.projectId)) d.projectId = customProjectId(city);
  }
  d.district = district;
  saveDeal();
  navigate('/property/calculator');
  const st = propertyStatus(d);
  toast(`${district}, ${(SARAWAK_CITIES.find(c => c.id === city) || {}).name || city} is now the district of ${st.kind === 'model' ? `“${st.rec.name}” — unsaved until you save it` : 'the deal on the calculator'}`);
  return true;
}
/* The control both pages draw for it: a button for a listed district, and
   for a locality the town does not list, a sentence saying why there is none. */
function usePlaceControl(city, area, { id } = {}) {
  const town = (SARAWAK_CITIES.find(c => c.id === city) || {}).name || city;
  if (!propertyPlaceListed(city, area)) return el('p', { class: 'metaline' },
    `${area} is not one of ${town}'s listed districts, so the calculator cannot model it by name.`);
  return el('button', { class: 'btn btn-ghost btn-sm', id: id || null, onclick: () => usePlaceInCalculator(city, area) },
    `Use ${area} in the calculator`);
}

/* ---------------------------------------------------------- the model bar */
/* WHICH PROPERTY IS ON THE CALCULATOR, AND ITS ONE NEXT ACTION.
   The work bar said "This browser only" and offered Save, Resume, Duplicate
   latest and Reset, and nothing on the page said whether what was on screen
   was saved, or as what. The bar now says which property is being edited
   and whether it has changed since it was saved, and its one primary action
   is the next one: Save this property until the property is saved, then
   Compare scenarios. The primary slot keeps one id through the save, so the
   keyboard stays on it as it turns from one to the other — Save, Duplicate,
   Open a saved property and New property each keep theirs, as the work
   bar's did (renderKeepFocus). */
function propertyModelBar(d = State.deal) {
  const st = propertyStatus(d);
  const bar = el('section', { class: 'card pm-bar', 'aria-label': 'The property on the calculator' });
  const status = el('p', { class: 'pm-status', id: 'pm-status', tabindex: '-1' });
  if (st.kind === 'model') {
    status.append('Editing: ', el('strong', {}, st.rec.name));
    if (st.sc) status.append(' — scenario ', el('strong', {}, `“${st.sc.name}”`));
    status.append(' · ', st.dirty
      ? el('span', { class: 'pm-unsaved' }, 'Unsaved changes')
      : `saved ${pmWhen(st.sc ? st.sc.updatedAt : pmUpdated(st.rec))}`);
  } else if (st.kind === 'unsaved') status.append(el('span', { class: 'pm-unsaved' }, 'Unsaved changes'), ' — not saved as a property yet');
  else status.append(el('strong', {}, 'Sample deal'), ' — not saved as a property. Every driving figure is the tool’s illustrative default until you change it.');
  bar.append(el('div', { class: 'pm-bar-hd' }, [el('span', { class: 'eyebrow' }, 'This browser only'), status]));

  const acts = el('div', { class: 'pm-acts' });
  const primary = st.kind !== 'model' || st.dirty
    ? el('button', { class: 'btn btn-primary', id: 'wb-property-save', onclick: () => { if (saveActiveProperty()) renderKeepFocus(); } }, 'Save this property')
    : el('button', { class: 'btn btn-primary', id: 'wb-property-save', onclick: () => goToPropertySection('scenarios', { focus: '#pm-sc-title' }) }, 'Compare scenarios');
  acts.append(primary);
  if (st.kind === 'model') {
    /* Offered for changes not saved: an open scenario with none is already
       saved, and saving it again as a scenario made its twin. */
    if (pmCanSaveScenario(d, st)) acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: 'wb-property-scenario',
      onclick: () => { if (saveAsScenario()) renderKeepFocus(); } }, st.sc ? 'Save as a new scenario' : 'Save as a scenario'));
    if (st.sc) acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: 'wb-property-base',
      onclick: () => { openPropertyModel(st.rec.id, { show: false }); renderKeepFocus(); focusAfterRedraw('#wb-property-base', '#pm-status'); } }, 'Back to the property'));
    if (st.dirty) acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: 'wb-property-discard',
      onclick: () => { if (discardPropertyChanges()) { render(); focusAfterRedraw('#pm-status'); } } }, 'Discard changes'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: 'wb-property-dup', onclick: () => {
      const refused = store.failed;
      const copy = duplicatePropertyModel(st.rec.id);
      renderKeepFocus();
      toast(store.failed !== refused || !copy ? STORE_REFUSED : `Duplicated as “${copy.name}” — open it from My properties`);
    } }, 'Duplicate'));
  }
  const others = pmAll().filter(r => r.id !== st.rec?.id);
  if (others.length) {
    const sel = el('select', { class: 'select select-sm', id: 'wb-property-resume', 'aria-label': 'Open a saved property',
      onchange: e => {
        const id = e.target.value;
        if (!id) return;
        openPropertyModel(id, { show: false });
        renderKeepFocus();
      } });
    sel.append(el('option', { value: '' }, `Open a saved property… (${others.length})`));
    others.forEach(r => sel.append(el('option', { value: r.id }, `${r.name} · ${pmWhen(pmUpdated(r))}`)));
    acts.append(sel);
  }
  acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: 'wb-property-reset', onclick: () => { newPropertyDeal({ show: false }); renderKeepFocus(); } }, 'New property'));
  const link = (path, label, id) => el('a', { class: 'btn btn-quiet btn-sm', id, href: href(path),
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
  acts.append(el('span', { class: 'pm-links' }, [link('/property/models', 'My properties', 'wb-property-list'), link('/my/data', 'Back up everything', 'wb-property-backup')]));
  bar.append(acts);
  return bar;
}

/* --------------------------------------------- the calculator's sections */
/* ONE PAGE, FIVE SECTIONS, IN THE ORDER A PURCHASE IS WORKED THROUGH.
   Each opens with what the reader gives it and what it works out, and a
   sticky index reaches each without a route of its own: the address stays
   the deal (syncPropertyUrl). The ids are the anchors other pages link to —
   /property/calculator#scenarios opens at the Scenarios section. */
const PC_SECTIONS = [
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'financing',   label: 'Financing' },
  { id: 'rental',      label: 'Rental & expenses' },
  { id: 'scenarios',   label: 'Scenarios' },
  { id: 'report',      label: 'Report' },
];
function propertySection(id, { provide, calculates }) {
  const i = PC_SECTIONS.findIndex(s => s.id === id);
  const s = PC_SECTIONS[i];
  const inputs = el('div', { class: 'card rail-sticky pc-inputs' });
  const outputs = el('div', { class: 'pc-outputs' });
  const node = el('section', { class: 'pc-sec', id, 'aria-labelledby': `pc-h-${id}` }, [
    el('header', { class: 'pc-sec-hd' }, [
      el('p', { class: 'eyebrow' }, `${i + 1} of ${PC_SECTIONS.length}`),
      el('h2', { class: 'h-section', id: `pc-h-${id}`, tabindex: '-1' }, s.label),
      el('p', { class: 'pc-contract' }, [el('span', { class: 'pc-contract-k' }, 'You provide: '), provide]),
      el('p', { class: 'pc-contract' }, [el('span', { class: 'pc-contract-k' }, 'Quantum calculates: '), calculates]),
    ]),
    el('div', { class: 'studio-layout pc-sec-body' }, [inputs, outputs]),
  ]);
  return { node, inputs, outputs };
}
/* To a section, and the keyboard with it: its heading, or a control in it. */
/* A control named in `focus` is scrolled to itself: on a phone a section's
   outputs sit below its inputs, and scrolled to the section's top the
   control the keyboard was given was a screen or two out of sight. */
function goToPropertySection(id, { focus = null, instant = false } = {}) {
  const sec = document.getElementById(id);
  if (!sec) return false;
  const named = focus && document.querySelector(focus);
  const target = named || document.getElementById(`pc-h-${id}`);
  (named || sec).scrollIntoView({ block: 'start', ...(instant ? { behavior: 'instant' } : {}) });
  target?.focus({ preventScroll: true });
  pcMarkCurrent();
  return true;
}
function propertySectionIndex() {
  const nav = el('nav', { class: 'pc-index', 'aria-label': 'Calculator sections' });
  nav.append(el('ol', { class: 'pc-index-list' }, PC_SECTIONS.map(s => el('li', {},
    el('a', { class: 'pc-index-link', href: `#${s.id}`, data: { sec: s.id },
      /* The address is the deal, and a hash in it would be dropped by the next
         edit anyway: the link scrolls. A modified click opens the section's
         own address, which lands on it (propertyArrivalSection). */
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); goToPropertySection(s.id); } },
      s.label)))));
  return nav;
}
/* The index says which section is on screen: the last one whose top has
   reached the index's lower edge. */
function pcMarkCurrent() {
  const nav = document.querySelector('.pc-index');
  if (!nav) return;
  const edge = nav.getBoundingClientRect().bottom + 24;
  let here = null;
  for (const s of PC_SECTIONS) {
    const n = document.getElementById(s.id);
    if (n && n.getBoundingClientRect().top <= edge) here = s.id;
  }
  nav.querySelectorAll('.pc-index-link').forEach(a => {
    if (a.dataset.sec === here) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
  });
  /* On a phone the row is narrower than its five links, and the section on
     screen was the one cut off at its edge: the row is scrolled to it. */
  const list = nav.querySelector('.pc-index-list'), cur = here && nav.querySelector(`[data-sec="${here}"]`);
  if (list && cur && (cur.offsetLeft < list.scrollLeft || cur.offsetLeft + cur.offsetWidth > list.scrollLeft + list.clientWidth))
    list.scrollLeft = Math.max(0, cur.offsetLeft - 16);
}
{
  let queued = false;
  addEventListener('scroll', () => {
    if (queued || !document.querySelector('.pc-index')) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; pcMarkCurrent(); });
  }, { passive: true });
}
/* A section named in the address when the calculator is opened — a link to
   /property/calculator#scenarios — is scrolled to once the page is drawn.
   Read before the page writes its own address, which carries no hash. */
/* Not before the page has its data: the filings and the locality file each
   redraw it as they land, the district panel and the map growing by
   thousands of pixels above the section, and a scroll made before that
   was left a screen of Acquisition short of it (the redraw replaces every
   node, so the browser has nothing to anchor the scroll to). Held until the
   pages settle (propertyPagesSettled), for ten seconds at most. */
let pcArrivalSeen = null, pcArrivalWant = null, pcArrivalAt = 0;
function propertyArrivalSection() {
  const want = location.hash.replace(/^#/, '');
  const key = location.pathname + location.search + location.hash;
  if (PC_SECTIONS.some(s => s.id === want) && pcArrivalSeen !== key) { pcArrivalSeen = key; pcArrivalWant = want; pcArrivalAt = Date.now(); }
  if (!pcArrivalWant) return;
  const go = () => {
    if (!pcArrivalWant || State.view !== 'property') { pcArrivalWant = null; return; }
    if (!propertyPagesSettled() && Date.now() - pcArrivalAt < 10000) { setTimeout(go, 200); return; }
    const id = pcArrivalWant;
    pcArrivalWant = null;
    /* At once, as a browser lands on an anchor: a page's length of smooth
       scrolling is not an arrival. */
    goToPropertySection(id, { instant: true });
  };
  setTimeout(go, 0);
}

/* The Report section's last word: the printable record of the same inputs.
   The decision record draws whichever tool's work is chosen on it, so the
   link chooses the property. */
function propertyReportNext(d = State.deal) {
  const st = propertyStatus(d);
  const card = el('div', { class: 'card' });
  card.append(cardHead('Take the report with you',
    `The decision record prints ${st.kind === 'model' ? `“${st.rec.name}”${st.sc ? `, scenario “${st.sc.name}”,` : ''}` : 'this deal'} on one page: the figures, every input with where it came from, and everything still open. It reads the same inputs as every section above.`));
  card.append(el('a', { class: 'btn btn-ghost btn-sm', id: 'pm-record', href: href('/decision-record'),
    onclick: e => { State.decisionSubject = 'property'; if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/decision-record'); } },
    'Open the decision record'));
  return card;
}

/* -------------------------------------------------------------- scenarios */
/* Which columns the comparison shows, per property, for the session: the
   property as saved and at most two scenarios, until the reader picks. */
const PM_COMPARE = {};
function pmCompareSelect(modelId, ids) { PM_COMPARE[modelId] = ids.slice(0, 3); }
/* What a scenario changes, in words: "Expected monthly rent (RM) 2,000;
   Loan interest rate (%) 4.8". The label is the calculator's own for the
   field; a record of grades or answers is named by what it is. */
const PM_RECORD_WORDS = { evidence: 'evidence grades', touched: 'which figures are yours', checks: 'checklist answers', checkEvidence: 'how checklist answers were established' };
/* The fields the rail does not label: named as the panels that set them do. */
const PM_FIELD_WORDS = {
  reserveMonths: 'Months of reserve', ownUseWeeks: 'Weeks a year of own use', marginalTaxPct: 'Marginal tax rate (%)',
  disposerCategory: 'Who is selling', flatQuotePct: 'Flat-rate quote (%)', flatQuoteAmount: 'Flat-rate amount (RM)',
  flatQuoteYears: 'Flat-rate term (years)', mrtaPremium: 'MRTA premium (RM)', mltaPremiumAnnual: 'MLTA premium a year (RM)',
  propertyClassOverride: 'Asset class', valuationRule: 'What the loan is calculated on', userStarted: 'started by you',
};
function pmOverrideLine(ov, max = 6) {
  /* Which figures were entered is bookkeeping that follows a changed figure
     (markTouched), not a change of its own worth naming. */
  const bits = Object.entries(ov || {}).filter(([k]) => k !== 'touched').map(([k, v]) => {
    if (isRecord(v)) return PM_RECORD_WORDS[k] || k;
    const label = PROPERTY_I18N[`in.${k}`]?.en || PM_FIELD_WORDS[k] || k;
    const shown = typeof v === 'number' ? fmtNum(v, Number.isInteger(v) ? 0 : 2) : v === null ? 'not set' : String(v);
    return `${label} ${shown}`;
  });
  return bits.length > max ? `${bits.slice(0, max).join('; ')}; and ${bits.length - max} more` : bits.join('; ');
}
/* The five figures the comparison sets side by side, from the calculator's
   own model and grade — the same engine the page reads, never a second one. */
function pmCompareFigures(d) {
  const m = dealModel(d), g = propertyGrade(d, m);
  const short = (m.missingCostLines || []).length;
  return [
    ['Monthly position', isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : '—', isNum(m.cashflowMonthly) && m.cashflowMonthly < 0 ? 'neg' : ''],
    ['Cash required', isNum(m.safeCashRequired) ? `${fmtAmount(m.safeCashRequired, 'MYR')}${short ? ' so far' : ''}` : '—', ''],
    ['Net yield', isNum(m.netYield) ? fmtPct(m.netYield, 2) : '—', ''],
    ['Break-even rent', isNum(m.breakEvenRent) ? fmtAmount(m.breakEvenRent, 'MYR') : '—', ''],
    ['Grade', `${g.grade}${g.verdict ? ` — ${g.verdict}` : ''}`, ''],
  ];
}
function propertyScenariosPanel(d = State.deal) {
  const st = propertyStatus(d);
  const card = el('div', { class: 'card pm-scenarios' });
  card.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h3', { class: 'h-card', id: 'pm-sc-title', tabindex: '-1' }, st.kind === 'model' ? `Scenarios of “${st.rec.name}”` : 'Scenarios'),
    el('p', { class: 'caption', style: 'margin-top:2px;max-width:60ch' },
      'A scenario is this property with some inputs changed. It keeps only what it changes; everything else follows the property as saved. Up to three are set side by side on the same model.'),
  ])));
  if (st.kind !== 'model') {
    card.append(el('p', { class: 'body' }, 'Scenarios belong to a saved property. Save this property, change a figure — the rent, the rate, the deposit — and save the change as a scenario to compare it with the property as saved.'));
    card.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--sm)', id: 'pm-sc-save-first',
      onclick: () => { if (saveActiveProperty()) { render(); focusAfterRedraw('#pm-sc-title'); } } }, 'Save this property first'));
    return card;
  }
  const rec = st.rec, base = pmInputsOf(rec);
  /* The columns on offer: the property as saved, each scenario, and — while
     the calculator holds changes not saved — those changes as they stand. */
  const cols = [{ id: 'base', name: `${rec.name} as saved`, short: 'As saved', inputs: base, what: 'Every input as the property is saved — what each scenario changes is measured against it' }];
  (rec.scenarios || []).forEach(s => cols.push({ id: s.id, name: s.name, short: s.name, inputs: pmMerge(base, s.overrides), what: pmOverrideLine(s.overrides) || 'Nothing changed', sc: s }));
  if (st.dirty) cols.push({ id: 'current', name: 'On the calculator now, unsaved', short: 'Unsaved changes', inputs: pmBare(d), what: pmOverrideLine(pmDiff(d, base)) || 'Nothing changed' });
  const valid = new Set(cols.map(c => c.id));
  let chosen = (PM_COMPARE[rec.id] || []).filter(id => valid.has(id));
  if (!PM_COMPARE[rec.id]) chosen = cols.slice(0, 3).map(c => c.id);
  PM_COMPARE[rec.id] = chosen;

  const list = el('ul', { class: 'pm-sc-list', 'aria-label': `Scenarios of ${rec.name}` });
  cols.forEach(c => {
    const on = chosen.includes(c.id);
    const cbId = `pm-sc-cmp-${c.id}`;
    /* The one the calculator has open — the property itself, or a scenario. */
    const open = c.id === 'base' ? !d.scenarioId : c.id === d.scenarioId;
    const row = el('li', { class: `pm-sc-row${open ? ' is-open' : ''}` });
    row.append(el('label', { class: 'checkline pm-sc-pick', for: cbId }, [
      el('input', { type: 'checkbox', id: cbId, checked: on ? '' : null, onchange: e => {
        const now = PM_COMPARE[rec.id] || [];
        if (e.target.checked && now.length >= 3) { e.target.checked = false; toast('Three at most side by side — clear one first'); return; }
        PM_COMPARE[rec.id] = e.target.checked ? [...now, c.id] : now.filter(x => x !== c.id);
        renderKeepFocus();
      } }),
      el('span', {}, [el('strong', {}, c.name),
        open ? el('span', { class: 'chip chip-brand', style: 'margin-left:6px' }, st.dirty ? 'open · unsaved changes' : 'open on the calculator') : null,
        el('span', { class: 'metaline pm-sc-what' }, c.what)]),
    ]));
    const acts = el('div', { class: 'pm-sc-acts' });
    if (c.sc) {
      acts.append(el('button', { class: 'btn btn-ghost btn-sm', id: `pm-sc-open-${c.id}`, 'aria-label': `Open the scenario ${c.name} to edit`,
        onclick: () => { openPropertyModel(rec.id, { scenarioId: c.id, show: false }); render(); window.scrollTo({ top: 0, behavior: 'instant' }); focusAfterRedraw('#pm-status'); } }, 'Open to edit'));
      acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: `pm-sc-ren-${c.id}`, 'aria-label': `Rename the scenario ${c.name}`,
        onclick: () => {
          const name = prompt('Rename this scenario', c.name);
          if (name === null || !name.trim()) return;
          const refused = store.failed;
          renameScenario(rec.id, c.id, name); renderKeepFocus();
          toast(store.failed !== refused ? STORE_REFUSED : 'Renamed');
        } }, 'Rename'));
      acts.append(el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Delete the scenario ${c.name}`,
        onclick: () => {
          if (!confirm(`Delete the scenario “${c.name}”? This browser holds the only copy.`)) return;
          const refused = store.failed;
          deleteScenario(rec.id, c.id); render();
          focusAfterRedraw('#pm-sc-title');
          toast(store.failed !== refused ? STORE_UNDELETED : 'Scenario deleted');
        } }, 'Delete'));
    } else if (c.id === 'base' && d.scenarioId) {
      acts.append(el('button', { class: 'btn btn-ghost btn-sm', id: 'pm-sc-open-base',
        onclick: () => { openPropertyModel(rec.id, { show: false }); render(); window.scrollTo({ top: 0, behavior: 'instant' }); focusAfterRedraw('#pm-status'); } }, 'Open to edit'));
    }
    row.append(acts);
    list.append(row);
  });
  card.append(list);

  const add = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--sm)' });
  if (pmCanSaveScenario(d, st)) add.append(el('button', { class: 'btn btn-ghost btn-sm', id: 'pm-sc-save',
    onclick: () => { if (saveAsScenario()) { renderKeepFocus(); focusAfterRedraw('#pm-sc-save', '#pm-sc-title'); } } },
    'Save what is on the calculator as a scenario'));
  else add.append(el('p', { class: 'metaline' }, 'To add a scenario, change an input in any section above — the rent, the rate, the deposit — and save the change here or from the bar at the top.'));
  card.append(add);

  const shown = cols.filter(c => chosen.includes(c.id));
  if (shown.length < 2) {
    card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
      cols.length < 2 ? 'Nothing to set beside the property yet: save a scenario and it is compared here.' : 'Tick two or three to set them side by side.'));
    return card;
  }
  const figs = shown.map(c => pmCompareFigures(c.inputs));
  const t = el('table', { class: 'dt pm-sc-table' });
  t.append(el('caption', { class: 'sr-only' }, `${shown.map(c => c.short).join(', ')}, side by side`));
  t.append(el('thead', {}, el('tr', {}, [el('th', { scope: 'col', style: 'text-align:left' }, el('span', { class: 'sr-only' }, 'Figure')),
    ...shown.map(c => el('th', { scope: 'col', class: 'num' }, c.short))])));
  const tb = el('tbody');
  figs[0].forEach(([label], r) => tb.append(el('tr', {}, [el('th', { scope: 'row', style: 'text-align:left' }, label),
    ...figs.map(f => el('td', { class: `num ${f[r][2]}`.trim() }, f[r][1]))])));
  tb.append(el('tr', {}, [el('th', { scope: 'row', style: 'text-align:left' }, 'Changes against the property'),
    ...shown.map(c => el('td', { class: 'caption', style: 'white-space:normal;min-width:10rem' }, c.id === 'base' ? '—' : c.what))]));
  t.append(tb);
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--md)' }, t));
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Each column is the calculator’s own model run on that column’s inputs: monthly position after vacancy, costs and the loan; cash required including the reserve; net yield on the price; the rent at which the monthly position is nil; and the underwriting grade. Scenarios, not forecasts — and nothing here is ranked.'));
  return card;
}

/* ------------------------------------------------------------ My properties */
/* /property/models: every property this browser holds, the one on the
   calculator marked, the sample deal said to be a sample, and any deal kept
   nowhere else — the calculator's unsaved one, the one kept aside before a
   shared link — listed with what saves or restores it. */
function pmRowFigures(d) {
  const m = dealModel(d);
  return { price: fmtAmount(num0(d.price), 'MYR'), monthly: isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : '—',
    neg: isNum(m.cashflowMonthly) && m.cashflowMonthly < 0 };
}
const pmPlace = (d) => [d?.district, (SARAWAK_CITIES.find(c => c.id === d?.city) || {}).name].filter(Boolean).join(', ') || '—';

VIEWS.propertyModels = () => {
  const wrap = el('div', { class: 'pm-page', style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Property'),
    el('h1', {}, 'My properties'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Each property you save keeps its inputs and its scenarios. Open one and the calculator edits it — the financing, the returns, the sensitivity, the tests, the grade and the report all read the same figures, so nothing is typed twice.'),
  ])));

  const props = pmAll().sort((a, b) => String(pmUpdated(b) || '').localeCompare(String(pmUpdated(a) || '')));
  const st = propertyStatus(State.deal);
  const lim = el('div', { class: 'card pm-limits' });
  lim.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
    el('span', { class: 'chip' }, 'Stored in this browser'),
    el('span', { class: 'chip' }, 'No account, no sync'),
    el('p', { class: 'metaline', style: 'flex:1 1 280px;margin:0' },
      'A cleared browser or another device starts empty. The export on Your data carries every property here, with its scenarios.'),
    el('button', { class: 'btn btn-primary', id: 'pm-new', onclick: () => newPropertyDeal() }, 'New property'),
  ]));
  wrap.append(lim);

  /* Work that exists nowhere else comes first: it is what a cleared tab loses. */
  const loose = [];
  if (st.kind === 'unsaved' || (st.kind === 'model' && st.dirty)) loose.push({ kind: 'current', d: State.deal,
    title: st.kind === 'model' ? `Unsaved changes to “${st.rec.name}”` : 'The deal on the calculator — not saved',
    note: st.kind === 'model' ? 'Changes on the calculator since this property was saved.' : 'Kept as you edit it, and on no list until it is saved.' });
  const kept = store.read('dealBeforeLink', null);
  if (isRecord(kept) && propertyHasUnsavedWork(kept) && !pmSame(kept, State.deal)) loose.push({ kind: 'kept', d: kept,
    title: 'Kept aside — your previous deal', note: 'Put aside when a shared link, the launcher or another property was opened on the calculator.' });
  if (loose.length) {
    const lc = el('div', { class: 'card' });
    lc.append(cardHead('Not saved as a property', 'Each is held in this browser in one place only. Save it to keep it in the list below.'));
    const ul = el('ul', { class: 'pm-list pm-loose' });
    loose.forEach(x => {
      const f = pmRowFigures(x.d);
      ul.append(el('li', { class: 'pm-row' }, [
        el('div', { class: 'pm-row-main' }, [
          el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [el('span', { class: 'chip chip-bronze' }, 'Not saved')]),
          el('strong', {}, x.title),
          el('span', { class: 'metaline' }, `${pmPlace(x.d)} · ${f.price} · ${x.note}`),
        ]),
        el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Monthly position'), el('span', { class: `num${f.neg ? ' neg' : ''}` }, f.monthly)]),
        el('div', { class: 'pm-acts-row' }, x.kind === 'current'
          ? [el('button', { class: 'btn btn-ghost btn-sm', id: 'pm-loose-open', onclick: () => navigate('/property/calculator') }, 'Continue'),
             el('button', { class: 'btn btn-quiet btn-sm', id: 'pm-loose-save', onclick: () => { if (saveActiveProperty()) { render(); focusAfterRedraw('#pm-list-hd'); } } }, 'Save it')]
          : [el('button', { class: 'btn btn-ghost btn-sm', id: 'pm-kept-restore', onclick: () => {
              if (restoreDealBeforeLink()) { toast('Your previous deal is restored'); navigate('/property/calculator'); }
            } }, 'Restore it')]),
      ]));
    });
    lc.append(ul);
    wrap.append(lc);
  }

  const lc = el('div', { class: 'card', style: 'padding:0' });
  lc.append(el('div', { class: 'card-hd pm-list-hd' }, el('div', {}, [
    el('h2', { class: 'h-card', id: 'pm-list-hd', tabindex: '-1' }, props.length ? `${props.length} saved propert${props.length === 1 ? 'y' : 'ies'}` : 'No properties saved yet'),
    el('p', { class: 'caption', style: 'margin-top:2px' }, props.length
      ? 'Newest change first. The order is when each was last saved, not how it compares.'
      : 'Open the sample deal or start a new property, change its figures to yours, and save it. Every property you save is listed here.'),
  ])));
  const ul = el('ul', { class: 'pm-list', 'aria-label': 'Saved properties' });
  ul.append(el('li', { class: 'pm-row pm-head', 'aria-hidden': 'true' }, [el('span', {}, 'Property'), el('span', {}, 'Price'),
    el('span', {}, 'Monthly position'), el('span', {}, 'Updated'), el('span', {}, '')]));
  props.forEach((rec, idx) => {
    const d = pmInputsOf(rec), f = pmRowFigures(d);
    const onCalc = st.rec?.id === rec.id;
    const sample = workIsSample(rec);
    const nSc = (rec.scenarios || []).length;
    const acts = el('div', { class: 'pm-acts-row' });
    acts.append(el('button', { class: 'btn btn-ghost btn-sm pm-open', id: `pm-open-${rec.id}`, 'aria-label': `Open ${rec.name}`,
      onclick: () => openPropertyModel(rec.id) }, 'Open'));
    const kept = (act, done, refocus) => { const refused = store.failed; act(); render(); refocus(); toast(store.failed !== refused ? STORE_REFUSED : done); };
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: `pm-dup-${rec.id}`, 'aria-label': `Duplicate ${rec.name}`,
      onclick: () => kept(() => duplicatePropertyModel(rec.id), 'Duplicated', () => focusAfterRedraw(`#pm-dup-${rec.id}`)) }, 'Duplicate'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', id: `pm-ren-${rec.id}`, 'aria-label': `Rename ${rec.name}`,
      onclick: () => {
        const name = prompt('Rename this property', rec.name);
        if (name === null || !name.trim()) return;
        kept(() => renamePropertyModel(rec.id, name), 'Renamed', () => focusAfterRedraw(`#pm-ren-${rec.id}`));
      } }, 'Rename'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Delete ${rec.name}`,
      onclick: () => {
        if (!confirm(`Delete “${rec.name}”${nSc ? ` and its ${nSc} scenario${nSc === 1 ? '' : 's'}` : ''}? This browser holds the only copy.${onCalc ? ' It stays on the calculator as an unsaved deal.' : ''}`)) return;
        const refused = store.failed;
        deletePropertyModel(rec.id); render();
        const opens = $$('#views .pm-list .pm-open');
        focusAfterRedraw(opens[Math.min(idx, opens.length - 1)], '#pm-new');
        toast(store.failed !== refused ? STORE_UNDELETED : 'Deleted');
      } }, 'Delete'));
    ul.append(el('li', { class: `pm-row${onCalc ? ' is-open' : ''}` }, [
      el('div', { class: 'pm-row-main' }, [
        el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [
          onCalc ? el('span', { class: 'chip chip-brand' }, st.dirty ? 'On the calculator · unsaved changes' : 'On the calculator') : null,
          sample ? el('span', { class: 'chip chip-bronze', title: 'Every figure in it is the calculator’s sample input. Not your figures.' }, 'sample') : null,
          rec.source?.kind === 'opportunity' ? el('span', { class: 'chip' }, 'From the opportunity register') : null,
          nSc ? el('span', { class: 'chip' }, `${nSc} scenario${nSc === 1 ? '' : 's'}`) : null,
        ]),
        el('strong', {}, rec.name),
        el('span', { class: 'metaline' }, `${pmPlace(d)} · ${d.propertyType || 'Property'}`),
      ]),
      el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Price'), el('span', { class: 'num' }, f.price)]),
      el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Monthly position'), el('span', { class: `num${f.neg ? ' neg' : ''}` }, f.monthly)]),
      el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Updated'), el('span', {}, pmWhen(pmUpdated(rec)))]),
      acts,
    ]));
  });
  /* The sample, always offered and always called one. */
  const sd = pmSampleDeal(), sf = pmRowFigures(sd);
  const proj = PROJECTS.find(p => p.id === sd.projectId);
  ul.append(el('li', { class: 'pm-row pm-sample' }, [
    el('div', { class: 'pm-row-main' }, [
      el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [el('span', { class: 'chip chip-bronze' }, 'Sample — not a real listing')]),
      el('strong', {}, `Sample deal${proj ? ` — ${proj.name}` : ''}`),
      el('span', { class: 'metaline' }, `${pmPlace(sd)} · ${sd.propertyType} · illustrative figures this tool carries, chosen by nobody for any property`),
    ]),
    el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Price'), el('span', { class: 'num' }, sf.price)]),
    el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Monthly position'), el('span', { class: `num${sf.neg ? ' neg' : ''}` }, sf.monthly)]),
    el('div', { class: 'pm-cell' }, [el('span', { class: 'pm-label' }, 'Updated'), el('span', {}, 'not saved')]),
    el('div', { class: 'pm-acts-row' }, el('button', { class: 'btn btn-ghost btn-sm', id: 'pm-open-sample', onclick: () => newPropertyDeal() }, 'Open the sample')),
  ]));
  lc.append(ul);
  wrap.append(lc);
  return wrap;
};
