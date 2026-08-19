/* ==========================================================================
   REGISTER LOG — WHAT CHANGED, WHEN, AND WHO SAYS SO
   --------------------------------------------------------------------------
   Every recorded figure in this product used to be stored by overwriting it.
   `State.observations[i] = {...}` and `State.areaProfiles[k] = {...}` were the
   whole persistence model, so a corrected transacted price left no trace of the
   figure it corrected, a mistyped digit could only be found by remembering it,
   and two people keying evidence into two browsers had no way to reconcile.

   That is tolerable while one person records a handful of rows for themselves.
   It stops being tolerable the moment somebody is paid to key in transacted
   prices, because then the register is evidence about other people's property
   and "who changed this, and from what" is a question that will be asked.

   So writes go through here first. The log is append-only: a correction is a
   new event, a deletion is a new event, and an undo is a new event carrying the
   inverse. Nothing in this file ever rewrites or removes a past entry, because
   a history that can be edited is not a history.

   THE PROJECTION IS A CACHE, THE LOG IS THE RECORD.

   State.observations and State.areaProfiles remain exactly as they were, and
   every reader still reads them. They are the current state folded up for fast
   access. If the two ever disagreed, the log is right — replayRegister()
   rebuilds the projection from nothing and is the definition of correct.

   AND IT IS THE SYNC PAYLOAD.

   When there is a server, this is what gets sent: an ordered list of typed
   events with a monotonic sequence and an actor. Merging two append-only logs
   is a solved problem; merging two overwritten snapshots is a guess.
   ========================================================================== */

const REGISTER_LOG_CAP = 3000;   /* localStorage is ~5MB total across all keys */

/* Sequence is monotonic WITHIN a browser and never derived from the clock. A
   timestamp is what happened when; a sequence is what happened after what, and
   two events in the same millisecond still have an order. */
let REG_SEQ = 0;

/* Who is keying this in. Unset is honest and common — one person recording for
   themselves does not need to name themselves. It matters when an agent is paid
   to enter transacted prices and someone later asks whose figure this was. */
const registerActor = () => (store.read('registerActor', '') || '').trim();
const setRegisterActor = (name) => store.write('registerActor', String(name || '').trim());

const registerLog = () => store.read('registerLog', []);

function loadRegisterLog() {
  REG_SEQ = registerLog().reduce((m, e) => Math.max(m, e.seq || 0), 0);
}

/* Appends and returns the event. The ONLY function in the codebase that writes
   the log — everything else calls a recorder below. */
function logRegister(entity, op, id, detail) {
  const log = registerLog();
  const ev = {
    seq: ++REG_SEQ,
    at: new Date().toISOString(),
    actor: registerActor() || null,
    entity, op, id, ...detail,
  };
  log.push(ev);
  /* Trimming loses history, so it is stated rather than done quietly: the
     survivor carries the count of what was dropped, and the log is never
     silently shorter than it claims to be. */
  if (log.length > REGISTER_LOG_CAP) {
    const dropped = log.length - REGISTER_LOG_CAP;
    const kept = log.slice(dropped);
    kept[0] = { ...kept[0], trimmedBefore: (kept[0].trimmedBefore || 0) + dropped };
    store.write('registerLog', kept);
  } else {
    store.write('registerLog', log);
  }
  return ev;
}

/* History for one record, newest first. */
const registerHistory = (entity, id) =>
  registerLog().filter(e => e.entity === entity && e.id === id).reverse();

/* ---------------------------------------------------------------- recorders */

const recordObservationAdded = (o) => logRegister('observation', 'add', o.id, { after: o });
const recordObservationEdited = (id, field, from, to) =>
  logRegister('observation', 'edit', id, { field, from: from ?? null, to: to ?? null });
const recordObservationDeleted = (o) => logRegister('observation', 'delete', o.id, { before: o });
const recordAreaAttr = (key, attrId, from, to) =>
  logRegister('areaAttr', to ? (from ? 'edit' : 'add') : 'delete', key,
    { field: attrId, from: from ?? null, to: to ?? null });

/* ------------------------------------------------------------------- undo */

/* The newest event that has not itself been reversed, and is not a reversal. */
function lastUndoableEvent() {
  const log = registerLog();
  const undone = new Set(log.filter(e => e.undoOf).map(e => e.undoOf));
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.undoOf || undone.has(e.seq)) continue;
    return e;
  }
  return null;
}

const canUndoRegister = () => !!lastUndoableEvent();

/* Reverses the most recent change and RECORDS THE REVERSAL. The undone event
   stays in the log with its original sequence — it did happen. Returns a short
   human description, or null when there is nothing to undo. */
