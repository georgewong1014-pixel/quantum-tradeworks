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
 *   --only <id,id>       some journeys: equities, screener, compare, property, lab, scanner, ctas
 *   --trigger <what>     what started the run, recorded: deployment, schedule or dispatch
 *   --run <url>          the Actions run that made the result, recorded (its public log)
 *   --decide <recorded.json> <new.json> [--trigger <what>] [--deployed-files <list.txt>]
 *            [--deployed-author <name>]
 *                        offline: should the new result be committed over the recorded one?
 *                        After a deployment the list is the paths the deployed commit changed
 *                        and the author is its author: a commit that changed only the record
 *                        (and, by github-actions[bot], the island pages) serves the same app
 *                        as the deployment before it, and nothing is committed
 *                        Prints commit=, why=, fails=, degraded=, all_pass= lines (GITHUB_OUTPUT)
 *   --guard              offline: the working tree changes nothing but the record and the
 *                        island pages (ISLAND_PAGES), or exit 1 naming what else it changes
 *   --self-test          offline: the commit rule, the result's shape, the table, the served
 *                        result (journeysServed) and the guard, on fixtures, and the workflows
 *                        that apply them (concurrency, inputs, permissions, the bot's commit)
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
 * a list; filter the screener and open what it found; compare two filed
 * companies, save the comparison and reopen it; model a property,
 * change it, save it; build a scanner setup, save it and have it evaluated;
 * press each primary call to action — in real Chrome, by real clicks and key
 * presses, and it passes only when the whole path completes: entry → valid
 * input → calculation or data → a meaningful result → the save or next
 * action. A page that renders and a button that does nothing is a FAIL here.
 *
 * WHAT PROVES A LIVE BADGE (D15, the owner's decision of 6 Oct 2026)
 *
 * An outcome step: an action, and the result it must produce, checked. Each
 * journey names its outcome steps (outcomes, below; OUTCOME_STEPS); a step
 * that only opens a page is not one, and the calls-to-action journey, which
 * lands on every tool and does nothing there, has none. A 'live' row of
 * PRODUCTS or TOOLS (35-ui.js) names its journey and outcome step (proof), or
 * says it is not yet proven (proof: null) — and /status lists it so, beside
 * the Live badge it keeps; register-check holds every row to that.
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
/* Imported (build.mjs reads journeysServed and ISLAND_PAGES), nothing below
   runs: only `node journeys.mjs …` parses arguments, starts a browser or
   reads a result. */
const MAIN = /journeys\.mjs$/.test(process.argv[1] || '');
const argv = MAIN ? process.argv.slice(2) : [];
const has = (n) => argv.includes(`--${n}`);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ─── THE RESULT FILE ─────────────────────────────────────────────────────── */
export const RESULT_KIND = 'quantum-tradeworks-journeys';
export const STATUSES = ['PASS', 'DEGRADED', 'FAIL'];
/* What started a run (N1b, the 5 Oct audit): a production deployment, the
   schedule, or a person (workflow_dispatch). Recorded with the result. */
export const TRIGGERS = ['deployment', 'schedule', 'dispatch'];
export const triggerOf = (event) => ({ deployment_status: 'deployment', schedule: 'schedule', workflow_dispatch: 'dispatch' })[event] || null;
/* The public log of the run that made a result: an Actions run of this
   repository's workflow, and nothing else, is linked from the served page. */
export const RUN_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/;
/* With no trigger named (a run decided by hand, an older workflow), a
   recorded run is refreshed once a day even when nothing changed. */
export const REFRESH_MS = 24 * 3600 * 1000;

/* What the page and the workflow both hold a result to. The page has its own
   copy of this rule (91-health.js, healthResultProblem); the self-test below
   and the /status block in sweep.mjs hold the two to the same fixtures.
   run, trigger and a step's gated (N1b) are optional — a record written
   before them is still a record — but one that is there must be what it
   says. */
export function resultProblem(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'not an object';
  if (doc.kind !== RESULT_KIND) return `kind is ${JSON.stringify(doc.kind)}, not ${RESULT_KIND}`;
  if (doc.ranAt == null && Array.isArray(doc.journeys) && !doc.journeys.length) return null;   /* the placeholder: no run yet */
  if (typeof doc.ranAt !== 'string' || !Number.isFinite(Date.parse(doc.ranAt))) return 'ranAt is not a date';
  if (doc.run != null && !RUN_URL.test(String(doc.run))) return `run is ${JSON.stringify(doc.run)}, not an Actions run's address`;
  if (doc.trigger != null && !TRIGGERS.includes(doc.trigger)) return `trigger is ${JSON.stringify(doc.trigger)}, not ${TRIGGERS.join(', ')}`;
  if (!Array.isArray(doc.journeys) || !doc.journeys.length) return 'it lists no journeys';
  for (const j of doc.journeys) {
    if (!j || typeof j.id !== 'string' || typeof j.name !== 'string') return 'a journey has no id or name';
    if (!STATUSES.includes(j.status)) return `journey ${j.id} has status ${JSON.stringify(j.status)}`;
    if (j.status === 'FAIL' && (typeof j.failedStep !== 'string' || !j.failedStep)) return `journey ${j.id} failed at no named step`;
    if (j.ms != null && !Number.isFinite(j.ms)) return `journey ${j.id} has a time that is not a number`;
    if (j.steps != null && !Array.isArray(j.steps)) return `journey ${j.id} has steps that are not a list`;
    for (const s of j.steps || []) {
      if (!s || typeof s.name !== 'string' || !['OK', 'SLOW', 'FAIL'].includes(s.status)) return `journey ${j.id} has a step with no name or a status outside OK, SLOW and FAIL`;
      if (s.gated != null && (typeof s.gated !== 'string' || !s.gated.trim() || s.status === 'FAIL')) return `journey ${j.id}: step "${s.name}" is gated with no reason, or gated and failed`;
    }
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

/* THE ISLAND PAGES (N1c–N1e, the 5 Oct audit). The served pages that carry
   the recorded result in their HTML, so a fetch that runs no script reads it:
   /status's journeys block, and the one line beside the product's badge on
   the three product landing pages. build.mjs fills them from the committed
   health/journeys.json (journeysServed, below), and the workflow commits
   them with the record, rebuilt — so they change with every record, and no
   other page does: the line is never in a tab row, which every page of a
   product carries. */
export const ISLAND_PAGES = ['pages/status.html', 'pages/property.html', 'pages/research.html', 'pages/app/scanner.html'];
export const RECORD_FILE = 'health/journeys.json';
/* The page a commit serves at /: the file its vercel.json rewrites / to
   (pages/home.app.html since plan item 1.2, build.mjs HOME), or index.html
   where nothing rewrites / (every commit before 1.2). WHICH COMMIT IS
   SERVED, below, matches the served build by it. */
export const rootPageOf = (vercelJson) => { try { return JSON.parse(vercelJson).rewrites?.find(r => r.source === '/')?.destination?.replace(/^\//, '') || 'index.html'; } catch { return 'index.html'; } };
export const ROOT_PAGES = ['pages/home.app.html', 'index.html'];
export const BOT = 'github-actions[bot]';

/* WHAT THE RECORD SAYS, AND WHEN (D16, the owner's decision of 5 Oct 2026).
   It said whether a status changed, and refreshed the record once a day
   otherwise: three code deployments in a row (ee173ce, 4a6b6e5, 75312b2)
   passed their journeys and none was recorded, and the 03:17 schedule,
   started six or seven hours late, could leave a record 48 hours old. Now:
   - after every production deployment that changes the app, the result is
     recorded: it is the result of the build being served;
   - every scheduled run (twice a day) is recorded, and so is a run started
     by hand — a person asked for it;
   - NEVER FROM THE DEPLOYMENT OF ITS OWN RECORD. The record is committed and
     deployed, and that deployment runs the journeys again. A commit that
     changed nothing but the record — and, written by the workflow itself
     (github-actions[bot]), the island pages rebuilt from it — serves the same
     app as the deployment before it, so its run is not news about the site:
     it still reports (the summary, the issue), but it records nothing, and a
     status that flaps (a step a second over budget, DEGRADED then PASS)
     cannot loop. The island pages count as the record's only when the bot
     wrote them: a person's commit that changes /status is a deployment of
     the app like any other.
   - A deployment whose changed files are not known records nothing: it
     cannot be told from the deployment of a record.
   With no trigger named, the old rule stands: a status or a failing step
   changed, or the record is a day old. */
export const ownRecord = (files, author = null) => Array.isArray(files) && files.length > 0
  && files.every(f => f === RECORD_FILE || /^health\//.test(f) || (author === BOT && ISLAND_PAGES.includes(f)));
export function decide(recorded, fresh, now = Date.now(), { deployedFiles = null, deployedAuthor = null, trigger = null } = {}) {
  const p = resultProblem(fresh);
  if (p || !hasRun(fresh)) return { commit: false, why: `the new result cannot be recorded: ${p || 'it holds no run'}` };
  if (ownRecord(deployedFiles, deployedAuthor)) return { commit: false, why: `this run tested the deployment of a commit that changed only ${deployedFiles.join(', ')}${deployedAuthor ? ` (by ${deployedAuthor})` : ''} — the record, served with the same app as the deployment before it — so it records nothing: a status that differs on this run waits for the next scheduled run or code deployment, and a flapping status cannot loop` };
  if (trigger === 'deployment') {
    if (!Array.isArray(deployedFiles) || !deployedFiles.length) return { commit: false, why: 'this run followed a deployment whose changed files are not known, so it cannot be told from the deployment of a record: it records nothing' };
    return { commit: true, why: `the deployment of a commit that changed the app (${deployedFiles.length} file${deployedFiles.length === 1 ? '' : 's'}${deployedFiles.length <= 3 ? `: ${deployedFiles.join(', ')}` : `, ${deployedFiles.slice(0, 3).join(', ')} among them`}): its result is recorded` };
  }
  if (trigger === 'schedule') return { commit: true, why: 'a scheduled run: every scheduled run is recorded' };
  if (trigger === 'dispatch') return { commit: true, why: 'a run started by hand: it is recorded' };
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

/* THE BOT COMMITS THE RECORD AND ITS PAGES, AND NOTHING ELSE (N1d). After
   copying the record the workflow runs node build.mjs, which rewrites the
   island pages from it; anything else the build changes means main was not
   built from its own source, and that is not the bot's to commit. The paths
   are git's (status --porcelain), one a line; returns what may not be
   committed. */
export function guardProblems(changed) {
  const allowed = new Set([RECORD_FILE, ...ISLAND_PAGES]);
  return changed.filter(f => !allowed.has(f));
}

/* ─── THE RESULT, SERVED (N1c, N1e) ───────────────────────────────────────── */
/* ONE RENDERER. /status drew the journeys' result only in the reader's
   browser, from a fetch: served, the block said "Read from the site by this
   page's script.", so a fetch of the page — a crawler, an auditor's curl —
   read no result, no time and no commit (the 5 Oct audit, #1). Now the
   build writes the committed record into the served /status and the three
   product landing pages with this function, and the page's script draws the
   same words with the same function: build.mjs puts its source into the app
   in place of the marker in 91-health.js, so the served words and the drawn
   ones cannot part. It is pure and self-contained for that reason — it reads
   nothing outside itself — and it writes only escaped text, the record's
   own Actions run link and links to /status.
   Times are UTC, so a page served to anyone, anywhere, and the same page
   drawn in their browser, say one thing. What it returns:
     sum    the inner HTML of #health-journeys-sum: "Last recorded run
            <date, time UTC> on <sha>: N of N pass · public log"
     list   the inner HTML of #health-journeys: one li per journey, its
            result, and every step marked OK, FAIL or gated
     lines  the inner HTML of each product landing page's line, by address:
            "Journey: <name> · PASS · <time UTC> · <sha> · details"
     proof  proof(journey, step): the inner HTML of a Live badge's result on
            /status (D15, plan item 2.6) — the journey's last recorded
            result and what that run made of the badge's outcome step:
            "PASS · outcome step OK · <date, time UTC> · details" */
export function journeysServed(doc) {
  const REPO = 'https://github.com/georgewong1014-pixel/quantum-tradeworks';
  const LINES = { '/property': 'property', '/research': 'equities', '/app/scanner': 'scanner' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STATE = { PASS: ['chip-ok', 'Pass'], DEGRADED: ['chip-warn', 'Degraded'], FAIL: ['chip-critical', 'Fail'] };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const two = (n) => (n < 10 ? '0' : '') + n;
  const empty = { recorded: false, sum: 'Not run yet. No run of the journeys has been recorded for this site, so there is no result to show.', list: '', lines: {},
    proof: () => 'No recorded run to show.' };
  Object.keys(LINES).forEach(k => { empty.lines[k] = ''; });
  const at = doc && typeof doc.ranAt === 'string' ? new Date(doc.ranAt) : null;
  const list = doc && Array.isArray(doc.journeys) ? doc.journeys.filter(j => j && typeof j.id === 'string' && typeof j.name === 'string' && STATE[j.status]) : [];
  if (!at || !Number.isFinite(at.getTime()) || !list.length) return empty;
  const day = at.getUTCDate() + ' ' + MONTHS[at.getUTCMonth()];
  const time = two(at.getUTCHours()) + ':' + two(at.getUTCMinutes()) + ' UTC';
  const sha = /^[0-9a-f]{7,40}$/.test(String(doc.commit || '')) ? String(doc.commit).slice(0, 7) : null;
  const run = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(String(doc.run || '')) ? String(doc.run) : null;
  const n = (s) => list.filter(j => j.status === s).length;
  const tally = n('PASS') + ' of ' + list.length + ' pass' + (n('DEGRADED') ? ', ' + n('DEGRADED') + ' degraded' : '') + (n('FAIL') ? ', ' + n('FAIL') + ' failed' : '');
  const log = run ? '<a class="journeys-log" href="' + esc(run) + '">public log</a>'
    : '<a class="journeys-log" href="' + REPO + '/actions/workflows/journeys.yml">public run history</a>';
  const sum = 'Last recorded run ' + day + ' ' + at.getUTCFullYear() + ', ' + time + (sha ? ' on ' + sha : ', its commit not identified') + ': ' + tally + ' · ' + log;
  const idOf = (j) => 'journey-' + j.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  /* A step that passes by checking an honest refusal — the scanner's
     evaluate step on the live site, which holds the page to saying there is
     no price history, because none ships — is "gated", with its reason. */
  const mark = (s) => (s.status === 'FAIL' ? 'FAIL' : s.gated ? 'gated' : 'OK');
  const steps = (j) => (Array.isArray(j.steps) ? j.steps : []).filter(s => s && typeof s.name === 'string' && ['OK', 'SLOW', 'FAIL'].includes(s.status));
  const items = list.map(j => {
    const detail = j.status === 'FAIL' ? 'Failed at “' + j.failedStep + '”' + (j.route ? ' on ' + j.route : '') + '.' + (j.note ? ' ' + j.note : '')
      : j.note || (j.status === 'PASS' ? 'Completed, each step within its time budget.' : 'Completed, but degraded; the recorded run gives no reason.');
    const st = steps(j);
    return '<li class="journey-row" id="' + idOf(j) + '" data-status="' + j.status + '">'
      + '<span class="chip health-chip ' + STATE[j.status][0] + '">' + STATE[j.status][1] + '</span>'
      + '<p class="journey-name">' + esc(j.name) + '</p>'
      + '<div class="journey-body"><p class="caption">' + esc(detail) + '</p>'
      + (st.length ? '<ol class="journey-steps" aria-label="' + esc(j.name) + ': each step">' + st.map(s => '<li data-mark="' + mark(s).toLowerCase() + '">'
        + '<span class="journey-mark">' + mark(s) + '</span> ' + esc(s.name)
        + (s.gated ? '<span class="journey-why"> — ' + esc(s.gated) + '</span>' : s.status === 'SLOW' ? '<span class="journey-why"> — over its time budget</span>' : s.status === 'FAIL' && s.why ? '<span class="journey-why"> — ' + esc(s.why) + '</span>' : '')
        + '</li>').join('') + '</ol>' : '')
      + '</div></li>';
  }).join('');
  const lines = {};
  Object.keys(LINES).forEach(path => {
    const j = list.find(x => x.id === LINES[path]);
    if (!j) { lines[path] = ''; return; }
    const gated = steps(j).filter(s => s.gated && s.status !== 'FAIL')
      .map(s => ' · ' + esc(s.name.split(':')[0].replace(/\s+it$/i, '').toLowerCase()) + ': gated (' + esc(s.gated) + ')').join('');
    lines[path] = '<span class="journey-line-label">Journey:</span> ' + esc(j.name) + ' · ' + j.status
      + (j.status === 'FAIL' ? ' at “' + esc(j.failedStep) + '”' : '') + gated + ' · ' + day + ' ' + time
      + (sha ? ' · ' + sha : '') + ' · <a class="journey-line-link" href="/status#' + idOf(j) + '">details</a>';
  });
  /* A LIVE BADGE BESIDE ITS JOURNEY'S LAST RESULT (D15, plan item 2.6). The
     journey's status, and the badge's outcome step as that run recorded it:
     OK, FAIL or gated; "not reached" where the journey failed before it;
     "not in the recorded run" where the run has no step of that name (a
     journey recorded before the step was written). A journey the run did
     not include says so — nothing is carried over from an older run. */
  const proof = (id, stepName) => {
    const j = list.find(x => x.id === id);
    if (!j) return 'Not in the last recorded run.';
    const s = steps(j).find(x => x.name === stepName);
    const said = s ? 'outcome step ' + mark(s) : j.status === 'FAIL' ? 'outcome step not reached' : 'outcome step not in the recorded run';
    return '<span class="proof-status" data-status="' + j.status + '">' + j.status + '</span>'
      + (j.status === 'FAIL' ? ' at “' + esc(j.failedStep) + '”' : '') + ' · ' + said + ' · ' + day + ' ' + at.getUTCFullYear() + ', ' + time
      + ' · <a class="journey-line-link" href="#' + idOf(j) + '">details</a>';
  };
  return { recorded: true, sum, list: items, lines, proof };
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
  t(decide(pass, flap, now, { deployedFiles: [] }).commit === true && decide(pass, flap, now).commit === true, 'with no trigger and no list of the deployed files, the old rule: a changed status is committed');
  /* D16 (the owner's decision of 5 Oct 2026): every production deployment
     that changes the app, and every scheduled run, is recorded — the same
     statuses as a record two hours old included — and the deployment of the
     record's own commit still records nothing. */
  const BOT_FILES = ['health/journeys.json', ...ISLAND_PAGES];
  const code = decide(pass, pass2, now, { trigger: 'deployment', deployedFiles: ['src/js/91-health.js', 'index.html', 'assets/app.0123456789ab.js'], deployedAuthor: 'MCD' });
  t(code.commit === true, `D16: a code deployment records its result, the same statuses as a record 2h old included (${code.why.slice(0, 70)}…)`);
  t(decide(pass, pass2, now, { trigger: 'schedule' }).commit === true, 'D16: a scheduled run records its result, the same statuses as a record 2h old included');
  t(decide(pass, pass2, now, { trigger: 'dispatch' }).commit === true, 'D16: a run started by hand records its result');
  t(decide(pass, flap, now, { trigger: 'deployment', deployedFiles: BOT_FILES, deployedAuthor: BOT }).commit === false, 'D16: a record-only commit by the bot (the record and the island pages it rebuilt) records nothing, even when a status flapped (no loop)');
  t(decide(pass, flap, now, { trigger: 'deployment', deployedFiles: ['health/journeys.json'], deployedAuthor: 'MCD' }).commit === false, 'D16: a commit of the record alone records nothing, whoever wrote it');
  t(decide(pass, pass2, now, { trigger: 'deployment', deployedFiles: ['health/journeys.json', 'pages/status.html'], deployedAuthor: 'MCD' }).commit === true, 'D16: the island pages count as the record\'s only from github-actions[bot]: a person\'s commit to /status is a code deployment');
  t(decide(pass, pass2, now, { trigger: 'deployment', deployedFiles: [...BOT_FILES, 'src/js/91-health.js'], deployedAuthor: BOT }).commit === true, 'D16: a bot commit that also changed the app is a code deployment');
  t(decide(pass, pass2, now, { trigger: 'deployment', deployedFiles: null }).commit === false, 'D16: a deployment whose changed files are not known records nothing (it cannot be told from a record\'s)');
  t(decide(pass, { ...pass2, journeys: [] }, now, { trigger: 'schedule' }).commit === false, 'D16: a scheduled run with no valid result records nothing');
  t(ownRecord(BOT_FILES, BOT) && !ownRecord(BOT_FILES, 'MCD') && ownRecord(['health/journeys.json'], 'MCD') && !ownRecord([], BOT), 'ownRecord: the record from anyone, the island pages only from github-actions[bot], and an empty list is no one\'s');
  /* The record's new fields (N1b). */
  const rec = { ...pass2, schema: 2, run: 'https://github.com/georgewong1014-pixel/quantum-tradeworks/actions/runs/37252405895', trigger: 'deployment' };
  t(resultProblem(rec) === null, 'the record: run (an Actions run) and trigger (deployment, schedule or dispatch) are valid');
  t(resultProblem({ ...rec, run: 'https://example.test/actions/runs/1' }) !== null && resultProblem({ ...rec, trigger: 'push' }) !== null, 'the record: a run that is not an Actions run\'s address, or a trigger outside the three, is not valid');
  const gatedDoc = { ...rec, journeys: [{ ...j('scanner', 'PASS'), name: 'Scanner: build, save and evaluate a setup', steps: [{ name: 'Save the setup', ms: 200, status: 'OK' }, { name: 'Evaluate it: the page says there is no price history here', ms: 230, status: 'OK', gated: 'no prices ship' }] }] };
  t(resultProblem(gatedDoc) === null, 'the record: a step that passes by checking a refusal is gated, with its reason');
  t(resultProblem({ ...gatedDoc, journeys: [{ ...gatedDoc.journeys[0], steps: [{ name: 'Evaluate', ms: 1, status: 'OK', gated: '' }] }] }) !== null, 'the record: a gated step with no reason is not valid');
  t(triggerOf('deployment_status') === 'deployment' && triggerOf('schedule') === 'schedule' && triggerOf('workflow_dispatch') === 'dispatch' && triggerOf('push') === null, 'the trigger: deployment_status, schedule and workflow_dispatch, and nothing else');
  /* The guard on the bot's commit (N1d). */
  t(!guardProblems(BOT_FILES).length && guardProblems(['health/journeys.json', 'pages/about.html', 'index.html']).join() === 'pages/about.html,index.html', 'the guard: the record and the island pages may be committed by the bot, and nothing else');
  /* The served build is matched by the page its commit serves at / (plan
     item 1.2): the rewrite of "/" in that commit's vercel.json, or
     index.html before there was one; this checkout's own is the home page,
     which carries no slot of the record (build.mjs refuses one), so the bot
     never has it to commit. */
  t(rootPageOf('{"rewrites":[{"source":"/pricing","destination":"/pages/pricing.html"},{"source":"/","destination":"/pages/home.app.html"}]}') === 'pages/home.app.html'
    && rootPageOf('{"rewrites":[{"source":"/pricing","destination":"/pages/pricing.html"}]}') === 'index.html' && rootPageOf('') === 'index.html'
    && (!existsSync(join(ROOT, 'vercel.json')) || ROOT_PAGES.includes(rootPageOf(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))))
    && !ISLAND_PAGES.some(f => ROOT_PAGES.includes(f)), 'the served build: matched by the page its own commit serves at /, the home page or, before plan item 1.2, index.html');
  /* The one renderer (N1c, N1e). */
  {
    const full = { ...rec, ranAt: '2026-10-05T10:30:28.776Z', commit: '75312b2bc2c9cf2dc016a2bd405fd403a4656be1', journeys: [
      { ...j('equities', 'PASS'), name: 'Equities: search, filed statements, watchlist', steps: [{ name: 'Open Equities Research', ms: 400, status: 'OK' }] },
      { ...j('property', 'PASS'), name: 'Property: calculate, change, save', steps: [{ name: 'Save the property', ms: 700, status: 'OK' }, { name: 'Slow <step>', ms: 9000, status: 'SLOW' }] },
      gatedDoc.journeys[0],
      { ...j('ctas', 'FAIL', 'Open My Dashboard'), name: 'Primary calls to action land on working pages', route: '/app', note: 'the app never started', steps: [{ name: 'Open My Dashboard', ms: 45000, status: 'FAIL', why: 'the app never started' }] }] };
    const out = journeysServed(full);
    t(out.sum === 'Last recorded run 5 Oct 2026, 10:30 UTC on 75312b2: 3 of 4 pass, 1 failed · <a class="journeys-log" href="https://github.com/georgewong1014-pixel/quantum-tradeworks/actions/runs/37252405895">public log</a>',
      `journeysServed: the summary — its run in UTC, a 7-character commit, the tally and the run's public log (${out.sum.slice(0, 80)}…)`);
    const lis = out.list.match(/<li class="journey-row" id="journey-[a-z-]+" data-status="(PASS|DEGRADED|FAIL)">/g) || [];
    t(lis.length === 4, `journeysServed: one li per journey (${lis.length} of 4)`);
    const marks = [...out.list.matchAll(/<li data-mark="([a-z]+)"><span class="journey-mark">([A-Za-z]+)<\/span> ([^<]*)/g)].map(m => `${m[2]} ${m[3]}`);
    t(marks.join(' | ') === 'OK Open Equities Research | OK Save the property | OK Slow &lt;step&gt; | OK Save the setup | gated Evaluate it: the page says there is no price history here | FAIL Open My Dashboard',
      `journeysServed: every step named and marked OK, FAIL or gated, escaped (${marks.join(' | ').slice(0, 120)})`);
    t(/gated Evaluate it[^<]*<span class="journey-why"> — no prices ship<\/span>/.test(out.list.replace(/<span class="journey-mark">gated<\/span>/, 'gated')) && /over its time budget/.test(out.list), 'journeysServed: a gated step says why; a slow one says it was over its budget');
    t(out.lines['/property'] === '<span class="journey-line-label">Journey:</span> Property: calculate, change, save · PASS · 5 Oct 10:30 UTC · 75312b2 · <a class="journey-line-link" href="/status#journey-property">details</a>',
      `journeysServed: /property's line — "Journey: <name> · PASS · <time UTC> · <sha> · details" (${out.lines['/property'].slice(0, 90)}…)`);
    t(/ · PASS · evaluate: gated \(no prices ship\) · 5 Oct 10:30 UTC · 75312b2 · <a [^>]*href="\/status#journey-scanner">details<\/a>$/.test(out.lines['/app/scanner']), `journeysServed: the Scanner's line adds "evaluate: gated (no prices ship)" (${out.lines['/app/scanner'].slice(-110)})`);
    t(/^<span class="journey-line-label">Journey:<\/span> Equities: search, filed statements, watchlist · PASS · /.test(out.lines['/research']), 'journeysServed: /research\'s line is the equities journey');
    const none = journeysServed({ kind: RESULT_KIND, schema: 1, ranAt: null, journeys: [] });
    t(!none.recorded && /^Not run yet\./.test(none.sum) && none.list === '' && Object.values(none.lines).every(l => l === '') && Object.keys(none.lines).length === 3, 'journeysServed: the placeholder serves "not run yet", no list and three empty lines');
    const old = journeysServed({ ...full, run: undefined });
    t(/<a class="journeys-log" href="https:\/\/github\.com\/georgewong1014-pixel\/quantum-tradeworks\/actions\/workflows\/journeys\.yml">public run history<\/a>$/.test(old.sum), 'journeysServed: a record with no run links the workflow\'s public run history, never a run it did not record');
    /* build.mjs imports this module, and this module imports build.mjs for
       --url production: a top-level await of it would wait on itself. */
    const own = readFileSync(join(ROOT, 'journeys.mjs'), 'utf8').split(/\r?\n/).filter(l => /^\S/.test(l) && /\bawait\b/.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l));
    t(!own.length, `journeys.mjs has no top-level await (build.mjs imports it; --url production imports build.mjs)${own.length ? `: ${own[0].slice(0, 60)}` : ''}`);
    t(!/[\s\S]<\/script|<!--/i.test(String(journeysServed)) && !/\b(document|window|location|el|fetch|HEALTH|BASE)\b\s*[.(]/.test(String(journeysServed)), 'journeysServed: self-contained (the build puts its source into the app) — no page globals, no </script or <!--');
  }
  /* PLAN ITEM 2.5: the compare journey — and D15: what each journey
     declares an outcome step is a step its run takes, and a landing is not
     one. Read from the journeys themselves (JOURNEYS, OUTCOME_STEPS). */
  {
    const ids = JOURNEYS.map(x => x.id);
    const cmp = JOURNEYS.find(x => x.id === 'compare');
    const WANT = ['Add AAPL and MSFT: a column each, from their SEC filings', 'Save this comparison', 'The workspace lists it', 'Open restores both columns'];
    t(!!cmp && JOURNEY_NAMES.compare === 'Equities compare: two filed companies, saved and reopened', `the compare journey is one of the journeys (${ids.join(', ')})`);
    t(!!cmp && WANT.every(n => OUTCOME_STEPS.compare.includes(n)), `the compare journey: AAPL and MSFT added, the comparison saved, listed in the workspace, and both columns restored by Open — each an outcome step (${(OUTCOME_STEPS.compare || []).length} declared)`);
    const run = String(cmp?.run || '');
    t(!!cmp && JSON.stringify(cmp.storage?.()) === '{"compare":[]}' && /cmp-chip-\$\{tk\}-SEC/.test(run) && /\['AAPL', 'MSFT'\]/.test(run) && !/personal|price-history|prices\.json|scan-/.test(run),
      'the compare journey: filed companies only (AAPL-SEC and MSFT-SEC), from an empty selection, seeding nothing else and naming no personal file — the same on the live site and on CI\'s server');
    t(!!cmp && /Clear the page’s selection/.test(run) && run.indexOf('Clear the page’s selection') < run.indexOf('Open restores both columns'), 'the compare journey empties the page\'s selection before Open, so the columns can only come back from the saved comparison');
    const undeclared = JOURNEYS.flatMap(x => (x.outcomes || []).filter(n => !String(x.run).includes(`step(j, tab, '${n}'`)).map(n => `${x.id}: “${n}”`));
    t(!undeclared.length, `D15: every outcome step a journey declares is a step its own run takes, by that name${undeclared.length ? ` — not: ${undeclared.join('; ')}` : ` (${Object.values(OUTCOME_STEPS).flat().length} across ${ids.length} journeys)`}`);
    t(Array.isArray(OUTCOME_STEPS.ctas) && OUTCOME_STEPS.ctas.length === 0 && ids.filter(id => id !== 'ctas').every(id => OUTCOME_STEPS[id].length > 0),
      'D15: the calls-to-action journey declares no outcome step (a landing proves the link, not the tool); every other journey declares at least one');
    t(readFileSync(join(ROOT, 'journeys.mjs'), 'utf8').includes(`--only <id,id>       some journeys: ${ids.join(', ')}\n`), 'the usage names every journey --only takes');
    /* journeysServed shows it, and the result beside a Live badge. */
    const steps = (names, failAt = null) => names.map((name, i) => ({ name, ms: 300, status: failAt === null || i < failAt ? 'OK' : i === failAt ? 'FAIL' : null })).filter(s => s.status);
    const rec2 = { kind: RESULT_KIND, schema: 2, ranAt: '2026-10-06T03:17:44.000Z', commit: '67d0e5185f3c', journeys: [
      { ...j('compare', 'PASS'), name: JOURNEY_NAMES.compare || 'compare', steps: steps(['Open Compare', ...WANT.slice(0, 2), 'Clear the page’s selection', ...WANT.slice(2)]) },
      { ...j('property', 'FAIL', 'Save <the> property'), name: 'Property: calculate, change, save', steps: steps(['Open the property calculator', 'Change the rent: the cash flow and the yield move', 'Save <the> property'], 2) }] };
    const out = journeysServed(rec2);
    const cmpRow = /<li class="journey-row" id="journey-compare" data-status="PASS">([\s\S]*?)<\/div><\/li>/.exec(out.list)?.[1] || '';
    const cmpMarks = [...cmpRow.matchAll(/<li data-mark="ok"><span class="journey-mark">OK<\/span> ([^<]*)<\/li>/g)].map(m => m[1]);
    t(cmpMarks.length === 6 && WANT.every(n => cmpMarks.includes(n)), `journeysServed: a recorded compare journey is listed on /status, with each of its six steps marked (${cmpMarks.length})`);
    t(out.proof('compare', 'Open restores both columns') === '<span class="proof-status" data-status="PASS">PASS</span> · outcome step OK · 6 Oct 2026, 03:17 UTC · <a class="journey-line-link" href="#journey-compare">details</a>',
      `journeysServed: a Live badge's result — the journey's status, its outcome step as recorded, the run's UTC time, and its steps on this page (${out.proof('compare', 'Open restores both columns').replace(/<[^>]*>/g, '')})`);
    t(out.proof('property', 'Change the rent: the cash flow and the yield move') === '<span class="proof-status" data-status="FAIL">FAIL</span> at “Save &lt;the&gt; property” · outcome step OK · 6 Oct 2026, 03:17 UTC · <a class="journey-line-link" href="#journey-property">details</a>'
      && /^<span class="proof-status" data-status="FAIL">FAIL<\/span> at “Save &lt;the&gt; property” · outcome step FAIL · /.test(out.proof('property', 'Save <the> property'))
      && / · outcome step not reached · /.test(out.proof('property', 'It is listed with the saved properties')),
      'journeysServed: a failed journey names its failing step, escaped, and says of the badge\'s step OK, FAIL or not reached');
    t(/ · outcome step not in the recorded run · /.test(out.proof('compare', 'A step written after the run')) && out.proof('equities', 'The watchlist lists it') === 'Not in the last recorded run.'
      && journeysServed({ kind: RESULT_KIND, schema: 1, ranAt: null, journeys: [] }).proof('property', 'Save the property') === 'No recorded run to show.',
      'journeysServed: a step the run did not record, a journey it did not run, and no run at all are each said — nothing carried over from an older run');
  }
  t(resultProblem(doc('2026-09-30T11:30:00Z', [j('a', 'FAIL')])) !== null, 'a FAIL with no named step is not a valid result');
  t(resultProblem(doc('2026-09-30T11:30:00Z', [{ ...j('a', 'PASS'), status: 'OK' }])) !== null, 'a status outside PASS, DEGRADED and FAIL is not a valid result');
  t(resultProblem({ kind: RESULT_KIND, schema: 1, ranAt: null, journeys: [] }) === null && !hasRun({ kind: RESULT_KIND, ranAt: null, journeys: [] }), 'the placeholder is valid and holds no run');
  const md = markdown(doc('2026-09-30T11:30:00Z', [j('a', 'PASS'), { ...j('b|c', 'FAIL', 'Step | with a pipe'), note: 'why' }]));
  t(/\| a \| PASS \| — \| — \| 1\.0 s \|/.test(md) && /Step \\\| with a pipe/.test(md) && /1 pass, 0 degraded, 1 fail/.test(md), 'the table: one row per journey, pipes escaped, the counts in the heading');
  /* The workflow that applies the rule, read as text (no YAML parser here):
     its concurrency is the job's, so an event whose job is skipped (a
     preview deployment, a pending status) cannot cancel a production run
     waiting its turn; the deployed commit's files reach the rule; and it
     asks for the three permissions it uses and no others.
     And with Vercel's Deployment Checks holding a deployment until
     checks.yml passes on its commit (2026-10-03): a deployment's run waits
     45 minutes for its build to be served, inside a job allowed longer; and
     the record, pushed with the workflow's own token (which starts no
     workflow), has checks.yml started on it — or its deployment would wait
     for checks that never come. */
  const wf = join(ROOT, '.github/workflows/journeys.yml');
  if (existsSync(wf)) {
    const y = readFileSync(wf, 'utf8').replace(/\r\n/g, '\n');
    t(!/^concurrency:/m.test(y) && /^ {4}concurrency:\n {6}group: journeys\n {6}cancel-in-progress: false$/m.test(y), 'the workflow: one concurrency group, the job\'s — a skipped preview event cannot cancel a pending production run');
    t(/--decide [^\n]*--deployed-files/.test(y) && /git diff --name-only "\$DEPLOY_SHA\^" "\$DEPLOY_SHA"/.test(y), 'the workflow: the deployed commit\'s files reach the commit rule');
    const perms = /^permissions:\n((?: {2}[^\n]*\n)+)/m.exec(y);
    t(!!perms && perms[1].trim().split('\n').map(s => s.trim()).sort().join(',') === 'actions: write,contents: write,issues: write', 'the workflow: permissions actions, contents and issues write, nothing else');
    const wait = Number((/--commit "\$DEPLOY_SHA" --wait (\d+)/.exec(y) || [])[1]);
    const limit = Number((/^ {4}timeout-minutes: (\d+)$/m.exec(y) || [])[1]);
    /* 2.3: the checks take 39–52 minutes, so a deployment held for them
       goes live up to an hour after it is made. */
    t(wait >= 3600 && limit >= 75 && limit * 60 >= wait + 600, `the workflow: a deployment's run waits ${wait || 'no'}s for its build (an hour at least) inside a ${limit || '?'}-minute job (75 at least) with ten to spare`);
    t(/git push origin HEAD:main; then\n\s+gh workflow run checks\.yml [^\n]*--ref main/.test(y) && /GH_TOKEN: \$\{\{ github\.token \}\}/.test(y.slice(y.indexOf('record the result on main'))), 'the workflow: the record it pushes has checks.yml started on it, so its deployment can pass its Deployment Checks');
    /* D16 and N1b–N1d. Comments may tell the history; the commands may not
       carry it. */
    const cmds = y.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    t(/^ {4}- cron: '17 3,15 \* \* \*'/m.test(y), 'the workflow: two scheduled runs a day (17 3,15 * * *)');
    t(!/\[skip ci\]/i.test(cmds), 'the workflow: the record commit does not say [skip ci] — its checks run, so Deployment Checks can promote it');
    t(/TRIGGER: \$\{\{ github\.event_name == 'deployment_status' && 'deployment' \|\| github\.event_name == 'schedule' && 'schedule' \|\| 'dispatch' \}\}/.test(y)
      && /node journeys\.mjs --url production [^\n]*\\\n[^\n]*--trigger "\$TRIGGER" --run "\$RUN_URL"/.test(cmds) && /RUN_URL: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/.test(y),
      'the workflow: the record carries what started the run and the run\'s public log');
    t(/node journeys\.mjs --decide [^\n]*--trigger "\$TRIGGER"[^\n]*--deployed-files[^\n]*--deployed-author/.test(cmds) && /git log -1 --format='%an' "\$DEPLOY_SHA"/.test(cmds), 'the workflow: the trigger, the deployed commit\'s files and its author reach the commit rule');
    const rec = cmds.slice(cmds.indexOf('record the result on main'));
    const at = (re) => { const m = re.exec(rec); return m ? m.index : -1; };
    const iCopy = at(/cp "\$RUNNER_TEMP\/journeys\.json" health\/journeys\.json/), iBuild = at(/node build\.mjs\b/), iGuard = at(/node journeys\.mjs --guard\b/), iCommit = at(/git commit\b/);
    t(iCopy > -1 && iCopy < iBuild && iBuild < iGuard && iGuard < iCommit, 'the workflow: the record is copied, the island pages rebuilt from it (node build.mjs), the guard run, then the commit');
    t(!/pull --rebase/.test(cmds) && /git fetch -q origin main\n\s+git reset -q --hard origin\/main\n\s+record \|\| exit 1/.test(rec), 'the workflow: a lost push starts again from main as it is now (fetch, reset, rebuild) — never git pull --rebase');
  }
  /* 2.3: the journeys against CI's server are a job of their own, beside the
     route checks rather than after them, so a failure before them cannot
     hide them; and the jobs' names, which Vercel's Deployment Checks are
     set to, are the ones the owner selected. */
  const cf = join(ROOT, '.github/workflows/checks.yml');
  if (existsSync(cf)) {
    const y = readFileSync(cf, 'utf8').replace(/\r\n/g, '\n');
    const jobs = {};
    for (const m of y.slice(y.indexOf('\njobs:\n')).matchAll(/^ {2}([a-z][a-z0-9-]*):\n((?: {4,}[^\n]*\n|\s*\n)*)/gm)) jobs[m[1]] = m[2];
    const named = (n) => Object.entries(jobs).find(([, b]) => new RegExp(`^ {4}name: ${n}$`, 'm').test(b));
    const tool = named('every tool works from start to finish'), runtime = named('every route renders'), stat = named('parses, and matches its source');
    t(!!stat && !!runtime && !!tool, `checks.yml: the three jobs Deployment Checks names — ${['parses, and matches its source', 'every route renders', 'every tool works from start to finish'].map(n => `"${n}" ${named(n) ? 'there' : 'MISSING'}`).join(', ')}`);
    t(!!tool && /^ {4}needs: static$/m.test(tool[1]) && /node journeys\.mjs http:\/\/localhost:\d+/.test(tool[1]) && !!runtime && !/node journeys\.mjs/.test(runtime[1]),
      'checks.yml: the journeys are their own job, after the static job and beside "every route renders", not a step of it');
  }
  console.log(bad ? `\n${bad} self-test check(s) failed` : '\nself-test: the commit rule (a code deployment records, a scheduled run records, a record-only bot commit records nothing), the result shape, the table, the served result, the compare journey, the outcome steps, the guard and the workflows hold');
  process.exit(bad ? 1 : 0);
}

/* The working tree's changes, as git names them: a rename's new path. */
function changedPaths() {
  const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"|"$/g, '')).map(p => (p.includes(' -> ') ? p.split(' -> ')[1] : p));
}

/* --self-test runs at the end of the module (below THE JOURNEYS), since it
   reads the journeys' own declarations. */
if (MAIN && has('guard')) {
  const changed = changedPaths();
  const bad = guardProblems(changed);
  if (bad.length) {
    console.error(`the bot may commit only ${RECORD_FILE} and the island pages (${ISLAND_PAGES.join(', ')}); this tree also changes:`);
    bad.slice(0, 20).forEach(f => console.error(`  ${f}`));
    if (bad.length > 20) console.error(`  and ${bad.length - 20} more`);
    console.error('main was not built from its own source, or the build changed what the record does not decide — nothing is committed');
    process.exit(1);
  }
  console.log(`the tree changes ${changed.length ? changed.join(', ') : 'nothing'}: the record and the island pages only`);
  process.exit(0);
}
if (MAIN && has('decide')) {
  const i = argv.indexOf('--decide');
  const [recFile, newFile] = [argv[i + 1], argv[i + 2]];
  if (!newFile) { console.error('usage: node journeys.mjs --decide <recorded.json> <new.json>'); process.exit(2); }
  const recorded = existsSync(recFile) ? readJson(recFile) : undefined;
  const fresh = readJson(newFile);
  /* --deployed-files <file>: the paths the deployed commit changed, one a
     line (git diff --name-only <sha>^ <sha>), for a run after a deployment. */
  const df = flag('deployed-files');
  const deployedFiles = df && existsSync(df) ? readFileSync(df, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : null;
  /* --trigger: what started the run; --deployed-author: who wrote the
     deployed commit (git log -1 --format=%an <sha>). */
  const trigger = flag('trigger');
  if (trigger && !TRIGGERS.includes(trigger)) { console.error(`--trigger is ${trigger}, not ${TRIGGERS.join(', ')}`); process.exit(2); }
  const d = decide(recorded === undefined && existsSync(recFile) ? { unreadable: true } : recorded, fresh, Date.now(), { deployedFiles, deployedAuthor: flag('deployed-author'), trigger });
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
/* --url production is resolved in main(), not here: build.mjs imports this
   module (journeysServed), so awaiting build.mjs at the top level while this
   module is still being evaluated would wait on itself — the run hung there
   with "unsettled top-level await" before it began. With no top-level await,
   this module has finished evaluating by the time main() asks for it. */
let BASE = (flag('url') || argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:8123').replace(/\/+$/, '');
let HOST = null;
/* The owner's machine, as the app decides it (25-universe.js, OWNER_MACHINE):
   only there does the page ask for the personal lane at all. */
let OWNER_MACHINE = false;
async function where() {
  if (BASE === 'production') {
    const { siteOrigin } = await import('./build.mjs');
    BASE = siteOrigin(readFileSync(join(ROOT, 'src/index.template.html'), 'utf8')).replace(/\/+$/, '');
  }
  try { HOST = new URL(BASE).hostname; } catch { console.error(`not an address: ${BASE}`); process.exit(2); }
  OWNER_MACHINE = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(HOST);
}
/* What started the run and its public log, recorded with the result (N1b). */
const TRIGGER = flag('trigger');
const RUN = flag('run');
if (MAIN && TRIGGER && !TRIGGERS.includes(TRIGGER)) { console.error(`--trigger is ${TRIGGER}, not ${TRIGGERS.join(', ')}`); process.exit(2); }
if (MAIN && RUN && !RUN_URL.test(RUN)) { console.error(`--run is ${RUN}, not an Actions run's address`); process.exit(2); }
const ONLY = (flag('only') || '').split(',').map(s => s.trim()).filter(Boolean);

/* Budgets. A first load includes the 1.4MB of filed statements; an action
   is one click or entry and its answer. Over budget is DEGRADED, not FAIL:
   the reader got there, slowly. A step that has not finished at STEP_LIMIT
   has failed. */
const BUDGET = { load: 10000, action: 4000 };
const STEP_LIMIT = 45000;

/* ─── WHICH COMMIT IS SERVED ──────────────────────────────────────────────── */
/* The site carries no build stamp, so the served build is identified the way
   deploy-check.mjs identifies it: by the whole page its root is served. Its
   git blob id is compared with that page as committed at HEAD, then in every
   commit that changed it — the newest match is the build being served.
   The page is a commit's own: the file its vercel.json rewrites / to
   (pages/home.app.html since plan item 1.2), or index.html where it
   rewrites / to nothing (every commit before 1.2). */
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return null; } };
const rootPageAt = (rev) => rootPageOf(git('show', `${rev}:vercel.json`) || '');
const blobId = (text) => { const buf = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8'); return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex'); };
async function servedBlob() {
  try { const r = await fetch(`${BASE}/`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } }); return r.ok ? blobId(await r.text()) : null; }
  catch { return null; }
}
async function commitServed() {
  const want = flag('commit');
  if (want) {
    const target = git('rev-parse', `${want}:${rootPageAt(want)}`);
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
  const page = rootPageAt('HEAD');
  if (git('rev-parse', `HEAD:${page}`) === blob) return { commit: head, commitFrom: `the served root page (${page}) is the build of the commit checked out` };
  /* Each commit that changed a root page, the page its own vercel.json
     serves at / matched (a commit's index.html is not what it served once
     the home page was). */
  const log = git('log', '-n', '400', '--format=@%H', '--raw', '--no-abbrev', '--', ...ROOT_PAGES) || '';
  let sha = null, served = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) { sha = line.slice(1); served = null; continue; }
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) \S+\t(.+)$/.exec(line);
    if (!m || m[1] !== blob) continue;
    if (served === null) served = rootPageAt(sha);
    if (m[2] === served) return { commit: sha, commitFrom: `the served root page (${served}) is the build this commit made` };
  }
  return { commit: null, commitFrom: 'the served root page matches no commit in this checkout (an uncommitted build?)' };
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
    const map = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], ArrowLeft: [37, ''], ArrowUp: [38, ''], ArrowRight: [39, ''], ArrowDown: [40, ''] };
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
     write, and every later load reads it. Written once the page's filings
     are in, not before: when they land, the page rewrites the watchlists it
     holds (remapSavedIds — the sample list's AAPL becomes AAPL-SEC), and on
     a cold, just-deployed site they landed after this write, while the next
     page's HTML was still on its way and this one still alive. The sample
     list, Apple on it, replaced the journey's empty one: "✓ On your
     watchlist" on every run after a deployment, from 2 Oct 2026 (issue #1);
     reproduced here with us.json held 1.2s and pages 1.5s. */
  if (storage) {
    await tab.goto('/privacy');
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
      steps: this.steps.map(s => ({ name: s.name, ms: s.ms, status: s.status, ...(s.why ? { why: s.why.slice(0, 200) } : {}), ...(s.gated ? { gated: s.gated } : {}) })) };
  }
}

/* One step: done within STEP_LIMIT or failed, and over its budget is said.
   Returns { ok, out } or { ok: false, why, route } — step() stops the journey
   on a failure, trial() records it and lets the journey go on. */
async function timed(j, tab, name, budget, fn, { gated = null } = {}) {
  const t0 = Date.now();
  let timer;
  try {
    const out = await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new StepError(`did not finish within ${STEP_LIMIT / 1000}s`)), STEP_LIMIT); })]);
    const ms = Date.now() - t0;
    j.steps.push({ name, ms, status: ms > budget ? 'SLOW' : 'OK', ...(gated ? { gated } : {}) });
    if (ms > budget) j.degrade(`“${name}” took ${fmtS(ms)}, over its ${fmtS(budget)} budget`, await tab.where());
    return { ok: true, out };
  } catch (e) {
    const ms = Date.now() - t0;
    const why = e instanceof StepError ? e.message : `the check itself broke: ${e.message}`;
    j.steps.push({ name, ms, status: 'FAIL', why });
    return { ok: false, why, route: await tab.where() };
  } finally { clearTimeout(timer); }
}
/* gated: the step passes by checking an honest refusal, and says why the
   tool refuses there (N1b) — recorded with the step, and marked "gated"
   wherever the result is shown, never as a plain OK. */
