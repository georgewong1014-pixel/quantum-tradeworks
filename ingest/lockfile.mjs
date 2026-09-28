/**
 * Lock files for the local tools — one data directory on one machine.
 *
 * Two writers of one file on this PC (Task Scheduler's run and a manual one,
 * or live.mjs while daily.mjs is importing) each read the file, change it and
 * rename their copy over it; the second rename wins and the first writer's
 * work is gone without a word. A lock file opened with 'wx' (O_EXCL) closes
 * that: the open fails for everyone but the first.
 *
 * WHAT THIS IS NOT. It is not a distributed lock. It protects a directory on
 * one disk, and it cannot tell a live process on another machine from a dead
 * one — a lock written by another host is treated as held until it is older
 * than `staleMs`. Windows reuses process ids, so "the pid is alive" can be
 * wrong; the age cap is the backstop.
 */

import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';

/* process.kill(pid, 0) sends nothing; it asks whether the pid exists. EPERM
   means it exists and belongs to someone else — alive. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function readHolder(path) {
  try {
    const text = await readFile(path, 'utf8');
    try { return { holder: JSON.parse(text), text }; }
    catch {
      /* A lock caught between its open and its write is empty for a moment. */
      const age = Date.now() - (await stat(path)).mtimeMs;
      return { holder: null, text, young: age < 5000 };
    }
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

/* Why a held lock may be taken over ('dead', 'stale', 'unreadable'), or null
   when it may not. */
export function lockVerdict(holder, { staleMs = 3600000, now = Date.now(), host = hostname() } = {}) {
  if (!holder) return 'unreadable';
  const started = Date.parse(holder.startedAt);
  const age = Number.isFinite(started) ? now - started : Infinity;
  if (holder.host === host && !pidAlive(holder.pid)) return 'dead';
  if (age > staleMs) return 'stale';
  return null;
}

/* Take the lock: { ok: true, lock, takenOver } or { ok: false, holder }.
   A lock whose process is dead, or which is older than staleMs, is taken
   over; the caller records `takenOver` (the previous holder and why). */
export async function acquireLock(path, { info = {}, staleMs = 3600000, host = hostname() } = {}) {
  let takenOver = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const lock = { pid: process.pid, host, startedAt: new Date().toISOString(), token: randomBytes(6).toString('hex'), ...info };
    try {
      const fh = await open(path, 'wx');
      try { await fh.writeFile(JSON.stringify(lock, null, 2) + '\n'); } finally { await fh.close(); }
      return { ok: true, lock, takenOver };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const seen = await readHolder(path);
    if (!seen) continue;                                   /* released between the two calls */
    if (!seen.holder && seen.young) return { ok: false, holder: null, why: 'held (being written)' };
    const why = lockVerdict(seen.holder, { staleMs, host });
    if (!why) return { ok: false, holder: seen.holder };
    /* Renamed aside, not deleted: of two processes taking over the same
       stale lock only one rename succeeds. The other sees ENOENT and tries
       the open again, where it finds the winner's lock. */
    const aside = `${path}.${process.pid}.${Date.now()}.stale`;
    try { await rename(path, aside); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const moved = await readFile(aside, 'utf8').catch(() => null);
    if (moved !== seen.text) {
      /* The stale lock was replaced between the read and the rename, so
         what was moved aside is a live lock. Put it back and stand down. */
      await rename(aside, path).catch(() => {});
      let holder = null; try { holder = JSON.parse(moved); } catch { /* unreadable */ }
      return { ok: false, holder };
    }
    await rm(aside, { force: true });
    takenOver = { holder: seen.holder, why };
  }
  const last = await readHolder(path);
  return { ok: false, holder: last?.holder || null };
}

/* Release only a lock this process still holds: after a takeover by
   someone else, deleting the file would delete theirs. */
export async function releaseLock(path, lock) {
  const seen = await readHolder(path);
  if (seen?.holder && lock && seen.holder.token === lock.token) await rm(path, { force: true });
}

/* A short critical section: wait for the lock (it is held for
   milliseconds), run fn, release. A holder older than staleMs is taken
   over — a process killed inside the section left it behind. */
export async function withLock(path, fn, { waitMs = 15000, staleMs = 30000, info = {} } = {}) {
  const until = Date.now() + waitMs;
  let got;
  for (;;) {
    got = await acquireLock(path, { staleMs, info });
    if (got.ok) break;
    if (Date.now() > until) {
      throw Object.assign(new Error(`${path} stayed locked for ${Math.round(waitMs / 1000)} s${got.holder ? ` (pid ${got.holder.pid} since ${got.holder.startedAt})` : ''}`), { code: 'LOCKED' });
    }
    await sleep(20 + Math.floor(Math.random() * 40));
  }
  try { return await fn(); } finally { await releaseLock(path, got.lock); }
}
