#!/usr/bin/env node
/**
 * Does each tool work, start to finish, on the site as it is served?
 *
 *   node journeys.mjs                               http://localhost:8123 (node serve.mjs)
 *   node journeys.mjs http://localhost:8221         another local server
 *   node journeys.mjs --url production              the live site (the template's canonical origin)
 *   node journeys.mjs --url https://…               any deployment
 *
 *   --json [file]        the result, in health/journeys.json's shape (stdout without a file)
 *   --markdown <file>    the result as a table: the workflow's job summary and its issue body
 *   --commit <sha>       the commit a deployment event names: wait up to --wait seconds (300)
 *                        for the site to serve that commit's build, and record it as served
 *   --only <id,id>       some journeys: equities, screener, property, scanner, ctas
 *   --decide <recorded.json> <new.json> [--deployed-files <list.txt>]
 *                        offline: should the new result be committed over the recorded one?
 *                        The list is the paths the deployed commit changed: when it is only
 *                        health/, the run tested the deployment of its own record and
 *                        nothing is committed
 *                        Prints commit=, why=, fails=, degraded=, all_pass= lines (GITHUB_OUTPUT)
 *   --self-test          offline: the commit rule, the result's shape and the table, on fixtures,
 *                        and the workflow that applies the rule (its concurrency, inputs, permissions)
 *
 * Exit 0 when no journey FAILS (a DEGRADED one is reported, not fatal); 1 when
 * one does; 2 when the check itself cannot run (no browser, a bad argument).
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every harness here asks whether a PAGE is right: it renders, its numbers are
 * the quantities their labels claim, it does not overflow. None asks whether a
 * reader can get from the front door to the thing they came for. An outside
 * audit put it plainly: a tool that is present is not a tool that works, and
 * the site said nothing about which of its tools had been seen working, when,
 * or on what build. /status listed what was built; it could not say whether
 * any of it worked on the site as served.
 *
 * So these are journeys, not pages. Each one is what a reader does — find a
 * company, read its filed statements and where a figure came from, keep it on
 * a list; filter the screener and open what it found; model a property,
 * change it, save it; build a scanner setup, save it and have it evaluated;
 * press each primary call to action — in real Chrome, by real clicks and key
 * presses, and it passes only when the whole path completes: entry → valid
 * input → calculation or data → a meaningful result → the save or next
 * action. A page that renders and a button that does nothing is a FAIL here.
 *
 * WHAT A RESULT SAYS
 *
 *   PASS      the whole path completed, each step within its budget
 *   DEGRADED  it completed, but a step was slower than its stated budget or a
 *             part the path does not depend on failed (a console error, a
 *             source that named no XBRL concept) — the note says which
 *   FAIL      the path broke: the step and the route it broke on are named
 *
 * WHAT IT NEVER TOUCHES
 *
 * The personal lane. On the owner's machine the page asks serve.mjs for the
 * git-ignored files (price history, scanner records, prices); here every such
 * request is answered 404 inside the browser, before it reaches the server,
 * so a run reads none of them and behaves as the deployed site does. The one
 * exception is the scanner journey's evaluate step on a LOCAL run: its price
 * history is a synthetic series made in the page from the engine's own
 * fixture, dated to end on the session the engine expects now, so that step
 * proves an evaluation and a match. Against the deployed site the page asks
 * for no history at all, and the step instead holds the page to saying so.
 *
 * Nothing is written to the site. Each journey runs in its own browser
 * context, so its storage starts empty (bar what the journey seeds, said
 * where it does) and is discarded with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─── THE RESULT FILE ─────────────────────────────────────────────────────── */
export const RESULT_KIND = 'quantum-tradeworks-journeys';
export const STATUSES = ['PASS', 'DEGRADED', 'FAIL'];
/* A recorded run is refreshed once a day even when nothing changed, so the
   page's "last recorded run" is never more than a day behind the last run. */
export const REFRESH_MS = 24 * 3600 * 1000;

/* What the page and the workflow both hold a result to. The page has its own
   copy of this rule (91-health.js, healthResultProblem); the self-test below
   and the /status block in sweep.mjs hold the two to the same fixtures. */
export function resultProblem(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'not an object';
  if (doc.kind !== RESULT_KIND) return `kind is ${JSON.stringify(doc.kind)}, not ${RESULT_KIND}`;
  if (doc.ranAt == null && Array.isArray(doc.journeys) && !doc.journeys.length) return null;   /* the placeholder: no run yet */
  if (typeof doc.ranAt !== 'string' || !Number.isFinite(Date.parse(doc.ranAt))) return 'ranAt is not a date';
  if (!Array.isArray(doc.journeys) || !doc.journeys.length) return 'it lists no journeys';
  for (const j of doc.journeys) {
    if (!j || typeof j.id !== 'string' || typeof j.name !== 'string') return 'a journey has no id or name';
    if (!STATUSES.includes(j.status)) return `journey ${j.id} has status ${JSON.stringify(j.status)}`;
    if (j.status === 'FAIL' && (typeof j.failedStep !== 'string' || !j.failedStep)) return `journey ${j.id} failed at no named step`;
    if (j.ms != null && !Number.isFinite(j.ms)) return `journey ${j.id} has a time that is not a number`;
  }
  return null;
}
export const hasRun = (doc) => !!doc && typeof doc.ranAt === 'string' && Array.isArray(doc.journeys) && doc.journeys.length > 0;

/* The part of a result that decides whether it is news: each journey's
   status and the step it failed at. Times, the commit and the route move on
   every run and are not news. */
