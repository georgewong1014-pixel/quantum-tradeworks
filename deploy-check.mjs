#!/usr/bin/env node
/**
 * Is what production serves the same file I have?
 *
 *   node deploy-check.mjs                     one check, exit 0 if identical
 *   node deploy-check.mjs --wait              poll until it matches, or time out
 *   node deploy-check.mjs --wait --timeout 900
 *   node deploy-check.mjs --url https://…     check somewhere else
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Deployment was verified all session by grepping the served HTML for a string
 * from the change just made. That method has a failure mode that guarantees a
 * false positive rather than merely risking one: if the string already existed
 * — because it was added by an earlier commit, or because it appears in a
 * comment, or because the new code merely reuses a name — the grep passes
 * against a stale bundle and reports success.
 *
 * That is exactly what happened. The check polled for `WHEEL_TRANSITIONS`,
 * which the previous commit had already shipped, so it returned "deployed"
 * instantly while production served the old file. The real deployment then
 * never arrived: the commit sat on origin for twenty minutes with production
 * unchanged, and only an empty commit forced it through.
 *
 * Two independent problems, and the dangerous one is the first — a silent
 * no-op deploy is survivable when you can see it, and invisible when your
 * check cannot fail.
 *
 * HOW THIS CANNOT FALSE-POSITIVE
 *
 * It compares the WHOLE FILE, not a substring. One character different in
 * either direction and the hashes differ. There is no string to choose badly,
 * no marker to forget to update, and nothing to get right at the call site.
 *
 * Newlines are normalised first, and only newlines. The repository stores CRLF
 * and the CDN serves LF, which is a transport difference rather than a content
 * one — verified empirically: after normalisation the two are identical
 * byte-for-byte, so nothing is injected and no other allowance is needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has  = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const URL_    = flag('url', 'https://quantum-tradeworks.vercel.app/');
const FILE    = flag('file', 'index.html');
const WAIT    = has('wait');
const TIMEOUT = Number(flag('timeout', 600));
const EVERY   = Number(flag('every', 10));

/* Only newlines. Anything more would start excusing real differences. */
const normalise = (s) => s.replace(/\r\n/g, '\n');
const fingerprint = (s) => createHash('sha256').update(normalise(s), 'utf8').digest('hex');

const short = (h) => h.slice(0, 12);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchServed() {
  /* Cache-busted, because a check that can be answered from a cache is not a
     check. The site sends no-store, and this costs nothing if that holds. */
  const r = await fetch(`${URL_}${URL_.includes('?') ? '&' : '?'}dc=${process.pid}-${Math.floor(performance.now())}`,
    { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

function localCommit() {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); }
  catch { return null; }
}
function isDirty() {
  try { return execSync(`git status --porcelain -- ${FILE}`, { encoding: 'utf8' }).trim().length > 0; }
  catch { return false; }
}

const local = await readFile(FILE, 'utf8');
const want = fingerprint(local);
const head = localCommit();
const dirty = isDirty();

console.log(`file    : ${FILE}`);
console.log(`local   : ${short(want)}${head ? `  (HEAD ${head}${dirty ? ', uncommitted changes' : ''})` : ''}`);
console.log(`target  : ${URL_}`);

if (dirty) {
  console.log('\nnote: the local file has uncommitted changes, so a match here would mean');
  console.log('production is serving something you have not committed. Usually this means');
  console.log('the check is being run before the commit rather than after the deploy.');
}

const started = Date.now();
let attempt = 0;

while (true) {
  attempt++;
  let got, err = null;
  try { got = fingerprint(await fetchServed()); }
  catch (e) { err = e.message; }

  const elapsed = Math.round((Date.now() - started) / 1000);

  if (!err && got === want) {
    console.log(`\nserved  : ${short(got)}`);
    console.log(`MATCH — production is serving this exact file${attempt > 1 ? ` (after ${elapsed}s)` : ''}.`);
    process.exit(0);
  }

  if (!WAIT) {
    console.log(`\nserved  : ${err ? `could not fetch — ${err}` : short(got)}`);
    console.log('STALE — production is NOT serving this file.');
    console.log('\nThe deployment has not landed. If it does not arrive within a few minutes,');
    console.log('an empty commit forces one: git commit --allow-empty -m "chore: trigger redeploy"');
    process.exit(1);
  }

  if (elapsed >= TIMEOUT) {
    console.log(`\nserved  : ${err ? `could not fetch — ${err}` : short(got)}`);
    console.log(`TIMED OUT after ${elapsed}s — production never matched.`);
    console.log('\nThe commit may be on origin without a deployment having run. Check that the');
    console.log('push reached origin, then force one: git commit --allow-empty -m "chore: trigger redeploy"');
    process.exit(1);
  }

  if (attempt === 1) process.stdout.write('\nwaiting');
  process.stdout.write('.');
  await sleep(EVERY * 1000);
}