async function step(j, tab, name, budget, fn, opts) {
  const r = await timed(j, tab, name, budget, fn, opts);
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
    outcomes: ['Search for “apple”', 'Financials: the filed statements, and where a figure came from', 'Add to watchlist', 'The watchlist lists it'],
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
    outcomes: ['Filter: return on equity of at least 20'],
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
    /* PLAN ITEM 2.5 (audit A #2). Two filed companies — Apple and
       Microsoft, from their SEC filings, the same on every site — compared,
       the comparison saved, found in the workspace and reopened. A fresh
       browser's selection is the sample pair of Malaysian banks
       (illustrative figures), so the journey starts from an empty one; and
       it empties the page's selection again before reopening, so the two
       columns can only have come back from the saved comparison. Nothing
       but this browser's own storage is written. */
    id: 'compare', name: 'Equities compare: two filed companies, saved and reopened',
    storage: () => ({ compare: [] }),
    outcomes: ['Add AAPL and MSFT: a column each, from their SEC filings', 'Save this comparison', 'The workspace lists it', 'Open restores both columns'],
    async run(j, tab) {
      /* The comparison table's company columns, by ticker, and whether each
         says it is filed (dataChip: .filed-mark), not illustrative. */
      const COLS = `[...document.querySelectorAll('main table.dt-pagesticky thead th')].slice(1).map(th => ({ tk: (th.childNodes[0]?.textContent || '').trim(), filed: !!th.querySelector('.filed-mark') }))`;
      const cols = () => tab.eval(COLS);
      const both = async (why) => {
        const c = await cols();
        if (c.map(x => x.tk).join() !== 'AAPL,MSFT') throw new StepError(`${why}: the table's columns are ${c.length ? c.map(x => x.tk).join(', ') : 'none'}, not AAPL and MSFT`);
        const not = c.filter(x => !x.filed).map(x => x.tk);
        if (not.length) throw new StepError(`${why}: ${not.join(' and ')} ${not.length === 1 ? 'is' : 'are'} not marked as filed`);
        /* Figures in both columns, from their statements: the latest year's
           revenue, the row every operating business fills. */
        const rev = await tab.eval(`(() => { const tr = [...document.querySelectorAll('main table.dt-pagesticky tbody tr')].find(r => r.querySelector('td.pin')?.textContent.trim() === 'Revenue, latest year');
          return tr ? [...tr.querySelectorAll('td')].slice(1).map(td => td.textContent.trim()) : null; })()`);
        if (!rev || rev.length !== 2 || !rev.every(v => /\d/.test(v))) throw new StepError(`${why}: the latest year's revenue reads ${rev ? rev.map(v => `“${v || 'empty'}”`).join(' and ') : 'nowhere'}, not a figure for each`);
      };
      const chip = (tk) => `document.getElementById('cmp-chip-${tk}-SEC')`;
      await step(j, tab, 'Open Compare', BUDGET.load, async () => {
        await tab.goto('/compare');
        await tab.expect(`State.view === 'compare'`, async () => `/compare opened ${await tab.eval('State.view')}, not the comparison`);
        await tab.expect(`!!(${chip('AAPL')}) && !!(${chip('MSFT')})`, 'the selection offers no chip for Apple or Microsoft as filed companies (AAPL-SEC, MSFT-SEC)');
        const held = await tab.eval('State.compare.length');
        if (held) throw new StepError(`the page holds ${held} compan${held === 1 ? 'y' : 'ies'} from this browser before any was chosen`);
      });
      await step(j, tab, 'Add AAPL and MSFT: a column each, from their SEC filings', BUDGET.action * 2, async () => {
        for (const tk of ['AAPL', 'MSFT']) {
          await tab.click(chip(tk), `The ${tk} chip`);
          await tab.expect(`(${chip(tk)})?.getAttribute('aria-pressed') === 'true'`, `pressing ${tk} did not add it to the comparison`, 4000);
        }
        await tab.expect(`${COLS}.map(x => x.tk).join() === 'AAPL,MSFT'`, 'the table did not gain a column each for AAPL and MSFT', 6000);
        await both('Added');
      });
      const name = `Journey check AAPL vs MSFT ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      tab.prompt = name;
      await step(j, tab, 'Save this comparison', BUDGET.action, async () => {
        const before = tab.dialogs;
        await tab.click(byText('main button', '/^Save this comparison$/'), 'Save this comparison');
        await tab.expect(`/^Saved /.test(document.getElementById('toast')?.textContent || '')`, 'pressing Save said nothing was saved', 4000);
        if (tab.dialogs === before) throw new StepError('Save asked for no name, so the saved comparison cannot be told from any other');
        const said = await tab.eval(`document.getElementById('toast')?.textContent || ''`);
        if (!said.includes(name)) throw new StepError(`the page says “${said}”, not that “${name}” was saved`);
      });
      await step(j, tab, 'Clear the page’s selection', BUDGET.action * 2, async () => {
        for (const tk of ['AAPL', 'MSFT']) {
          await tab.click(chip(tk), `The ${tk} chip`);
          await tab.expect(`(${chip(tk)})?.getAttribute('aria-pressed') === 'false'`, `pressing ${tk} again did not take it out`, 4000);
        }
        await tab.expect(`!document.querySelector('main table.dt-pagesticky') && /Select at least one company/.test(document.querySelector('main')?.innerText || '')`, 'with both taken out, the page still shows a comparison', 4000);
      });
      await step(j, tab, 'The workspace lists it', BUDGET.load, async () => {
        /* The comparison's own Workspace link goes with its table; the
           sidebar's link to the saved work stays. */
        await tab.click(visible('a[href="/my/workspace"]'), 'The link to the saved work');
        await tab.expect(`State.view === 'workspace'`, 'the Workspace link did not open the workspace');
        /* Listed by its name, as a comparison of two companies; which two,
           Open shows (the next step). */
        await tab.expect(`[...document.querySelectorAll('main .ws-row')].some(r => r.querySelector('.ws-name strong')?.textContent === ${JSON.stringify(name)} && /^Comparison$/.test(r.querySelector('.ws-name .chip')?.textContent.trim() || '') && /^2 companies\\b/.test(r.querySelector('.ws-name .metaline')?.textContent.trim() || ''))`,
          async () => `the workspace does not list “${name}” as a comparison of 2 companies — it lists: ${(await tab.eval(`[...document.querySelectorAll('main .ws-row:not(.ws-head) .ws-name')].map(n => n.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`)).slice(0, 200) || 'nothing'}`);
      });
      await step(j, tab, 'Open restores both columns', BUDGET.load, async () => {
        await tab.click(`[...document.querySelectorAll('main button.ws-open')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(`Open ${name}`)})`, `Open ${name}`);
        await tab.expect(`State.view === 'compare' && new URLSearchParams(location.search).has('saved')`, async () => `Open went to ${await tab.where()}, not to the saved comparison`);
        await tab.expect(`${COLS}.length === 2`, 'the reopened comparison shows no columns', 8000);
        await both('Reopened');
        const head = await tab.text();
        if (!head.includes(`Saved comparison — ${name}`)) throw new StepError('the reopened page does not say which saved comparison it is');
      });
    },
  },
  {
    id: 'property', name: 'Property: calculate, change, save',
    outcomes: ['Enter a price, a rent and a loan', 'Change the rent: the cash flow and the yield move', 'Change the loan: the cash required moves',
      'Save the property', 'It is listed with the saved properties', 'Proposal hides the sale’s costs, proceeds and profit until unlocked'],
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
      /* The owner's paywall rule (3 Oct 2026): the sale's costs, its net
         proceeds and the total profit are the full report's. A fresh
         browser has previewed no report, so its client proposal prints the
         Scenario Lab's two free rows of the sale and says where the rest
         is — and none of the nine others. The proposal printed all ten to
         anyone from ee173ce (plan item 1.4). */
      await step(j, tab, 'Proposal hides the sale’s costs, proceeds and profit until unlocked', BUDGET.action * 2, async () => {
        const link = `[...document.querySelectorAll('main a')].find(a => a.getClientRects().length && /^Client proposal/.test(a.getAttribute('aria-label') || '')${prompted ? ` && (a.getAttribute('aria-label') || '').endsWith(${JSON.stringify(name)})` : ''})`;
        await tab.click(link, 'The saved property’s Client proposal link');
        await tab.expect(`State.view === 'propertyProposal' && !!document.getElementById('cp-h-exit')`, 'the Client proposal link did not open a proposal with its sale');
        const sale = await tab.eval(`(() => { const doc = document.getElementById('cp-doc'), sec = document.getElementById('cp-h-exit').parentElement;
          /* Its words but its inputs (.cp-assume): "Agent commission on
             exit, 2%" is an assumption, not the sale's commission. */
          const words = doc.cloneNode(true); words.querySelectorAll('.cp-assume').forEach(n => n.remove());
          return { rows: [...sec.querySelectorAll('tbody th')].map(th => th.textContent.replace(/\\s+/g, ' ').trim()), text: words.textContent.replace(/\\s+/g, ' '),
            notes: [...sec.querySelectorAll('.cp-note')].map(p => p.textContent.replace(/\\s+/g, ' ').trim()) }; })()`);
        const want = [/^Value less loan, year \d+ \(before selling costs\)$/, /^If sold in year \d+$/];
        if (sale.rows.length !== 2 || !want.every((re, i) => re.test(sale.rows[i]))) throw new StepError(`the proposal's sale lists ${sale.rows.length} rows (${sale.rows.join('; ').slice(0, 160)}), not the Lab's two free ones`);
        const shown = [['Sale value', /Sale value/], ['loan outstanding', /Loan outstanding/], ['agent commission', /Agent commission/], ['legal fees', /Legal fees on the sale/],
          ['months carried', /Carried while it sells/], ['gains tax', /Real property gains tax \(/], ['net proceeds', /Net proceeds/i], ['rental cash over the hold', /Rental cash over the hold|Cash to hold it over the hold/i], ['total profit', /Total profit/i]]
          .filter(([, re]) => re.test(sale.text)).map(([w]) => w);
        if (shown.length) throw new StepError(`before any report is unlocked the proposal shows the full report's ${shown.join(', ')}`);
        if (!sale.notes.includes('In the full analysis — preview in the calculator; nothing is on sale')) throw new StepError('the proposal does not say where the rest of the sale is');
      });
    },
  },
  {
    /* PROPERTY'S LANDING, THE SCENARIO LAB (plan item 2.2; N3, the owner's
       decision D18). /property opens the Lab on the sample deal: its identity
       line and four figures first; a slider moved by the keyboard works the
       chain out again with nothing pressed — the rent moves the monthly
       position and the net yield and not the repayment, the rate the
       repayment and not the net yield — and writes nothing; the comparison
       by cash flow keeps A before B; one Save beside the identity line asks
       for both names and saves the property and then B as its scenario, B's
       unsaved moves kept (the guided save, 8 Oct 2026); and My properties
       lists it. */
    id: 'lab', name: 'Property landing: the Scenario Lab moves, compares and saves',
    outcomes: ['Move the rent: the monthly position and the net yield follow, the repayment does not', 'Move the rate: the repayment follows, the net yield does not',
      'Compare by cash flow: A, then B', 'Save the property, then B as a scenario', 'It is listed with the saved properties'],
    async run(j, tab) {
      /* The chain's figures as the page holds them, by row. */
      const chain = `Object.fromEntries([...document.querySelectorAll('#lab-root .lab-chain [data-lab]')].map(n => [n.dataset.lab, n.dataset.value]))`;
      /* A knob's slider, picked first where a phone shows one at a time. */
      const knob = (k) => `(() => { const r = document.getElementById('lab-in-${k}'); if (r && !r.checked && !document.getElementById('lab-r-${k}')?.getClientRects().length) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
        const n = document.getElementById('lab-r-${k}'); if (!n) return false; n.scrollIntoView({ block: 'center', behavior: 'instant' }); n.focus(); return document.activeElement === n; })()`;
      const press = async (k, key, times) => {
        if (!await tab.eval(knob(k))) throw new StepError(`the ${k} slider is not on the page or cannot take the keyboard`);
        for (let i = 0; i < times; i++) await tab.key(key);
      };
      /* What exploring may not do: write the calculator's deal. */
      const dealAt = `JSON.stringify(store.read('deal', null))`;
      let deal0, before;
      const name = `Lab journey ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      await step(j, tab, 'Open /property: the Scenario Lab on the sample deal', BUDGET.load, async () => {
        await tab.goto('/property');
        await tab.expect(`State.view === 'propertyLab' && !!document.getElementById('lab-r-rent')`, async () => `/property opened ${await tab.eval('State.view')}, not the Scenario Lab with its sliders`);
        const id = await tab.eval(`(document.getElementById('lab-status')?.textContent || '').trim()`);
        if (!/^Sample deal/.test(id)) throw new StepError(`the identity line reads “${id.slice(0, 60)}”, not the sample deal`);
        const tiles = await tab.eval(`[...document.querySelectorAll('main .lab-tile .lab-tile-label')].map(n => n.textContent.trim()).join(' | ')`);
        if (tiles !== 'Cash required | Monthly position | Net yield | Next step') throw new StepError(`the four tiles read “${tiles}”`);
        deal0 = await tab.eval(dealAt);
      });
      await step(j, tab, 'Move the rent: the monthly position and the net yield follow, the repayment does not', BUDGET.action, async () => {
        before = await tab.eval(chain);
        await press('rent', 'ArrowRight', 5);
        const t0 = Date.now();
        let now;
        do { now = await tab.eval(chain); if (now.cashflowMonthly !== before.cashflowMonthly && now.netYield !== before.netYield) break; await sleep(50); } while (Date.now() - t0 < 1000);
        if (now.cashflowMonthly === before.cashflowMonthly) throw new StepError(`the monthly position stayed ${before.cashflowMonthly} when the rent rose five steps`);
        if (now.netYield === before.netYield) throw new StepError(`the net yield stayed ${before.netYield} when the rent rose five steps`);
        if (now.instalment !== before.instalment) throw new StepError(`the repayment moved from ${before.instalment} to ${now.instalment} with the rent`);
        if (await tab.eval(dealAt) !== deal0) throw new StepError('moving a slider wrote the calculator’s deal — exploring is a what-if until it is saved');
        before = now;
      });
      await step(j, tab, 'Move the rate: the repayment follows, the net yield does not', BUDGET.action, async () => {
        await press('ratePct', 'ArrowUp', 1);
        const t0 = Date.now();
        let now;
        do { now = await tab.eval(chain); if (now.instalment !== before.instalment) break; await sleep(50); } while (Date.now() - t0 < 1000);
        if (now.instalment === before.instalment) throw new StepError(`the repayment stayed ${before.instalment} when the rate rose a step`);
        if (now.netYield !== before.netYield) throw new StepError(`the net yield moved from ${before.netYield} to ${now.netYield} with the rate`);
      });
      await step(j, tab, 'Compare by cash flow: A, then B', BUDGET.action, async () => {
        await tab.click(`document.querySelector('label[for="lab-by-cashflow"]')`, 'Compare by “Cash flow”');
        await tab.expect(`!!document.querySelector('#lab-cmp table[data-field="cashflowMonthly"]')`, 'the comparison did not change to the monthly position');
        const rows = await tab.eval(`[...document.querySelectorAll('#lab-cmp table[data-field="cashflowMonthly"] tr.lab-cmp-row')].map(r => r.dataset.labCol + ' ' + r.dataset.value)`);
        if (rows.map(r => r.split(' ')[0]).join('') !== 'AB') throw new StepError(`the comparison by cash flow lists ${rows.join(', ') || 'nothing'}, not A then B`);
        if (rows[0].split(' ')[1] === rows[1].split(' ')[1]) throw new StepError(`A and B show the same monthly position (${rows[0].split(' ')[1]}) after B's rent and rate moved`);
      });
      /* THE GUIDED SAVE (the owner's property track, 8 Oct 2026): on the
         unsaved deal one Save asks for the property's name and B's, and
         saves the property and then B as its scenario — B's rent and rate,
         moved above and never saved, kept in it and in its column. */
      await step(j, tab, 'Save the property, then B as a scenario', BUDGET.action * 3, async () => {
        const moved = await tab.eval(`(() => { const c = LAB.deal?.cols.find(x => x.key === 'B'); return c ? JSON.stringify({ rent: c.work.rent, ratePct: c.work.ratePct, moves: Object.keys(c.moves).sort() }) : null; })()`);
        if (!moved) throw new StepError('the Lab holds no column B on the unsaved deal');
        const was = JSON.parse(moved);
        if (was.moves.join() !== 'ratePct,rent') throw new StepError(`B's unsaved moves are ${was.moves.join(', ') || 'none'}, not the rent and the rate moved above`);
        await tab.expect(`/^Save this property and B as a scenario/.test(document.getElementById('lab-id-save')?.textContent || '')`, async () => `beside the identity line: “${await tab.eval(`document.querySelector('.lab-id-act')?.textContent || ''`)}”, not one Save for the property and B`);
        /* The phone's bar (Analyse · Compare · Save this) starts the same save. */
        const bar = await tab.eval(`labBarSave().aria`);
        if (bar !== 'Save this property and B as a scenario') throw new StepError(`the phone bar's “Save this” says “${bar}”, not the identity line's guided save`);
        await tab.click(`document.getElementById('lab-id-save')`, 'Save this property and B as a scenario, beside the identity line');
        await tab.expect(`!!document.getElementById('lab-property-name') && !!document.getElementById('lab-scenario-name') && document.getElementById('lab-name-with-sc')?.checked === true`,
          async () => `one Save asked for ${await tab.eval(`[...document.querySelectorAll('.lab-name-form input[type=text]')].map(n => n.id).join(', ') || 'no name'`)}, not the property's name and B's`);
        await tab.fill(`document.getElementById('lab-property-name')`, name, 'The property’s name');
        await tab.click(`document.getElementById('lab-name-save')`, 'Save — once, for both');
        await tab.expect(`/^Saved “/.test(document.getElementById('toast')?.textContent || '') && / and B as its scenario “/.test(document.getElementById('toast')?.textContent || '')`,
          async () => `one Save said “${await tab.eval(`document.getElementById('toast')?.textContent || ''`)}”, not that the property and B were saved`, 4000);
        const r = JSON.parse(await tab.eval(`(() => {
          const rec = pmFind(State.deal.modelId), sc = (rec?.scenarios || [])[0];
          const lab = rec && LAB['m:' + rec.id], col = lab?.cols.find(c => c.key === 'B');
          const inputs = sc ? pmSavedInputs(rec, sc) : null;
          return JSON.stringify({ name: rec?.name || null, scenarios: (rec?.scenarios || []).length, source: col?.source || null,
            saved: inputs ? { rent: inputs.rent, ratePct: inputs.ratePct } : null, col: col ? { rent: col.work.rent, ratePct: col.work.ratePct } : null,
            identity: (document.querySelector('.lab-id-act')?.textContent || '').trim() });
        })()`));
        if (r.name !== name) throw new StepError(`the property saved is “${r.name}”, not “${name}”`);
        if (r.scenarios !== 1 || !String(r.source).startsWith('sc:')) throw new StepError(`after one Save the property has ${r.scenarios} scenarios and B is ${r.source}, not its saved scenario`);
        if (r.saved?.rent !== was.rent || r.saved?.ratePct !== was.ratePct) throw new StepError(`B's moves were rent ${was.rent} and rate ${was.ratePct}; the scenario saved rent ${r.saved?.rent} and rate ${r.saved?.ratePct}`);
        if (r.col?.rent !== was.rent || r.col?.ratePct !== was.ratePct) throw new StepError(`B's column went from rent ${was.rent} and rate ${was.ratePct} to ${r.col?.rent} and ${r.col?.ratePct} with the save`);
        if (r.identity !== 'Saved in this browser') throw new StepError(`beside the identity line after the save: “${r.identity}”`);
      });
      await step(j, tab, 'It is listed with the saved properties', BUDGET.load, async () => {
        await tab.goto('/property/models');
        await tab.expect(`(document.querySelector('main')?.innerText || '').includes(${JSON.stringify(name)})`, `“${name}” is not listed on My properties`);
      });
    },
  },
  {
    id: 'scanner', name: 'Scanner: build, save and evaluate a setup',
    /* Not the evaluate step: on the live site it passes by checking a
       refusal (gated), and a refusal proves no evaluation. */
    outcomes: ['Build a condition: price crosses above its 20-bar EMA, on AAPL', 'Save the setup', 'The setup’s page shows it'],
    async run(j, tab) {
      const synthetic = OWNER_MACHINE;
      /* THE DASHBOARD'S EXAMPLE (N5b; the owner's decision D14c). With no
         file open, /app/scanner shows the fixture setup evaluated on a
         generated series: labelled so and Illustrative, its three
         conditions in the engine's own words at bar 66 — the page's
         scanEvaluate on scanFixture, asked here in the same tab — each Held,
         series B Not held for RSI on a flat series; and its replay, moved
         bar by bar from 1 to 66 and by the arrow keys, holds the rule at bar
         66 and on no bar before it, Not held from bar 15, the first it can
         be decided on, to 65. Before the synthetic history below: an open
         history is a file open, and the dashboard is then the reader's. */
      await step(j, tab, 'The dashboard shows the example on a generated series', BUDGET.load, async () => {
        await tab.goto('/app/scanner');
        await tab.expect(`!!document.querySelector('main figure.scan-ex')`, 'the dashboard shows no example (figure.scan-ex)');
        const got = await tab.eval(`(() => {
          const f = document.querySelector('main figure.scan-ex');
          const fx = scanFixture(), s = scanNormaliseSetup(fx.setup), C = scanCache();
          const bars = (sym) => scanBars(fx.history, sym, { timeframe: '1D', now: fx.now, calendar: scanCalendar(fx.history, [], null) });
          const rA = scanEvaluate(s.ruleTree, bars('MATCH'), { cache: C }), rB = scanEvaluate(s.ruleTree, bars('FLAT'), { cache: C });
          const badge = f.querySelector('a.kind-badge.kind-illustrative');
          return { cap: (f.querySelector('figcaption')?.textContent || '').replace(/\\s+/g, ' ').trim(),
            badge: badge ? [badge.textContent.trim(), badge.getAttribute('href')] : null,
            rows: [...f.querySelectorAll('li.scan-ex-c')].map(li => [li.querySelector('.scan-ex-x')?.textContent.trim(), li.querySelector('.scan-ex-s')?.textContent.trim(), li.dataset.state]),
            want: rA.conditions.map(c => [c.text, { MET: 'Held', NOT_MET: 'Not held', UNAVAILABLE: 'Unavailable' }[c.state], c.state]),
            verdict: f.querySelector('.scan-ex-v')?.textContent.trim(), state: rA.state,
            b: (f.querySelector('.scan-ex-b')?.textContent || '').replace(/\\s+/g, ' ').trim(), bState: rB.state,
            note: f.querySelector('.scan-ex-note')?.textContent.trim(), text: f.innerText };
        })()`);
        if (!/^Example — generated series, not a market’s prices/.test(got.cap)) throw new StepError(`the example is captioned “${got.cap.slice(0, 80)}”`);
        if (!got.badge || got.badge[0] !== 'Illustrative' || got.badge[1] !== '/data-sources#kinds') throw new StepError('the example carries no Illustrative badge linking /data-sources#kinds');
        if (JSON.stringify(got.rows) !== JSON.stringify(got.want) || got.rows.length !== 3) throw new StepError(`the example's conditions read ${JSON.stringify(got.rows)}, where the engine says ${JSON.stringify(got.want)}`);
        if (got.verdict !== 'Held' || got.state !== 'MET') throw new StepError(`at bar 66 the example says “${got.verdict}”, the engine ${got.state}`);
        if (!got.b.endsWith('Not held; RSI cannot be computed on a flat series.') || got.bState !== 'NOT_MET') throw new StepError(`series B reads “${got.b}”`);
        if (got.note !== 'Shows how a rule is evaluated — not whether it works, and nothing about any market.') throw new StepError('the example does not say it shows how a rule is evaluated, not whether it works');
        if (/\b(approaching|watching|signal|buy|sell)\b|[0-9]{4}-[0-9]{2}-[0-9]{2}|US\$|\bRM\b|\$/i.test(got.text)) throw new StepError('the example shows a date, a currency or a word it may not');
      });
      await step(j, tab, 'Its replay holds the rule only at bar 66', BUDGET.action * 3, async () => {
        const seq = await tab.eval(`(() => {
          const r = document.querySelector('main figure.scan-ex input[type=range]');
          if (!r) return null;
          const out = [];
          for (let i = Number(r.min); i <= Number(r.max); i++) {
            r.value = String(i); r.dispatchEvent(new Event('input', { bubbles: true }));
            out.push(document.querySelector('main figure.scan-ex .scan-ex-v')?.dataset.state || '?');
          }
          return { min: r.min, max: r.max, out };
        })()`);
        if (!seq) throw new StepError('the example has no bar slider');
        const s = seq.out;
        if (seq.min !== '1' || seq.max !== '66' || s.length !== 66) throw new StepError(`the slider replays bars ${seq.min}–${seq.max}, not 1–66`);
        const held = s.map((x, i) => (x === 'MET' ? i + 1 : null)).filter(Boolean);
        if (held.join() !== '66') throw new StepError(`the replay holds the rule at bar${held.length === 1 ? '' : 's'} ${held.join(', ') || 'none'}, not at bar 66 alone`);
        if (!s.slice(14, 65).every(x => x === 'NOT_MET') || !s.slice(0, 14).every(x => x === 'UNAVAILABLE')) throw new StepError(`the replay's verdicts are ${s.map(x => x[0]).join('')}: not Unavailable to bar 14 and Not held from 15 to 65`);
        /* And by the keyboard, as a reader moves it. */
        await tab.click(`document.querySelector('main figure.scan-ex input[type=range]')`, 'The bar slider');
        const at = () => tab.eval(`[document.querySelector('main figure.scan-ex input[type=range]').value, document.querySelector('main figure.scan-ex .scan-ex-v').textContent.trim()].join(' ')`);
        await tab.eval(`(() => { const r = document.querySelector('main figure.scan-ex input[type=range]'); r.value = '66'; r.dispatchEvent(new Event('input', { bubbles: true })); r.focus(); })()`);
        await tab.key('ArrowLeft');
        const left = await at();
        await tab.key('ArrowRight');
        const right = await at();
        if (left !== '65 Not held' || right !== '66 Held') throw new StepError(`by the arrow keys the replay read “${left}” then “${right}”, not “65 Not held” then “66 Held”`);
      });
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
      /* On the deployed site the step passes by checking a refusal, and is
         recorded as gated: it proves the page says why it cannot evaluate,
         not that an evaluation ran (N1b). */
      }, synthetic ? undefined : { gated: 'no prices ship' });
    },
  },
  {
    id: 'ctas', name: 'Primary calls to action land on working pages',
    /* Landings only: a press that reaches a working page proves the link,
       not the tool behind it (D15). */
    outcomes: [],
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
      /* The product cards under "What would you like to do?": each card's
         task (its one action, plan 3.3), the Property card's "Try the
         Scenario Lab", and the Equities chart's link to Apple's page — not
         what a closed ⓘ holds. */
      const CARDS = '#products a.pub-card-link[href], #products .pub-card-also a[href], #products a.pub-vis-link[href]';
      /* A control's name as a reader reads it: a card's or a link's heading
         where it has one, else its text. */
      const LABEL = `(n) => (n.getAttribute('aria-label') || n.querySelector('h3, strong')?.textContent || n.textContent).trim().replace(/\\s+/g, ' ').slice(0, 60)`;
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

      /* THE HOMEPAGE'S PROPERTY CARD (plan item 3.8): the compact Scenario
         Lab on the sample deal. Its price, moved to the far end of its
         span, moves all three of its figures — Monthly repayment, Cash
         required and Monthly position — in place. A failure here is
         recorded with the presses. */
      await load('/').catch(() => {});
      {
        const r = await timed(j, tab, 'Homepage Property card: moving the price moves its three figures', BUDGET.action, async () => {
          const m = await tab.eval(`(async () => {
            const r = document.querySelector('#pub-lab-price');
            if (!r) return null;
            const read = () => [...document.querySelectorAll('[data-product="property"] .pub-lab-figs dd')].map(d => d.textContent.trim());
            const before = read();
            r.focus();
            r.value = String(Number(r.max)); r.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(res => setTimeout(res, 150));
            return { before, after: read(), price: document.querySelector('#pub-lab-price-v')?.textContent.trim() };
          })()`);
          if (!m) throw new StepError('the homepage has no Property price to move');
          if (m.before.length !== 3) throw new StepError(`the Property card shows ${m.before.length} figures, not three`);
          const still = m.after.map((v, i) => (v === m.before[i] ? i : -1)).filter(i => i >= 0);
          if (still.length) throw new StepError(`at ${m.price} the Property card's figures ${m.before.join(', ')} became ${m.after.join(', ')} — ${still.length} did not move`);
        });
        if (r.ok) checked++;
        else failures.push({ step: 'Homepage Property card: moving the price moves its three figures', route: '/', why: r.why });
      }

      /* Each product's own row of tabs, pressed along the row as a reader
         moves through a product — from its landing: Property's is the
         Scenario Lab since N3 (D18), the calculator one of its tabs. */
      for (const [product, source] of [['Equities', '/research'], ['Property', '/property'], ['Scanner', '/app/scanner']]) {
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

/* THE OUTCOME STEPS (D15). By journey: the steps that do something and
   check the result it must produce — what a 'live' row's proof may name
   (register-check). A journey's own declaration, held to its code twice:
   the self-test finds each name as a step the journey's run takes, and a
   run that completes without taking one of them fails (main, below). */
export const OUTCOME_STEPS = Object.freeze(Object.fromEntries(JOURNEYS.map(x => [x.id, Object.freeze([...(x.outcomes || [])])])));
export const JOURNEY_NAMES = Object.freeze(Object.fromEntries(JOURNEYS.map(x => [x.id, x.name])));

/* ─── RUN ─────────────────────────────────────────────────────────────────── */
async function main() {
  await where();
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
      /* A journey that completed without one of the outcome steps it
         declares would be recorded as proving what it never checked. */
      const skipped = (def.outcomes || []).filter(n => !j.steps.some(s => s.name === n));
      if (j.status !== 'FAIL' && skipped.length) j.fail(skipped[0], tab ? await tab.where() : null, `the check itself broke: the journey declares “${skipped.join('”, “')}” an outcome step and never took it`);
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

  const doc = { kind: RESULT_KIND, schema: 2, ranAt, url: BASE, commit: who.commit, commitFrom: who.commitFrom, ...(TRIGGER ? { trigger: TRIGGER } : {}), ...(RUN ? { run: RUN } : {}), journeys: results.map(r => r.toJSON()) };
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

if (MAIN && has('self-test')) selfTest();
if (MAIN) main().catch(e => { console.error(`FAIL  the journeys could not run: ${e.stack || e.message}`); process.exit(2); });