export function signature(doc) {
  return JSON.stringify((doc?.journeys || []).map(j => [j.id, j.status, j.status === 'FAIL' ? j.failedStep || null : null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/* COMMIT ONLY WHAT IS NEWS. The workflow runs after every production
   deployment and nightly; the file it commits is deployed, and that
   deployment runs the journeys again. So a result is committed only when a
   status or a failing step changed, or the recorded run is a day old.

   AND NEVER FROM THE DEPLOYMENT OF ITS OWN RECORD. "An identical result a
   minute later commits nothing" ends the loop only while the result is
   identical — and a status can flap: a step a second over its budget is
   DEGRADED on one run and PASS on the next, and each flip was a change, so
   each was committed, deployed and run again. A deployment whose commit
   changed nothing but health/ serves the same app as the one before it, so
   its run is not news about the site: it still reports (the summary, the
   issue), but it records nothing (deployedFiles, from the workflow). */
export const ownRecord = (files) => Array.isArray(files) && files.length > 0 && files.every(f => /^health\//.test(f));
export function decide(recorded, fresh, now = Date.now(), { deployedFiles = null } = {}) {
  const p = resultProblem(fresh);
  if (p || !hasRun(fresh)) return { commit: false, why: `the new result cannot be recorded: ${p || 'it holds no run'}` };
  if (ownRecord(deployedFiles)) return { commit: false, why: `this run tested the deployment of a commit that changed only ${deployedFiles.join(', ')} — the same app as the deployment before it — so it records nothing: a status that differs on this run waits for the next nightly or code deployment, and a flapping status cannot loop` };
  if (recorded == null) return { commit: true, why: 'no result is recorded yet' };
  const rp = resultProblem(recorded);
  if (rp) return { commit: true, why: `the recorded result cannot be read (${rp})` };
  if (!hasRun(recorded)) return { commit: true, why: 'the recorded file holds no run yet' };
  if (signature(recorded) !== signature(fresh)) {
    const was = new Map(recorded.journeys.map(j => [j.id, j]));
    const moved = fresh.journeys.filter(j => { const w = was.get(j.id); return !w || w.status !== j.status || (j.status === 'FAIL' && w.failedStep !== j.failedStep); })
      .map(j => `${j.id} ${was.get(j.id)?.status || 'new'} → ${j.status}`);
    const gone = recorded.journeys.filter(j => !fresh.journeys.some(x => x.id === j.id)).map(j => `${j.id} no longer run`);
    return { commit: true, why: `changed: ${[...moved, ...gone].join('; ') || 'a failing step'}` };
  }
  const age = now - Date.parse(recorded.ranAt);
  if (age > REFRESH_MS) return { commit: true, why: `the same results, and the recorded run is ${Math.round(age / 3600000)} hours old` };
  return { commit: false, why: `the same statuses and failing steps as the recorded run of ${recorded.ranAt}, which is under 24 hours old` };
}

const fmtS = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function markdown(doc) {
  const n = (s) => doc.journeys.filter(j => j.status === s).length;
  const lines = [];
  lines.push(`### Journeys: ${n('PASS')} pass, ${n('DEGRADED')} degraded, ${n('FAIL')} fail`);
  lines.push('');
  lines.push(`Ran ${doc.ranAt.slice(0, 16).replace('T', ' ')} UTC against ${doc.url}${doc.commit ? `, commit \`${doc.commit.slice(0, 12)}\`` : ', commit not identified'}${doc.commitFrom ? ` (${doc.commitFrom})` : ''}.`);
  lines.push('');
  lines.push('| Journey | Status | Failing step | Route | Time |');
  lines.push('| --- | --- | --- | --- | --- |');
  doc.journeys.forEach(j => lines.push(`| ${cell(j.name)} | ${j.status} | ${cell(j.failedStep)} | ${cell(j.route)} | ${fmtS(j.ms)} |`));
  const notes = doc.journeys.filter(j => j.note);
  if (notes.length) {
    lines.push('');
    notes.forEach(j => lines.push(`- **${cell(j.name)}** (${j.status}): ${cell(j.note)}`));
  }
  lines.push('');
  return lines.join('\n');
}

/* ─── OFFLINE MODES ───────────────────────────────────────────────────────── */
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return undefined; } };

function selfTest() {
  let bad = 0;
  const t = (ok, what) => { if (ok) console.log(`ok    ${what}`); else { bad++; console.error(`FAIL  ${what}`); } };
  const j = (id, status, failedStep = null) => ({ id, name: id, status, failedStep, route: failedStep ? '/x' : null, ms: 1000, note: null });
  const doc = (ranAt, journeys) => ({ kind: RESULT_KIND, schema: 1, ranAt, url: 'https://example.test', commit: 'abc', commitFrom: 'test', journeys });
  const now = Date.parse('2026-09-30T12:00:00Z');
  const pass = doc('2026-09-30T10:00:00Z', [j('a', 'PASS'), j('b', 'PASS')]);
  const pass2 = doc('2026-09-30T11:30:00Z', [j('b', 'PASS'), j('a', 'PASS')]);
  t(decide(undefined, pass2, now).commit === true, 'no recorded file: the first result is committed');
  t(decide({ kind: RESULT_KIND, schema: 1, ranAt: null, journeys: [] }, pass2, now).commit === true, 'the placeholder file: the first result is committed');
  t(decide(pass, pass2, now).commit === false, 'the same statuses, recorded 2h ago: nothing is committed (the deploy loop ends here)');
  t(decide(doc('2026-09-29T11:00:00Z', pass.journeys), pass2, now).commit === true, 'the same statuses, recorded 25h ago: refreshed');
  t(decide(pass, doc('2026-09-30T11:30:00Z', [j('a', 'PASS'), j('b', 'DEGRADED')]), now).commit === true, 'a status changed: committed');
  const failA = doc('2026-09-30T11:00:00Z', [j('a', 'FAIL', 'Save'), j('b', 'PASS')]);
  t(decide(failA, doc('2026-09-30T11:30:00Z', [j('a', 'FAIL', 'Open')]), now).commit === true, 'a journey is gone: committed');
  t(decide(failA, doc('2026-09-30T11:30:00Z', [j('a', 'FAIL', 'Open'), j('b', 'PASS')]), now).commit === true, 'the failing step moved: committed');
  t(decide(failA, doc('2026-09-30T11:30:00Z', [j('a', 'FAIL', 'Save'), j('b', 'PASS')]), now).commit === false, 'the same failure at the same step: nothing committed');
  t(decide({ kind: 'nope' }, pass2, now).commit === true, 'an unreadable recorded file is replaced');
  t(decide(pass, { kind: RESULT_KIND, ranAt: 'soon', journeys: [] }, now).commit === false, 'an unreadable new result is never committed');
  /* The flapping loop: PASS recorded, the deployment of that record's own
     commit runs and a step is a second over budget — DEGRADED. Committed,
     that deploys again, and the next run may flip back. */
  const flap = doc('2026-09-30T11:30:00Z', [j('a', 'PASS'), j('b', 'DEGRADED')]);
  t(decide(pass, flap, now, { deployedFiles: ['health/journeys.json'] }).commit === false, 'the deployment of the record\'s own commit records nothing, even when a status flapped (no loop)');
  t(decide(undefined, pass2, now, { deployedFiles: ['health/journeys.json'] }).commit === false, 'the deployment of the record\'s own commit records nothing, even over no record');
  t(decide(pass, flap, now, { deployedFiles: ['health/journeys.json', 'src/js/91-health.js'] }).commit === true, 'a deployment that changed the app as well is news: a changed status is committed');
  t(decide(pass, flap, now, { deployedFiles: [] }).commit === true && decide(pass, flap, now).commit === true, 'with no list of the deployed files (nightly, by hand) the rule is unchanged');
  t(resultProblem(doc('2026-09-30T11:30:00Z', [j('a', 'FAIL')])) !== null, 'a FAIL with no named step is not a valid result');
  t(resultProblem(doc('2026-09-30T11:30:00Z', [{ ...j('a', 'PASS'), status: 'OK' }])) !== null, 'a status outside PASS, DEGRADED and FAIL is not a valid result');
  t(resultProblem({ kind: RESULT_KIND, schema: 1, ranAt: null, journeys: [] }) === null && !hasRun({ kind: RESULT_KIND, ranAt: null, journeys: [] }), 'the placeholder is valid and holds no run');
  const md = markdown(doc('2026-09-30T11:30:00Z', [j('a', 'PASS'), { ...j('b|c', 'FAIL', 'Step | with a pipe'), note: 'why' }]));
  t(/\| a \| PASS \| — \| — \| 1\.0 s \|/.test(md) && /Step \\\| with a pipe/.test(md) && /1 pass, 0 degraded, 1 fail/.test(md), 'the table: one row per journey, pipes escaped, the counts in the heading');
  /* The workflow that applies the rule, read as text (no YAML parser here):
     its concurrency is the job's, so an event whose job is skipped (a
     preview deployment, a pending status) cannot cancel a production run
     waiting its turn; the deployed commit's files reach the rule; and it
     asks for the two permissions it uses and no others. */
  const wf = join(ROOT, '.github/workflows/journeys.yml');
  if (existsSync(wf)) {
    const y = readFileSync(wf, 'utf8').replace(/\r\n/g, '\n');
    t(!/^concurrency:/m.test(y) && /^ {4}concurrency:\n {6}group: journeys\n {6}cancel-in-progress: false$/m.test(y), 'the workflow: one concurrency group, the job\'s — a skipped preview event cannot cancel a pending production run');
    t(/--decide [^\n]*--deployed-files/.test(y) && /git diff --name-only "\$DEPLOY_SHA\^" "\$DEPLOY_SHA"/.test(y), 'the workflow: the deployed commit\'s files reach the commit rule');
    const perms = /^permissions:\n((?: {2}[^\n]*\n)+)/m.exec(y);
    t(!!perms && perms[1].trim().split('\n').map(s => s.trim()).sort().join(',') === 'contents: write,issues: write', 'the workflow: permissions contents write and issues write, nothing else');
  }
  console.log(bad ? `\n${bad} self-test check(s) failed` : '\nself-test: the commit rule, the result shape, the table and the workflow hold');
  process.exit(bad ? 1 : 0);
}

if (has('self-test')) selfTest();
if (has('decide')) {
  const i = argv.indexOf('--decide');
  const [recFile, newFile] = [argv[i + 1], argv[i + 2]];
  if (!newFile) { console.error('usage: node journeys.mjs --decide <recorded.json> <new.json>'); process.exit(2); }
  const recorded = existsSync(recFile) ? readJson(recFile) : undefined;
  const fresh = readJson(newFile);
  /* --deployed-files <file>: the paths the deployed commit changed, one a
     line (git diff --name-only <sha>^ <sha>), for a run after a deployment. */
  const df = flag('deployed-files');
  const deployedFiles = df && existsSync(df) ? readFileSync(df, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : null;
  const d = decide(recorded === undefined && existsSync(recFile) ? { unreadable: true } : recorded, fresh, Date.now(), { deployedFiles });
  const js = fresh?.journeys || [];
  const n = (s) => js.filter(x => x.status === s).length;
  console.log(`commit=${d.commit}`);
  console.log(`why=${d.why.replace(/\r?\n/g, ' ')}`);
  console.log(`fails=${n('FAIL')}`);
  console.log(`degraded=${n('DEGRADED')}`);
  console.log(`all_pass=${js.length > 0 && n('PASS') === js.length}`);
  console.log(`summary=${n('PASS')} pass, ${n('DEGRADED')} degraded, ${n('FAIL')} fail`);
  console.log(`commit_served=${fresh?.commit || ''}`);
  console.log(`ran_at=${fresh?.ranAt || ''}`);
  process.exit(0);
}

/* ─── WHERE ───────────────────────────────────────────────────────────────── */
let BASE = flag('url') || argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:8123';
if (BASE === 'production') {
  const { siteOrigin } = await import('./build.mjs');
  BASE = siteOrigin(readFileSync(join(ROOT, 'src/index.template.html'), 'utf8'));
}
BASE = BASE.replace(/\/+$/, '');
let HOST;
try { HOST = new URL(BASE).hostname; } catch { console.error(`not an address: ${BASE}`); process.exit(2); }
/* The owner's machine, as the app decides it (25-universe.js, OWNER_MACHINE):
   only there does the page ask for the personal lane at all. */
const OWNER_MACHINE = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(HOST);
const ONLY = (flag('only') || '').split(',').map(s => s.trim()).filter(Boolean);

/* Budgets. A first load includes the 1.4MB of filed statements; an action
   is one click or entry and its answer. Over budget is DEGRADED, not FAIL:
   the reader got there, slowly. A step that has not finished at STEP_LIMIT
   has failed. */
const BUDGET = { load: 10000, action: 4000 };
const STEP_LIMIT = 45000;

/* ─── WHICH COMMIT IS SERVED ──────────────────────────────────────────────── */
/* The site carries no build stamp, so the served build is identified the way
   deploy-check.mjs identifies it: by its whole index.html. Its git blob id is
   compared with the committed index.html of HEAD, then of every commit that
   changed it — the newest match is the build being served. */
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return null; } };
const blobId = (text) => { const buf = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8'); return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex'); };
async function servedBlob() {
  try { const r = await fetch(`${BASE}/`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } }); return r.ok ? blobId(await r.text()) : null; }
  catch { return null; }
}
async function commitServed() {
  const want = flag('commit');
  if (want) {
    const target = git('rev-parse', `${want}:index.html`);
    const deadline = Date.now() + Number(flag('wait') || 300) * 1000;
    while (target) {
      if (await servedBlob() === target) return { commit: git('rev-parse', want) || want, commitFrom: 'the deployment event, and the site serves its build' };
      if (Date.now() > deadline) break;
      await sleep(10000);
    }
    const found = await matchServed();
    return found.commit
      ? { ...found, commitFrom: `${found.commitFrom}; the deployment event named ${want.slice(0, 12)}, whose build was not served within ${flag('wait') || 300}s` }
      : { commit: want, commitFrom: `the deployment event; the served build could not be matched to it${target ? '' : ' (that commit is not in this checkout)'}` };
  }
  return matchServed();
}
async function matchServed() {
  const blob = await servedBlob();
  if (!blob) return { commit: null, commitFrom: 'the site could not be fetched' };
  const head = git('rev-parse', 'HEAD');
  if (!head) return { commit: null, commitFrom: 'no git checkout to match the served build against' };
  if (git('rev-parse', 'HEAD:index.html') === blob) return { commit: head, commitFrom: 'the served index.html is the build of the commit checked out' };
  const log = git('log', '-n', '400', '--format=@%H', '--raw', '--no-abbrev', '--', 'index.html') || '';
  let sha = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) { sha = line.slice(1); continue; }
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) /.exec(line);
    if (m && m[1] === blob) return { commit: sha, commitFrom: 'the served index.html is the build this commit made' };
  }
  return { commit: null, commitFrom: 'the served index.html matches no commit in this checkout (an uncommitted build?)' };
}

/* ─── THE BROWSER ─────────────────────────────────────────────────────────── */
const CANDIDATES = [
  process.env.CHROME_PATH, process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CI_FLAGS = process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : [];

async function startBrowser() {
  const bin = CANDIDATES.find(existsSync);
  if (!bin) throw Object.assign(new Error('no Chrome or Edge found — set CHROME_PATH'), { setup: true });
  /* CDP_PORT pins the debugging port, as in every harness here, so runs side
     by side cannot land on the same Chrome. */
  const port = Number(process.env.CDP_PORT) || 9650 + (process.pid % 150);
  const profile = join(tmpdir(), `cdp-journeys-${process.pid}`);
  const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });
  let url = null;
  for (let i = 0; i < 80 && !url; i++) {
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  if (!url) { proc.kill(); throw Object.assign(new Error(`devtools never came up on port ${port}`), { setup: true }); }
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('could not connect to devtools')), { once: true }); });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
      return;
    }
    listeners.forEach(fn => { try { fn(m); } catch { /* a listener's own fault is not the page's */ } });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject, method });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  /* Chrome holds its profile for a moment after the kill; removed at once the
     rm failed quietly on Windows and every run left its profile in TEMP
     (sweep.mjs has the story). Wait for the exit, then retry the removal. */
  const close = async () => {
    try { ws.close(); } catch { /* gone */ }
    proc.kill();
    await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  };
  return { send, listeners, close };
}

/* Every file the app asks for only on the owner's machine: the reader's own
   prices, history, scanner records and operations logs. */
const PERSONAL = /\/data\/(prices|personal-[a-z-]+|price-history|price-adjustments|scan-[a-z-]+|ingest-runs|sarawak-income|watchlists)\.json/;
/* Absences the product expects (README-bughunt: "Expected, not defects"):
   the personal lane, which is answered 404 here; the analytics script, absent
   locally; and the journeys file itself before its first run. */
const EXPECTED_ABSENT = [PERSONAL, /\/_vercel\/insights\/script\.js/, /\/health\/journeys\.json/];
const expected = (e) => !!e.url && EXPECTED_ABSENT.some(re => re.test(e.url));

class StepError extends Error {}
const STOP = Symbol('stop');

async function openTab(browser, { width = 1440, height = 900, storage = null } = {}) {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p = {}) => browser.send(m, p, sessionId);
  const requests = new Map();
  const tab = { errors: [], prompt: 'Journey check', history: null, dialogs: 0, S };
  const listener = (m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params || {};
    switch (m.method) {
      case 'Network.requestWillBeSent': requests.set(p.requestId, p.request.url); break;
      case 'Network.responseReceived':
        if (p.response.status >= 400) tab.errors.push({ kind: 'http', text: `${p.response.status} ${p.response.url}`, url: p.response.url });
        break;
      case 'Network.loadingFailed':
        if (!p.canceled && !/ERR_ABORTED/.test(p.errorText || '')) tab.errors.push({ kind: 'network', text: `${p.errorText} ${requests.get(p.requestId) || ''}`.trim(), url: requests.get(p.requestId) || null });
        break;
      case 'Runtime.exceptionThrown':
        tab.errors.push({ kind: 'exception', text: String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text).split('\n')[0], url: p.exceptionDetails?.url || null });
        break;
      case 'Runtime.consoleAPICalled':
        if (p.type === 'error' || p.type === 'assert') tab.errors.push({ kind: 'console', text: (p.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300), url: null });
        break;
      case 'Log.entryAdded':
        if (p.entry.level === 'error') tab.errors.push({ kind: 'log', text: `${p.entry.text}`.slice(0, 300), url: p.entry.url || null });
        break;
      case 'Runtime.bindingCalled':
        if (p.name === '__cspViolation') tab.errors.push({ kind: 'csp', text: `CSP ${p.payload}`, url: null });
        break;
      /* A prompt is answered with the name the journey chose, a confirm with
         yes — what a reader saving their work does. */
      case 'Page.javascriptDialogOpening':
        tab.dialogs++;
        S('Page.handleJavaScriptDialog', { accept: true, ...(p.type === 'prompt' ? { promptText: tab.prompt } : {}) }).catch(() => {});
        break;
      /* The personal lane, answered here and never by the server. */
      case 'Fetch.requestPaused': {
        const url = p.request.url;
        const m2 = PERSONAL.exec(new URL(url).pathname);
        if (!m2) { S('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); break; }
        if (m2[1] === 'price-history' && tab.history) {
          S('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
            body: Buffer.from(tab.history, 'utf8').toString('base64') }).catch(() => {});
        } else {
          S('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404,
            responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
            body: Buffer.from('Not read by the journeys: the personal lane is answered 404 in the browser.').toString('base64') }).catch(() => {});
        }
        break;
      }
    }
  };
  browser.listeners.add(listener);
  await S('Runtime.enable'); await S('Page.enable'); await S('Log.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  /* A Content-Security-Policy that blocks the app's own script renders
     nothing and says so once; this makes it an error a journey sees. */
  await S('Runtime.addBinding', { name: '__cspViolation' });
  await S('Page.addScriptToEvaluateOnNewDocument', { source:
    "document.addEventListener('securitypolicyviolation', e => __cspViolation(e.violatedDirective + ' blocked ' + String(e.blockedURI || e.sourceFile || 'inline').slice(0, 90)));" });
  if (OWNER_MACHINE) await S('Fetch.enable', { patterns: [{ urlPattern: '*/data/*', requestStage: 'Request' }] });

  tab.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text || 'evaluation threw');
    return r.result?.value;
  };
  tab.waitFor = async (expr, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await tab.eval(`!!(${expr})`)) return true; } catch { /* the page is between documents */ }
      await sleep(120);
    }
    return false;
  };
  tab.expect = async (expr, why, ms = 15000) => { if (!await tab.waitFor(expr, ms)) throw new StepError(typeof why === 'function' ? await why() : why); };
  tab.where = () => tab.eval('location.pathname + location.search').catch(() => null);
  /* A fresh load of an address, done when the app has drawn it with the
     filed statements in. What stopped it is said in the reader's terms. */
  tab.goto = async (path, { data = true } = {}) => {
    await tab.eval('window.__journeyMark = 1').catch(() => {});
    const nav = await S('Page.navigate', { url: BASE + path });
    if (nav.errorText) throw new StepError(`${path} could not be loaded: ${nav.errorText}`);
    const ready = `!window.__journeyMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view${data ? " && typeof realPending !== 'undefined' && !realPending" : ''}`;
    if (!await tab.waitFor(ready, 30000)) {
      const why = await tab.eval(`typeof State === 'undefined' ? 'the app never started — the page is “' + document.title + '”' : (typeof realPending !== 'undefined' && realPending) ? 'the filed statements never finished loading' : 'the page never settled'`).catch(() => 'the page never loaded');
      throw new StepError(`${path}: ${why}`);
    }
    await sleep(250);
  };
  /* A real click at the control's centre, through the input pipeline, as a
     mouse gives it. A control that is covered, hidden or disabled is said to
     be, rather than clicked through with element.click(). */
  tab.click = async (find, what) => {
    const box = await tab.eval(`(() => { const n = (${find}); if (!n) return null;
      n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = n.getBoundingClientRect(); if (!r.width || !r.height) return { hidden: true };
      const x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
      const name = (e) => e ? (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '')) : 'nothing';
      return { x, y, disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true', covered: top && (n === top || n.contains(top)) ? null : name(top) }; })()`);
    if (!box) throw new StepError(`${what} is not on the page`);
    if (box.hidden) throw new StepError(`${what} is on the page but not visible`);
    if (box.disabled) throw new StepError(`${what} is disabled`);
    if (box.covered) throw new StepError(`${what} is covered by ${box.covered}`);
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(200);
  };
  tab.key = async (key) => {
    const map = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''] };
    const [code, text] = map[key] || [key.toUpperCase().charCodeAt(0), key];
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await sleep(150);
  };
  /* Typed as a reader types it: focus by a click, everything in the box
     selected, the new text inserted over it. A number box commits on Tab. */
  tab.fill = async (find, value, what, { commit = false } = {}) => {
    await tab.click(find, what);
    await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
    await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await S('Input.insertText', { text: String(value) });
    await sleep(150);
    const got = await tab.eval(`(${find})?.value ?? null`).catch(() => null);
    if (got !== null && got !== String(value)) throw new StepError(`${what} holds “${got}” after typing “${value}”`);
    if (commit) await tab.key('Tab');
  };
  tab.text = (sel = 'main') => tab.eval(`(document.querySelector(${JSON.stringify(sel)})?.innerText || '')`);
  tab.close = async () => {
    browser.listeners.delete(listener);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  };
  /* Storage the journey needs before its first real page: open the origin,
     write, and every later load reads it. */
  if (storage) {
    await tab.goto('/privacy', { data: false });
    await tab.eval(`(() => { ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify('vl.' + k)}, ${JSON.stringify(JSON.stringify(v))});`).join('')} return true; })()`);
  }
  tab.errors.length = 0;
  return tab;
}

/* ─── A JOURNEY ───────────────────────────────────────────────────────────── */
class Journey {
  constructor(id, name) { Object.assign(this, { id, name, status: 'PASS', failedStep: null, route: null, ms: 0, notes: [], steps: [] }); }
  degrade(why, route = null) { if (this.status === 'PASS') this.status = 'DEGRADED'; this.notes.push(why); if (!this.route && route) this.route = route; }
  fail(step, route, why) { this.status = 'FAIL'; this.failedStep = step; this.route = route; this.notes.unshift(why); }
  toJSON() {
    return { id: this.id, name: this.name, status: this.status, failedStep: this.failedStep, route: this.route, ms: this.ms,
      note: this.notes.length ? this.notes.join(' · ').slice(0, 600) : null,
      steps: this.steps.map(s => ({ name: s.name, ms: s.ms, status: s.status, ...(s.why ? { why: s.why.slice(0, 200) } : {}) })) };
  }
}

/* One step: done within STEP_LIMIT or failed, and over its budget is said.
   Returns { ok, out } or { ok: false, why, route } — step() stops the journey
   on a failure, trial() records it and lets the journey go on. */
async function timed(j, tab, name, budget, fn) {
  const t0 = Date.now();
  let timer;
  try {
    const out = await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new StepError(`did not finish within ${STEP_LIMIT / 1000}s`)), STEP_LIMIT); })]);
    const ms = Date.now() - t0;
    j.steps.push({ name, ms, status: ms > budget ? 'SLOW' : 'OK' });
    if (ms > budget) j.degrade(`“${name}” took ${fmtS(ms)}, over its ${fmtS(budget)} budget`, await tab.where());
    return { ok: true, out };
  } catch (e) {
    const ms = Date.now() - t0;
    const why = e instanceof StepError ? e.message : `the check itself broke: ${e.message}`;
    j.steps.push({ name, ms, status: 'FAIL', why });
    return { ok: false, why, route: await tab.where() };
  } finally { clearTimeout(timer); }
}
async function step(j, tab, name, budget, fn) {
  const r = await timed(j, tab, name, budget, fn);
  if (!r.ok) { j.fail(name, r.route, r.why); throw STOP; }
  return r.out;
}

const unexpectedErrors = (list) => list.filter(e => !expected(e));

/* A figure on the page by its label: the label as the only text of an
   element, and the first number beside it within three levels. The
   calculator shows the same quantity under the same name wherever it
   draws it, so a label is a steadier handle than a position. */
const FIGURE = `(labels) => { for (const label of labels) {
  const lab = [...document.querySelectorAll('main *')].find(n => n.childElementCount === 0 && n.textContent.trim() === label && n.getClientRects().length);
  if (!lab) continue;
  let box = lab.parentElement;
  for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
    const v = [...box.querySelectorAll('.num, .stat-value')].find(x => x !== lab && /\\d/.test(x.textContent));
    if (v) return { label, value: v.textContent.trim() };
  }
} return null; }`;

/* ─── THE JOURNEYS ────────────────────────────────────────────────────────── */
const visible = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')`;
const byText = (sel, re) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(n => n.getClientRects().length && ${re}.test(n.textContent.trim()))`;

const JOURNEYS = [
  {
    id: 'equities', name: 'Equities: search, filed statements, watchlist',
    /* The seeded sample list already holds Apple, so a fresh browser's
       company page reads "On your watchlist" and there is nothing to add.
       The journey starts from one empty list of the reader's own — the state
       of a reader who has cleared the samples. */
    storage: () => ({ watchlists: [{ id: 'wl-journey', name: 'Journey list', ids: [], added: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), schema: 2 }], wlActive: 'wl-journey' }),
    async run(j, tab) {
      await step(j, tab, 'Open Equities Research', BUDGET.load, () => tab.goto('/research'));
      await step(j, tab, 'Search for “apple”', BUDGET.action, async () => {
        await tab.click(visible('[data-open-search]'), 'The search button');
        await tab.expect(`document.activeElement?.id === 'searchInput'`, 'the search box did not open with the cursor in it', 3000);
        await tab.S('Input.insertText', { text: 'apple' });
        await tab.expect(`[...document.querySelectorAll('#searchResults button')].some(b => /Apple/i.test(b.textContent) && b.textContent.includes('AAPL'))`,
          async () => `no result for Apple — the box lists: ${(await tab.text('#searchResults')).slice(0, 160).replace(/\s+/g, ' ')}`, 6000);
      });
      await step(j, tab, 'Open Apple’s company page', BUDGET.action, async () => {
        await tab.click(`[...document.querySelectorAll('#searchResults button')].find(b => /Apple/i.test(b.textContent) && b.textContent.includes('AAPL'))`, 'The Apple result');
        await tab.expect(`State.view === 'research' && /Apple/i.test(document.querySelector('main h1')?.textContent || '')`,
          async () => `the result did not open Apple's company page (view ${await tab.eval('State.view')})`);
      });
      await step(j, tab, 'Financials: the filed statements, and where a figure came from', BUDGET.action, async () => {
        await tab.click(byText('main [role=tab]', '/^Financials$/'), 'The Financials tab');
        await tab.expect(`document.querySelectorAll('main .stmt-table td.cell-sourced').length > 20`, 'the Financials tab shows no statement table');
        const latest = `(() => { const row = [...document.querySelectorAll('main .stmt-table tbody tr')].find(r => /^(Revenue|Total income)/.test((r.querySelector('.pin')?.textContent || '').trim()));
          const cells = row ? [...row.querySelectorAll('td.cell-sourced')].filter(td => /\\d/.test(td.textContent)) : []; return cells[cells.length - 1] || null; })()`;
        await tab.click(latest, 'The latest revenue figure');
        await tab.expect(`document.querySelector('#drawer')?.dataset.open === '1'`, 'selecting a figure opened no source');
        /* The source a filed figure must name: SEC EDGAR and the filer's CIK.
           Its XBRL concept is expected too, but a figure without one is still
           sourced — that is a degradation, not a broken path. */
        const src = await tab.text('#drawer');
        if (!/SEC EDGAR/.test(src) || !/CIK \d{6,}/.test(src)) throw new StepError(`the figure's source does not name SEC EDGAR and the filer's CIK: ${src.slice(0, 200).replace(/\s+/g, ' ')}`);
        if (!/XBRL concept\s+(us-gaap:)?[A-Z][A-Za-z]{6,}/.test(src)) j.degrade('the revenue figure\'s source names no XBRL concept', await tab.where());
        await tab.key('Escape');
      });
      await step(j, tab, 'Add to watchlist', BUDGET.action, async () => {
        const btn = `(document.getElementById('co-watch') || ${byText('main button', '/^Add to watchlist$/')})`;
        const said = await tab.eval(`(${btn})?.textContent.trim() || null`);
        if (!said) throw new StepError('the company page offers no watchlist action');
        if (!/^Add to watchlist$/.test(said)) throw new StepError(`the company page reads “${said}”, not “Add to watchlist”, for a company on no list of the reader's`);
        await tab.click(btn, 'Add to watchlist');
        await tab.expect(`/On your watchlist/.test((${btn})?.textContent || '') || /Added to/.test(document.getElementById('toast')?.textContent || '')`,
          'pressing Add to watchlist changed nothing on the page');
      });
      await step(j, tab, 'The watchlist lists it', BUDGET.action, async () => {
        await tab.click(visible('a[href="/my/watchlists"]'), 'The Watchlists link');
        await tab.expect(`State.view === 'watchlists'`, 'the Watchlists link did not open the watchlists');
        /* The only list in this browser is the reader's own (seeded above),
           so Apple listed on the page is Apple on that list, with its date. */
        await tab.expect(`/\\bAAPL\\s+Apple Inc\\.[^\\n]*\\d{4}-\\d{2}-\\d{2}/.test(document.querySelector('main').innerText)`,
          'the watchlists page does not list Apple, with the day it was added, on the reader\'s list');
      });
    },
  },
  {
    id: 'screener', name: 'Equities screener: filter, results, company',
    async run(j, tab) {
      const count = `(() => { const h = [...document.querySelectorAll('main h3')].find(x => /companies match/.test(x.textContent)); const m = h && /(\\d+) of (\\d+) compan(?:y|ies) match/.exec(h.textContent); return m ? +m[1] : null; })()`;
      let before;
      await step(j, tab, 'Open the screener', BUDGET.load, async () => {
        await tab.goto('/discover/screener');
        await tab.expect(`${count} !== null`, 'the screener states no result count');
        before = await tab.eval(count);
      });
      await step(j, tab, 'Filter: return on equity of at least 20', BUDGET.action, async () => {
        await tab.fill(`document.getElementById('crit-roe-min')`, '20', 'The return-on-equity minimum', { commit: true });
        await tab.expect(`(${count}) !== null && (${count}) !== ${before}`, async () => `the result count stayed at ${before} after the filter was set`);
        const after = await tab.eval(count);
        if (!(after < before)) throw new StepError(`a minimum raised the count from ${before} to ${after}`);
        if (after === 0) throw new StepError('the filter left no company to open');
        /* A lower count is not yet the filter the reader set: a screen that
           kept the companies BELOW the minimum lowers the count too. Every
           company listed must meet it — each one's return on equity as the
           screener itself reads it for the test (critValue), against the
           minimum the screen now holds, which must be the 20 typed. */
        const off = await tab.eval(`(() => {
          const sc = State.screen, min = sc?.crit?.roe?.min;
          if (min !== 20) return 'the screen holds a return-on-equity minimum of ' + JSON.stringify(min ?? null) + ', not the 20 typed';
          const all = [...new Set(BY_ID.values())];
          const tks = [...document.querySelectorAll('main table.dt tbody .tickerbtn .tk')].map(n => n.childNodes[0]?.textContent?.trim()).filter(Boolean);
          if (!tks.length) return 'the results list no company';
          const bad = tks.map(tk => { const row = all.find(r => r?.c?.tk === tk); const v = row ? critValue(row, 'roe', sc) : null;
            return isNum(v) && v >= min ? null : tk + ' (' + (isNum(v) ? v.toFixed(1) : 'none') + ')'; }).filter(Boolean);
          return bad.length ? bad.length + ' of the ' + tks.length + ' companies listed do not meet it: ' + bad.slice(0, 4).join(', ') : null; })()`);
        if (off) throw new StepError(`the filter is return on equity of at least 20, and ${off}`);
      });
      await step(j, tab, 'Open a result', BUDGET.action, async () => {
        const first = `document.querySelector('main table.dt tbody .tickerbtn')`;
        const tk = await tab.eval(`(${first})?.querySelector('.tk')?.childNodes[0]?.textContent?.trim() || null`);
        if (!tk) throw new StepError('the results list no company');
        await tab.click(first, `The first result (${tk})`);
        await tab.expect(`State.view === 'research' && (document.querySelector('main')?.innerText || '').includes(${JSON.stringify(tk)})`,
          async () => `opening ${tk} did not open its company page (view ${await tab.eval('State.view')})`);
      });
    },
  },
  {
    id: 'property', name: 'Property: calculate, change, save',
    async run(j, tab) {
      const fig = (labels) => tab.eval(`(${FIGURE})(${JSON.stringify(labels)})`);
      const read = async () => ({
        monthly: await fig(['Monthly position', 'Monthly cash flow']),
        cash: await fig(['Safe cash required', 'Cash required', 'Cash to complete']),
        yield: await fig(['Gross yield', 'Net yield']),
      });
      /* A calculator input by its label, so a regrouped page is still typed
         into by the name a reader reads. */
      const input = (re) => `(() => { const l = [...document.querySelectorAll('main label[for]')].find(x => ${re}.test(x.textContent.trim())); return l ? document.getElementById(l.htmlFor) : null; })()`;
      const set = async (re, v, what) => { await tab.fill(input(re), v, what, { commit: true }); await sleep(250); };
      /* The figures once the named ones have moved from `prev`, or as they
         stand after 4s — the page redraws a moment after a change commits. */
      const moved = async (prev, keys) => {
        const t0 = Date.now();
        let now;
        do { now = await read(); if (keys.every(k => now[k]?.value !== prev[k]?.value)) break; await sleep(150); } while (Date.now() - t0 < 4000);
        return now;
      };
      /* The gross yield is the annual rent over the price, so the figure the
         page shows can be held to what was typed, not only to being there. */
      const grossIs = (fig, rent, price) => fig?.label !== 'Gross yield' || fig.value === `${(rent * 12 / price * 100).toFixed(2)}%`;
      let first;
      await step(j, tab, 'Open the property calculator', BUDGET.load, () => tab.goto('/property/calculator'));
      await step(j, tab, 'Enter a price, a rent and a loan', BUDGET.action * 3, async () => {
        await set('/^Purchase price/', '600000', 'The purchase price');
        await set('/^Expected monthly rent/', '2600', 'The monthly rent');
        await set('/^Deposit \\(%\\)/', '10', 'The deposit, which sets the loan');
        first = await read();
        const missing = Object.entries(first).filter(([, v]) => !v).map(([k]) => ({ monthly: 'the monthly cash flow', cash: 'the cash required', yield: 'the yield' }[k]));
        if (missing.length) throw new StepError(`the calculator shows no ${missing.join(', no ')}`);
        if (!grossIs(first.yield, 2600, 600000)) throw new StepError(`the gross yield reads ${first.yield.value} for RM2,600 a month on RM600,000, not 5.20%`);
      });
      await step(j, tab, 'Change the rent: the cash flow and the yield move', BUDGET.action, async () => {
        await set('/^Expected monthly rent/', '3000', 'The monthly rent');
        const now = await moved(first, ['monthly', 'yield']);
        if (now.monthly?.value === first.monthly.value) throw new StepError(`the monthly cash flow stayed ${first.monthly.value} when the rent rose`);
        if (now.yield?.value === first.yield.value) throw new StepError(`the yield stayed ${first.yield.value} when the rent rose`);
        if (!grossIs(now.yield, 3000, 600000)) throw new StepError(`the gross yield reads ${now.yield.value} for RM3,000 a month on RM600,000, not 6.00%`);
        first = now;
      });
      await step(j, tab, 'Change the loan: the cash required moves', BUDGET.action, async () => {
        await set('/^Deposit \\(%\\)/', '30', 'The deposit, which sets the loan');
        const now = await moved(first, ['cash', 'monthly']);
        if (now.cash?.value === first.cash.value) throw new StepError(`the cash required stayed ${first.cash.value} when the deposit went from 10% to 30%`);
        if (now.monthly?.value === first.monthly.value) throw new StepError(`the monthly cash flow stayed ${first.monthly.value} when the loan shrank`);
      });
      const name = `Journey check ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      tab.prompt = name;
      let prompted = 0;
      await step(j, tab, 'Save the property', BUDGET.action, async () => {
        const before = tab.dialogs;
        await tab.click(byText('main button', '/^Save this (property|deal)$/'), 'Save this property');
        await sleep(400);
        prompted = tab.dialogs - before;
        await tab.expect(`/Saved/.test(document.getElementById('toast')?.textContent || '')`, 'pressing Save said nothing was saved', 4000);
      });
      await step(j, tab, 'It is listed with the saved properties', BUDGET.load, async () => {
        const models = await tab.eval(`ROUTES.some(r => r.path === '/property/models')`);
        if (models) {
          await tab.goto('/property/models');
        } else {
          /* Before the property store (the property owner's P-series) a saved
             deal is listed on Saved Models, the workspace. */
          await tab.click(visible('a[href="/my/workspace"]'), 'The Saved Models link');
          await tab.expect(`State.view === 'workspace'`, 'the Saved Models link did not open the saved models');
        }
        /* With the name the journey gave it, the saved property is found by
           that name. A save that asks for no name is found by the price that
           was typed (RM600,000, or RM600.0k as the tool's own suggested name
           writes it), which the sample deal (RM572,000) and no page heading
           carries — the word "Property" is on every property page, saved
           deal or none, so it proved nothing. */
        const want = prompted ? name : null;
        await tab.expect(want ? `(document.querySelector('main')?.innerText || '').includes(${JSON.stringify(want)})` : `/(?<![\\d.,])600(,000(?![\\d,])|(\\.0+)?k\\b)/i.test(document.querySelector('main')?.innerText || '')`,
          `the saved property${want ? ` “${want}”` : ' (asked for no name; looked for by its price, RM600,000)'} is not listed on ${models ? 'My properties' : 'Saved Models'}`);
      });
    },
  },
  {
    id: 'scanner', name: 'Scanner: build, save and evaluate a setup',
    async run(j, tab) {
      const synthetic = OWNER_MACHINE;
      if (synthetic) {
        /* LOCAL ONLY: a price history made in the page, from the engine's own
           fixture (a quiet series, a drift down, then a close through its
           averages), dated back from the session the engine expects to be
           held now, so the series is current and its last bar is the match.
           It is served to the page in place of data/price-history.json; the
           real file, if there is one, is never read. */
        await step(j, tab, 'Prepare a synthetic price history (local run only)', BUDGET.load, async () => {
          await tab.goto('/privacy', { data: false });
          tab.history = await tab.eval(`(() => {
            const { history } = scanFixture();
            const closes = Object.values(history.series.MATCH), vols = Object.values(history.volume.MATCH);
            const mk = scanRegistry(scanRegistryList()).get('AAPL')?.market || null;
            const expected = scanExpectedLastSession(scanWeekdayCalendar(mk), mk, new Date().toISOString());
            const dates = [];
            for (let d = expected; dates.length < closes.length; d = scanAddDays(d, -1)) if (scanWeekday(d) >= 1 && scanWeekday(d) <= 5) dates.unshift(d);
            const s = (arr) => Object.fromEntries(dates.map((d, i) => [d, arr[i]]));
            return JSON.stringify({ generated: new Date().toISOString(), source: 'synthetic — journeys.mjs, from the engine fixture', series: { AAPL: s(closes) }, volume: { AAPL: s(vols) } });
          })()`);
        });
      }
      const setupName = 'Journey check EMA 20 cross';
      await step(j, tab, 'Open the setup builder', BUDGET.load, () => tab.goto('/app/scanner/setups/new'));
      await step(j, tab, 'Build a condition: price crosses above its 20-bar EMA, on AAPL', BUDGET.action * 2, async () => {
        await tab.fill(`document.querySelector('main input[aria-label="Name"]')`, setupName, 'The setup’s name');
        await tab.fill(`[...document.querySelectorAll('main input')].find(n => /^Instruments/.test(n.getAttribute('aria-label') || ''))`, 'AAPL', 'The instruments');
        await tab.fill(`[...document.querySelectorAll('main input[type=number]')].find(n => /^Condition 1: right side (?!multiplier|value)/.test(n.getAttribute('aria-label') || ''))`, '20', 'The average’s length');
        await tab.expect(`/crosses above/i.test(document.querySelector('main .scan-prose')?.textContent || '') && /EMA\\s?20\\b/.test(document.querySelector('main .scan-prose')?.textContent || '')`,
          async () => `the condition reads “${await tab.eval(`document.querySelector('main .scan-prose')?.textContent || ''`)}”`);
        await tab.expect(`/^Ready to save/.test(document.querySelector('main .scan-status')?.textContent || '')`,
          async () => `the builder is not ready to save: ${await tab.eval(`document.querySelector('main .scan-status')?.textContent || ''`)} ${await tab.eval(`document.querySelector('main .scan-problems-all')?.innerText || ''`)}`);
      });
      await step(j, tab, 'Save the setup', BUDGET.action, async () => {
        await tab.click(`[...document.querySelectorAll('main button')].find(b => b.getAttribute('aria-label') === 'Save as version 1')`, 'Save');
        await tab.expect(`State.view === 'scannerSetup'`, async () => `Save did not open the setup's page (${await tab.eval(`document.getElementById('toast')?.textContent || State.view`)})`);
      });
      await step(j, tab, 'The setup’s page shows it', BUDGET.action, async () => {
        await tab.expect(`(document.querySelector('main h1')?.textContent || '').includes(${JSON.stringify(setupName)})`, 'the setup page is not headed with the setup’s name');
        const t = await tab.text();
        if (!/v1/.test(t)) throw new StepError('the setup page shows no version 1');
        if (!/crosses above/i.test(t) || !/EMA|exponential/i.test(t)) throw new StepError('the setup page does not show the condition that was saved');
        /* The condition as it was built, length and all: a save that kept the
           builder's default 50-bar average shows "crosses above" and "EMA"
           too, and on the deployed site nothing after this step would see
           the difference. */
        if (!/crosses above (the )?EMA\s?20\b/i.test(t)) {
          const said = (t.match(/[^\n]*crosses above[^\n]*/i) || [''])[0].trim();
          throw new StepError(`the setup page shows the condition as “${said.slice(0, 80)}”, not the 20-bar EMA that was built`);
        }
      });
      await step(j, tab, synthetic ? 'Evaluate it: a match on the synthetic history' : 'Evaluate it: the page says there is no price history here', BUDGET.action * 2, async () => {
        await tab.click(`[...document.querySelectorAll('main a')].find(a => a.textContent.trim() === 'Edit')`, 'Edit');
        await tab.expect(`State.view === 'scannerSetupEdit'`, 'Edit did not open the setup in the builder');
        const test = `[...document.querySelectorAll('main button')].find(b => b.getAttribute('aria-label') === 'Test against your history (not recorded)')`;
        await tab.expect(`!!(${test})`, 'the setup offers no way to evaluate it');
        const disabled = await tab.eval(`(${test}).disabled`);
        if (!synthetic) {
          /* No worker, no history, on the deployed site: the truthful answer
             is that there is nothing to evaluate here, said beside the
             control that cannot run. */
          if (!disabled) throw new StepError('Test is offered where no price history is loaded');
          const said = await tab.text();
          if (!/No price history is loaded here/.test(said)) throw new StepError('Test is switched off and the page does not say why');
          return;
        }
        if (disabled) throw new StepError('Test is switched off although a price history is loaded');
        await tab.click(test, 'Test against your history');
        await tab.expect(`/\\b1 match\\b/.test(document.querySelector('main .scan-test-out')?.innerText || '') && /\\bAAPL\\b/.test(document.querySelector('main .scan-test-out')?.innerText || '')`,
          async () => `the evaluation did not show the match: ${(await tab.text('.scan-test-out')).slice(0, 240).replace(/\s+/g, ' ')}`);
      });
    },
  },
  {
    id: 'ctas', name: 'Primary calls to action land on working pages',
    async run(j, tab) {
      const failures = [];
      let checked = 0;
      /* Served as a first visit would be: 200, or a redirect on this site to
         a page that is — and the address it ends at. */
      const served = async (href) => {
        let url = new URL(href, BASE + '/').href;
        for (let hop = 0; hop < 3; hop++) {
          const r = await fetch(url, { redirect: 'manual' }).catch(e => ({ status: 0, error: e.message }));
          if ([301, 302, 307, 308].includes(r.status)) { url = new URL(r.headers.get('location'), url).href; continue; }
          return { status: r.status, path: new URL(url).pathname };
        }
        return { status: 'a redirect loop', path: null };
      };
      /* One press, and the page it lands on: the address the call to action
         names (or the one the site redirects that address to), drawn by the
         app as a page that is not the not-found card, with something in it,
         logging no error, and served 200. A press that leaves the reader
         where they were is a call to action that goes nowhere, whatever its
         href says — the page it stays on is a working page, which is why
         the address is held to, not only the page. A failure here is
         recorded and the rest are still pressed, so one run names every
         broken call to action. */
      const press = async (source, find, label, stepName) => {
        const errsAt = tab.errors.length;
        const from = await tab.where() || source;
        const href = await tab.eval(`(${find})?.getAttribute('href') || null`).catch(() => null);
        const r = await timed(j, tab, stepName, BUDGET.action, async () => {
          if (!href) throw new StepError(`“${label}” on ${source} is not a link`);
          const target = new URL(href, BASE + '/').pathname;
          const fin = await served(href);
          const want = [...new Set([target, fin.path].filter(Boolean))];
          await tab.click(find, `“${label}”`);
          await tab.waitFor(`${JSON.stringify(want)}.includes(location.pathname)`, 6000);
          await tab.waitFor(`typeof realPending !== 'undefined' && !realPending && !!State.view`, 15000);
          await sleep(400);
          const at = await tab.eval(`({ view: State.view, path: location.pathname + location.search, pathname: location.pathname, len: (document.querySelector('main')?.innerText || '').trim().length })`);
          if (!want.includes(at.pathname)) {
            throw new StepError(at.pathname === new URL(from, BASE + '/').pathname
              ? `“${label}” (${href}) goes nowhere: pressed, it left the reader on ${at.path}`
              : `“${label}” (${href}) lands on ${at.path}, not on ${want.join(' or ')}`);
          }
          if (at.view === 'notfound') throw new StepError(`“${label}” (${href}) lands on the not-found card at ${at.path}`);
          if (at.len < 80) throw new StepError(`“${label}” (${href}) lands on an empty page at ${at.path}`);
          const errs = unexpectedErrors(tab.errors.slice(errsAt));
          if (errs.length) throw new StepError(`“${label}” (${href}) logs ${errs.length} error(s) at ${at.path}: ${errs[0].text}`);
          if (fin.status !== 200) throw new StepError(`“${label}” links to ${href}, which is served ${fin.status}`);
        });
        if (r.ok) checked++;
        else failures.push({ step: stepName, route: r.route, why: r.why });
      };
      /* The product cards under "What would you like to do?" — not the
         disclosure line's link beside them, which is not a card. */
      const CARDS = '#products a.pub-card[href], #products .pub-cards a[href]';
      /* A control's name as a reader reads it: a card's or a link's heading
         where it has one, else its text. */
      const LABEL = `(n) => (n.querySelector('h3, strong')?.textContent || n.textContent).trim().replace(/\\s+/g, ' ').slice(0, 60)`;
      const list = (sel) => tab.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(n => n.getClientRects().length).map(${LABEL})`);

      /* The pages the calls to action are pressed FROM. press() judges the
         page each one lands on; an error logged while a source page loads
         was judged by nothing — the homepage could throw on every load and
         all five journeys passed, since no call to action lands on it. It
         is a part of the path the press does not need, so it degrades the
         journey (DEGRADED, the page named) rather than failing a press. */
      const sourceErrs = new Map();
      const load = async (path) => {
        const at = tab.errors.length;
        try { await tab.goto(path); } finally {
          const errs = unexpectedErrors(tab.errors.slice(at));
          if (errs.length && !sourceErrs.has(path)) sourceErrs.set(path, `${errs.length} error(s) logged while ${path} loaded: ${errs[0].text}`);
        }
      };

      /* The dashboard first, while this browser holds nothing of its own:
         the first-time checklist is what a new reader sees. */
      await step(j, tab, 'Open My Dashboard', BUDGET.load, () => load('/app'));
      const steps = await list('main .dash-steps a[href], main .dash-more a[href]');
      if (!steps.length) failures.push({ step: 'Open My Dashboard', route: '/app', why: 'the dashboard shows no checklist actions to a first-time reader' });
      for (let i = 0; i < steps.length; i++) {
        await load('/app').catch(() => {});
        await press('/app', `[...document.querySelectorAll('main .dash-steps a[href], main .dash-more a[href]')].filter(n => n.getClientRects().length)[${i}]`, steps[i], `Dashboard checklist “${steps[i]}”`);
      }

      await load('/').catch(() => {});
      await press('/', visible('a.pub-cta'), 'Open workspace', 'The header’s “Open workspace”');

      await load('/').catch(() => {});
      const cards = await list(CARDS);
      if (!cards.length) failures.push({ step: 'Homepage cards', route: '/', why: 'the homepage shows no product card that opens anything' });
      for (let i = 0; i < cards.length; i++) {
        await load('/').catch(() => {});
        await press('/', `[...document.querySelectorAll(${JSON.stringify(CARDS)})].filter(n => n.getClientRects().length)[${i}]`, cards[i], `Homepage card “${cards[i]}”`);
      }

      /* Each product's own row of tabs, pressed along the row as a reader
         moves through a product. */
      for (const [product, source] of [['Equities', '/research'], ['Property', '/property/calculator'], ['Scanner', '/app/scanner']]) {
        await load(source).catch(() => {});
        const tabs = await list('nav.ptabs a[href]');
        if (!tabs.length) { failures.push({ step: `${product} tabs`, route: source, why: `no row of product tabs on ${source}` }); continue; }
        for (let i = 0; i < tabs.length; i++) {
          const find = `[...document.querySelectorAll('nav.ptabs a[href]')].filter(n => n.getClientRects().length).find(n => (${LABEL})(n) === ${JSON.stringify(tabs[i])})`;
          if (!await tab.eval(`!!(${find})`)) await load(source).catch(() => {});
          await press(source, find, tabs[i], `${product} tab “${tabs[i]}”`);
        }
      }
      /* Every call to action was pressed; the first that failed is the
         journey's failing step, and the note names them all. */
      if (failures.length) {
        j.fail(failures[0].step, failures[0].route,
          `${failures.length} of ${checked + failures.length} calls to action failed — ${failures.map(f => `${f.step}: ${f.why}`).join(' · ')}`);
        sourceErrs.forEach(why => j.notes.push(why));
      } else {
        sourceErrs.forEach((why, path) => j.degrade(why, path));
        j.notes.push(`${checked} calls to action pressed, each landing on a working page`);
      }
    },
    /* A console error on a page a call to action lands on is that call
       to action failing, so it is judged there (press); one on a page they
       are pressed from degrades the journey (load, above). Neither is
       judged again at the end. */
    errorsJudged: true,
  },
];

/* ─── RUN ─────────────────────────────────────────────────────────────────── */
async function main() {
  const ranAt = new Date().toISOString();
  const who = await commitServed();
  const todo = JOURNEYS.filter(x => !ONLY.length || ONLY.includes(x.id));
  if (!todo.length) { console.error(`no journey is called ${ONLY.join(', ')} — they are ${JOURNEYS.map(x => x.id).join(', ')}`); process.exit(2); }
  console.log(`journeys against ${BASE}${who.commit ? ` — commit ${who.commit.slice(0, 12)} (${who.commitFrom})` : ` — ${who.commitFrom}`}${OWNER_MACHINE ? ' — the personal lane answered 404 in the browser; the scanner reads a synthetic history' : ''}`);
  let browser;
  try { browser = await startBrowser(); }
  catch (e) { console.error(`FAIL  ${e.message}`); process.exit(2); }
  const results = [];
  try {
    for (const def of todo) {
      const j = new Journey(def.id, def.name);
      const t0 = Date.now();
      let tab = null;
      try {
        tab = await openTab(browser, { storage: def.storage ? def.storage() : null });
        await def.run(j, tab);
      } catch (e) {
        if (e !== STOP) j.fail(j.steps.length ? j.steps[j.steps.length - 1].name : 'Start', tab ? await tab.where() : null, `the check itself broke: ${e.message}`);
      }
      j.ms = Date.now() - t0;
      if (tab && !def.errorsJudged && j.status !== 'FAIL') {
        const errs = unexpectedErrors(tab.errors);
        if (errs.length) j.degrade(`${errs.length} error(s) logged along the way: ${errs.slice(0, 2).map(e => e.text).join(' | ')}`);
      }
      if (tab) await tab.close();
      results.push(j);
      const tag = j.status.padEnd(9);
      console.log(`${tag} ${j.id.padEnd(9)} ${j.name}  ${fmtS(j.ms)}`);
      if (j.status === 'FAIL') console.log(`          failed at “${j.failedStep}” on ${j.route || 'no page'}: ${j.notes[0]}`);
      else if (j.notes.length) console.log(`          ${j.notes.join(' · ')}`);
    }
  } finally { await browser.close(); }

  const doc = { kind: RESULT_KIND, schema: 1, ranAt, url: BASE, commit: who.commit, commitFrom: who.commitFrom, journeys: results.map(r => r.toJSON()) };
  const problem = resultProblem(doc);
  if (problem) { console.error(`FAIL  the result is not a valid result: ${problem}`); process.exit(2); }
  if (has('json')) {
    const f = flag('json');
    if (f) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(doc, null, 2) + '\n'); console.log(`wrote ${f}`); }
    else process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
  }
  const md = flag('markdown');
  if (md) { mkdirSync(dirname(md), { recursive: true }); writeFileSync(md, markdown(doc)); console.log(`wrote ${md}`); }
  const n = (s) => results.filter(r => r.status === s).length;
  console.log(`\n${n('PASS')} pass, ${n('DEGRADED')} degraded, ${n('FAIL')} fail — ${results.length} journeys against ${BASE}`);
  process.exit(n('FAIL') ? 1 : 0);
}

await main();