function undoLastRegisterChange() {
  const e = lastUndoableEvent();
  if (!e) return null;

  if (e.entity === 'observation') {
    if (e.op === 'add') {
      State.observations = State.observations.filter(x => x.id !== e.id);
      saveObservations();
      logRegister('observation', 'delete', e.id, { before: e.after, undoOf: e.seq });
      return 'Undid: record added';
    }
    if (e.op === 'delete') {
      State.observations = [e.before, ...State.observations];
      saveObservations();
      logRegister('observation', 'add', e.id, { after: e.before, undoOf: e.seq });
      return 'Undid: record deleted';
    }
    if (e.op === 'edit') {
      const k = State.observations.findIndex(x => x.id === e.id);
      if (k > -1) {
        State.observations[k] = { ...State.observations[k], [e.field]: e.from };
        saveObservations();
      }
      logRegister('observation', 'edit', e.id, { field: e.field, from: e.to, to: e.from, undoOf: e.seq });
      return `Undid: ${e.field} changed`;
    }
  }

  if (e.entity === 'areaAttr') {
    const prev = { ...(State.areaProfiles[e.id] || {}) };
    if (e.from) prev[e.field] = e.from; else delete prev[e.field];
    if (Object.keys(prev).length) State.areaProfiles[e.id] = prev;
    else delete State.areaProfiles[e.id];
    saveAreaProfiles();
    logRegister('areaAttr', e.from ? 'edit' : 'delete', e.id,
      { field: e.field, from: e.to, to: e.from, undoOf: e.seq });
    return 'Undid: area attribute changed';
  }
  return null;
}

/* ------------------------------------------------------------------ replay */

/* Rebuilds both projections from the log alone. This is what makes the claim
   "the log is the record" checkable rather than decorative: if a replay and the
   stored projection disagree, something wrote around the recorder. A trimmed
   log cannot replay to a complete state and says so, rather than returning a
   partial answer that looks complete. */
function replayRegister() {
  const log = registerLog();
  if (log.some(e => e.trimmedBefore))
    return { ok: false, why: 'the log has been trimmed, so it no longer holds every event' };

  const obs = new Map();
  const areas = {};
  for (const e of log) {
    if (e.entity === 'observation') {
      if (e.op === 'add') obs.set(e.id, { ...e.after });
      else if (e.op === 'delete') obs.delete(e.id);
      else if (e.op === 'edit' && obs.has(e.id)) obs.set(e.id, { ...obs.get(e.id), [e.field]: e.to });
    } else if (e.entity === 'areaAttr') {
      const cur = { ...(areas[e.id] || {}) };
      if (e.to) cur[e.field] = e.to; else delete cur[e.field];
      if (Object.keys(cur).length) areas[e.id] = cur; else delete areas[e.id];
    }
  }
  return { ok: true, observations: [...obs.values()], areaProfiles: areas };
}

/* REPLAY, COMPARED — the check the file header promises.
   replayRegister() rebuilt the projection and nothing called it, so "the log is
   the record" was a claim that existed only in a comment. This is what makes it
   answerable on screen: a reader can see whether the history actually accounts
   for every figure they are looking at.

   Compared by id and by field, NOT by serialising both sides: the log replays in
   the order events happened and the projection prepends, so two identical
   registers stringify differently and a JSON comparison would report a mismatch
   on every healthy install. */
function registerIntegrity() {
  const r = replayRegister();
  const held = State.observations || [];
  if (!r.ok) return { state: 'unverifiable', why: r.why, held: held.length };

  const byId = new Map(r.observations.map(o => [o.id, o]));
  const missing = held.filter(o => !byId.has(o.id));
  const extra = r.observations.filter(o => !held.some(h => h.id === o.id));
  /* Only the fields a record is made of. recordedAt is stamped at write time and
     is carried through the log unchanged, so it is compared like any other. */
  const differing = held.filter(o => {
    const b = byId.get(o.id);
    return b && Object.keys(o).some(k => JSON.stringify(o[k]) !== JSON.stringify(b[k]));
  });

  if (!missing.length && !extra.length && !differing.length)
    return { state: 'ok', held: held.length, events: registerLog().length };
  return { state: 'mismatch', held: held.length,
    missing: missing.length, extra: extra.length, differing: differing.length };
}

/* One line of prose for an event, for the history list in a record's drawer. */
function registerEventText(e) {
  const who = e.actor ? ` by ${e.actor}` : '';
  const when = String(e.at || '').slice(0, 16).replace('T', ' ');
  const val = (v) => v == null || v === '' ? 'nothing'
    : typeof v === 'object' ? (v.label || v.value || JSON.stringify(v).slice(0, 40)) : String(v);
  if (e.op === 'add') return `${when}${who} — recorded`;
  if (e.op === 'delete') return `${when}${who} — deleted`;
  return `${when}${who} — ${e.field}: ${val(e.from)} → ${val(e.to)}`;
}

/* Resume the sequence at load. Without this a reload restarts REG_SEQ at 0 and
   two events in the same log share a sequence number — which is the one thing
   the sequence exists to prevent. */
loadRegisterLog();
