#!/usr/bin/env node
/**
 * What CI found on a commit, suite by suite — recorded, and served on /status.
 *
 *   node checks-record.mjs run <suite> -- <command…>
 *                        run one suite as checks.yml runs it: its output passes through
 *                        unchanged and is kept, with its exit code, for summarize
 *                        (in $QT_CHECKS_DIR, or $RUNNER_TEMP/qt-checks); exits with its code
 *   node checks-record.mjs summarize --job <static|runtime> [--dir <d>] [--json <file>]
 *                        each suite of that job of checks.yml, from what it printed and how
 *                        it exited: PASS, FAIL or NOT RUN, with its counts as it printed
 *                        them. A table to the job summary, and one annotation a suite
 *                        (::notice title=qt-check <id>::{…}), which the GitHub API serves
 *                        to anyone — no token — so the journeys workflow can read them
 *   node checks-record.mjs collect --commit <sha> [--repo <owner/name>] --out <file>
 *            [--wait <s>] [--entries <a.json,b.json>]
 *                        health/checks.json for that commit: the latest finished run of
 *                        checks.yml on it, and each suite's annotation from that run's
 *                        jobs. A suite with none reads NOT RUN — never PASS. --wait polls
 *                        while a run on the commit is still going; --entries builds the
 *                        record from summarize's --json files instead (offline)
 *   node checks-record.mjs --self-test
 *                        offline: a missing suite reads "Not run for <commit>", never PASS;
 *                        the counts are the ones the suites printed; the served block; the
 *                        workflows that run the suites, summarize them and record them
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (the daily audit of 10 Oct 2026, items 3 and 7)
 *
 * /status reported the journeys on the live site and nothing else that was
 * checked. The suites that hold the numbers — 195 model invariants, 286
 * equities checks, the scanner engine, the SEC ingest, the price-history
 * store — the data checks, and the phone-width and served-page checks ran on
 * every commit in CI, and their results stayed in the Actions log. The
 * in-browser known-answer checks were served "Not run" (served pages cannot
 * run them), so a reader without script read no numerical result at all.
 *
 * So each suite's result is recorded per commit, in four kinds published
 * separately — Journeys (journeys.mjs on the live site), Numbers, Data, and
 * Layout & served pages — each with its counts as the suite printed them,
 * the commit and time it ran on, and the Actions run. A suite that did not
 * run for the commit served reads "Not run for <commit>": a missing result
 * is never a pass.
 *
 * HOW IT FLOWS
 *   1. checks.yml runs each suite through `run`, which keeps its output and
 *      exit code; a last step of each job (if: always()) runs `summarize`,
 *      which writes one annotation a suite. A suite whose step never ran (a
 *      step before it failed, the job was cancelled) leaves no output, and
 *      reads NOT RUN.
 *   2. journeys.yml, after the journeys on the live site, runs `collect` for
 *      the commit the site serves and copies the record over
 *      health/checks.json — in the same bot commit as health/journeys.json,
 *      under the same rule and the same loop guard (journeys.mjs decide and
 *      --guard): a commit that changes only health/ and, by the bot, the
 *      island pages is the record's own, and its deployment records nothing.
 *   3. build.mjs writes the record into /status (checksServed, below), and
 *      the page's script draws the same words with the same function.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAIN = /checks-record\.mjs$/.test(process.argv[1] || '');
const argv = MAIN ? process.argv.slice(2) : [];
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const CHECKS_KIND = 'quantum-tradeworks-checks';
export const CHECKS_FILE = 'health/checks.json';
export const REPO = 'georgewong1014-pixel/quantum-tradeworks';
export const STATUSES = ['PASS', 'FAIL', 'NOT RUN'];
/* The annotation's title: what collect looks for in a job's annotations. */
export const ANNOTATION = 'qt-check';

/* THE SUITES, BY KIND. Each is a step of checks.yml run through `run` under
   its own id (run), in one of its jobs (job: static is "parses, and matches
   its source", runtime is "every route renders"), and recorded under one of
   the kinds /status publishes. served-check prints its data blocks' own
   tally ("data blocks: N passed, M failed"), so it is recorded twice: its
   data blocks under Data, the rest under Layout & served pages. */
export const SUITES = Object.freeze([
  { id: 'model-test', run: 'model-test', job: 'runtime', kind: 'numbers', name: 'model-test', what: 'the property model: every published figure the quantity its label claims' },
  { id: 'equity-test', run: 'equity-test', job: 'runtime', kind: 'numbers', name: 'equity-test', what: 'the filed statements labelled and derived as they claim' },
  { id: 'scanner-test', run: 'scanner-test', job: 'static', kind: 'numbers', name: 'scanner-test', what: 'the scanner engine on hand-computed series and its fixture' },
  { id: 'ingest-test', run: 'ingest-test', job: 'static', kind: 'numbers', name: 'ingest-test', what: 'the SEC ingest picks the year-end figure' },
  { id: 'history-store-test', run: 'history-store-test', job: 'static', kind: 'numbers', name: 'history-store-test', what: 'the price-history store validates, ranks, trims and dates bars' },
  { id: 'data-check', run: 'data-check', job: 'static', kind: 'data', name: 'data-check', what: 'the shipped dataset passes the ingest’s own validation' },
  { id: 'register-check', run: 'register-check', job: 'static', kind: 'data', name: 'register-check', what: 'the capability register claims only what its routes and checks support' },
  { id: 'served-check-data', run: 'served-check', part: 'data', job: 'static', kind: 'data', name: 'served-check, data blocks', what: 'the data files and the health records served as they are committed' },
  { id: 'served-check', run: 'served-check', part: 'pages', job: 'static', kind: 'layout', name: 'served-check, pages', what: 'every address served its own head, render and headers' },
  { id: 'build-check', run: 'build-check', job: 'static', kind: 'layout', name: 'build --check', what: 'the committed pages, app files and renders match their source' },
  { id: 'prerender-check', run: 'prerender-check', job: 'runtime', kind: 'layout', name: 'prerender --check', what: 'every served page is the app’s own render of it' },
  { id: 'sweep', run: 'sweep', job: 'runtime', kind: 'layout', name: 'sweep', what: 'every route renders with no error, NaN or overflow' },
  { id: 'coverage-frames', run: 'coverage-frames', job: 'runtime', kind: 'layout', name: 'coverage-frames', what: 'no page contradicts itself or moves in its first frames' },
  { id: 'mobile', run: 'mobile', job: 'runtime', kind: 'layout', name: 'mobile', what: 'no horizontal overflow from 360 to 1440, no focus stop hidden' },
]);
export const KINDS = Object.freeze([
  { id: 'journeys', name: 'Journeys', of: 'journeys.mjs, on the live site' },
  { id: 'numbers', name: 'Numbers', of: 'known-answer and invariant suites, in CI' },
  { id: 'data', name: 'Data', of: 'the shipped data and the register, in CI' },
  { id: 'layout', name: 'Layout & served pages', of: 'phone widths, first frames and served pages, in CI' },
]);
export const JOBS = { static: 'parses, and matches its source', runtime: 'every route renders' };
export const RUNS = [...new Set(SUITES.map(s => s.run))];

/* ─── WHAT EACH SUITE PRINTED ─────────────────────────────────────────────── */
/* The counts a suite printed, read from its own last summary line: passed,
   failed, and the line (said). Every suite prints one; where one prints no
   tally (coverage-frames, mobile), its "ok" and "FAIL" lines are counted. */
const last = (log, re) => { let m = null; for (const x of log.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) m = x; return m; };
const lineOf = (log, m) => (m ? log.slice(log.lastIndexOf('\n', m.index) + 1, (log.indexOf('\n', m.index) + 1 || log.length + 1) - 1).trim() : null);
const tallyLines = (log) => ({ passed: (log.match(/^ok\b/gm) || []).length, failed: (log.match(/^FAIL\b/gm) || []).length });
const allHold = (re) => (log) => {
  const all = last(log, re), mixed = last(log, /(\d+) failed, (\d+) passed/);
  if (mixed && (!all || mixed.index > all.index)) return { passed: +mixed[2], failed: +mixed[1], said: lineOf(log, mixed) };
  return all ? { passed: +all[1], failed: 0, said: lineOf(log, all) } : null;
};
const passedFailed = (log) => { const m = last(log, /^(\d+) passed, (\d+) failed\b/m); return m ? { passed: +m[1], failed: +m[2], said: lineOf(log, m) } : null; };
const PARSE = {
  'model-test': allHold(/all (\d+) model invariants hold/),
  'equity-test': passedFailed,
  'scanner-test': allHold(/all (\d+) scanner checks hold/),
  'ingest-test': allHold(/all (\d+) ingest rules hold/),
  'history-store-test': allHold(/all (\d+) history-store checks hold/),
  'data-check': passedFailed,
  'register-check': allHold(/all (\d+) register rules hold/),
  'served-check': (log, part) => {
    const all = passedFailed(log);
    const d = last(log, /^data blocks[^:\n]*: (\d+) passed, (\d+) failed/m);
    if (!all || !d) return null;
    const passed = all.passed - +d[1], failed = all.failed - +d[2];
    if (part === 'data') return { passed: +d[1], failed: +d[2], otherFailed: failed, said: lineOf(log, d) };
    return { passed, failed, otherFailed: +d[2], said: `${passed} passed, ${failed} failed (of ${all.said}; the data blocks apart)` };
  },
  'build-check': (log) => {
    const m = last(log, /(\d+) of them \((\d+) in scope\) carry their committed render/);
    const head = last(log, /^.*match src\/.*$/m);
    if (m) return { passed: +m[1], failed: +m[2] - +m[1], said: lineOf(log, m).replace(/^every page carries the navigation NAV_MARKUP draws; /, '') };
    return head ? { passed: null, failed: null, said: lineOf(log, head) } : null;
  },
  'prerender-check': (log) => { const m = last(log, /(\d+) of (\d+) pages are the app’s own render as committed/); return m ? { passed: +m[1], failed: +m[2] - +m[1], said: lineOf(log, m) } : null; },
  sweep: (log) => { const m = last(log, /^(\d+)\/(\d+) routes clean/m); return m ? { passed: +m[1], failed: +m[2] - +m[1], said: lineOf(log, m) } : null; },
  'coverage-frames': (log) => { const t = tallyLines(log); return t.passed + t.failed ? { ...t, said: `${t.passed} passed, ${t.failed} failed` } : null; },
  mobile: (log) => {
    const t = tallyLines(log), end = last(log, /^(no horizontal overflow at any width[^\n]*|\d+ genuine issues[^\n]*)$/m);
    return end ? { ...t, said: `${end[1]} (${t.passed} ok, ${t.failed} FAIL)` } : null;
  },
};

/* One suite's result from its run: the output it printed and the code it
   exited with. No output: its step never ran (NOT RUN). Output and no exit
   code: it started and did not finish (FAIL). A pass needs both an exit of
   0 and no failure in what it printed. */
export function judgeSuite(suite, log, exit) {
  const base = { id: suite.id, name: suite.name, kind: suite.kind, job: suite.job };
  if (log == null) return { ...base, status: 'NOT RUN', passed: null, failed: null, said: 'its step did not run', exit: null };
  const counts = PARSE[suite.run]?.(String(log).replace(/\r\n/g, '\n'), suite.part) || null;
  const said = (counts?.said || '').slice(0, 220) || null;
  if (exit == null || !Number.isFinite(exit)) return { ...base, status: 'FAIL', passed: counts?.passed ?? null, failed: counts?.failed ?? null, said: said || 'it started and did not finish', exit: null };
  const failed = counts?.failed ?? null;
  let status = exit === 0 && !(failed > 0) ? 'PASS' : 'FAIL';
  /* A part of served-check (its data blocks, or the rest) fails when its own
     blocks failed. A failing exit with none failed in this part passes it
     only when the other part's failures account for the exit; with no tally
     to tell, both parts fail. */
  if (suite.part && exit !== 0 && counts && !(failed > 0) && counts.otherFailed > 0) status = 'PASS';
  return { ...base, status, passed: counts?.passed ?? null, failed, said: said || (exit === 0 ? 'exited 0, printing no tally' : `exited ${exit}, printing no tally`), exit };
}

export function summarize(job, dir) {
  return SUITES.filter(s => s.job === job).map(s => {
    const logF = join(dir, `${s.run}.log`), exitF = join(dir, `${s.run}.exit`);
    const log = existsSync(logF) ? readFileSync(logF, 'utf8') : null;
    const exit = existsSync(exitF) ? Number(readFileSync(exitF, 'utf8').trim()) : null;
    return judgeSuite(s, log, exit);
  });
}

/* A workflow command's data and properties, escaped as the runner unescapes
   them. */
export const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
export const annotation = (e) => `::notice title=${escProp(`${ANNOTATION} ${e.id}`)}::${escData(JSON.stringify(e))}`;
/* What collect reads back: an annotation's title and message, as the API
   serves them (unescaped). */
export function fromAnnotation(a) {
  const m = new RegExp(`^${ANNOTATION} ([a-z0-9-]+)$`).exec(String(a?.title || ''));
  if (!m) return null;
  try {
    const e = JSON.parse(String(a.message || ''));
    return e && e.id === m[1] && STATUSES.includes(e.status) ? e : null;
  } catch { return null; }
}

/* ─── THE RECORD ──────────────────────────────────────────────────────────── */
const RUN_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/;
export const placeholder = () => ({ kind: CHECKS_KIND, schema: 1, commit: null, recordedAt: null, run: null, ranAt: null, event: null, conclusion: null,
  note: 'No CI result recorded yet. .github/workflows/journeys.yml replaces this file, with health/journeys.json, with the results of checks.yml on the commit the site serves (checks-record.mjs collect).', suites: [] });

/* Every suite of SUITES, from what a run of checks.yml recorded on the
   commit: a suite with no entry is NOT RUN. */
export function record({ commit, run = null, ranAt = null, event = null, conclusion = null, entries = [], note = null, now = new Date() }) {
  const by = new Map(entries.filter(Boolean).map(e => [e.id, e]));
  const suites = SUITES.map(s => {
    const e = by.get(s.id);
    if (!e || !STATUSES.includes(e.status)) return { id: s.id, name: s.name, kind: s.kind, job: s.job, status: 'NOT RUN', passed: null, failed: null, said: run ? 'no result from this run on the commit' : 'no run on the commit', exit: null };
    return { id: s.id, name: s.name, kind: s.kind, job: s.job, status: e.status, passed: Number.isFinite(e.passed) ? e.passed : null, failed: Number.isFinite(e.failed) ? e.failed : null, said: e.said ? String(e.said).slice(0, 220) : null, exit: Number.isFinite(e.exit) ? e.exit : null };
  });
  return { kind: CHECKS_KIND, schema: 1, commit: commit || null, recordedAt: now.toISOString(), run: RUN_URL.test(String(run || '')) ? run : null, ranAt: ranAt || null, event, conclusion, note, suites };
}

export function checksProblem(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'not an object';
  if (doc.kind !== CHECKS_KIND) return `kind is ${JSON.stringify(doc.kind)}, not ${CHECKS_KIND}`;
  if (!Array.isArray(doc.suites)) return 'it lists no suites';
  if (doc.commit == null && !doc.suites.length) return null;   /* the placeholder */
  if (doc.commit != null && !/^[0-9a-f]{7,40}$/.test(String(doc.commit))) return `commit is ${JSON.stringify(doc.commit)}`;
  if (doc.run != null && !RUN_URL.test(String(doc.run))) return `run is ${JSON.stringify(doc.run)}, not an Actions run's address`;
  for (const s of doc.suites) {
    if (!s || typeof s.id !== 'string' || !STATUSES.includes(s.status)) return `a suite has no id, or a status outside ${STATUSES.join(', ')}`;
    if (s.status === 'PASS' && s.failed > 0) return `suite ${s.id} passes with ${s.failed} failed`;
  }
  return null;
}

/* ─── SERVED (/status) ────────────────────────────────────────────────────── */
/* ONE RENDERER, as journeysServed (journeys.mjs) is: build.mjs writes its
   output into the served /status, and puts its source into the app in place
   of the marker in 91-health.js, so the page's script draws the same words
   with the same function. Pure and self-contained — it reads nothing outside
   itself and its arguments (suites is SUITES, passed in, and put into the
   app beside it) — and it writes only escaped text, Actions run links and
   anchors on the page. Times are UTC.
     checks    health/checks.json (or null)
     journeys  health/journeys.json (or null)
   Returns
     kinds  the inner HTML of #health-kinds: one li a kind — Journeys,
            Numbers, Data, Layout & served pages — its status (Pass, Fail,
            Degraded, Not run), its counts, the commit and time it ran on and
            its Actions run; under each CI kind, each suite as it printed
     ci     the inner HTML of #health-ci, under "Checked in your browser
            now": the CI results for this commit beside the checks the tab
            runs, so a reader with no script reads a result, not a bare
            "Not run"
     status the four statuses by kind, for the checks.
   A CI kind passes only when every one of its suites passed on the commit
   the site serves. The record names its commit; one for another commit than
   the journeys' (the site's) is no result for this one, and a suite missing
   from it, or recorded NOT RUN, reads "Not run for <commit>". */
export function checksServed(checks, journeys, suites) {
  const REPO_URL = 'https://github.com/georgewong1014-pixel/quantum-tradeworks';
  const KINDS = [['journeys', 'Journeys', 'journeys.mjs, on the live site'], ['numbers', 'Numbers', 'known-answer and invariant suites, in CI'],
    ['data', 'Data', 'the shipped data and the register, in CI'], ['layout', 'Layout & served pages', 'phone widths, first frames and served pages, in CI']];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CHIP = { PASS: ['chip-ok', 'Pass'], DEGRADED: ['chip-warn', 'Degraded'], FAIL: ['chip-critical', 'Fail'], 'NOT RUN': ['', 'Not run'] };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const two = (n) => (n < 10 ? '0' : '') + n;
  const when = (iso) => { const d = typeof iso === 'string' ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes()) + ' UTC' : null; };
  const sha7 = (s) => (/^[0-9a-f]{7,40}$/.test(String(s || '')) ? String(s).slice(0, 7) : null);
  const runOk = (u) => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(String(u || ''));
  const n = (k) => Number(k).toLocaleString('en-US');
  const list = Array.isArray(suites) ? suites : [];
  /* The commit the site serves: the journeys' record names it. */
  const jdoc = journeys && typeof journeys.ranAt === 'string' && Array.isArray(journeys.journeys) && journeys.journeys.length ? journeys : null;
  const site = sha7(jdoc && jdoc.commit);
  const cdoc = checks && Array.isArray(checks.suites) && sha7(checks.commit) ? checks : null;
  /* CI's results count for the site's commit only — or, with no journeys
     record to name one, for the commit the record names. */
  const forSite = !!cdoc && (!site || sha7(cdoc.commit) === site);
  const target = site || sha7(cdoc && cdoc.commit);
  const byId = {};
  if (forSite) cdoc.suites.forEach(s => { if (s && typeof s.id === 'string') byId[s.id] = s; });
  const ciRun = forSite && runOk(cdoc.run) ? cdoc.run : null;
  const ciAt = forSite ? when(cdoc.ranAt) : null;
  const log = (url, words) => '<a class="journeys-log" href="' + esc(url) + '">' + words + '</a>';
  const notRunFor = 'Not run' + (target ? ' for ' + target : '');
  const status = {};
  const rows = KINDS.map(([id, name, of]) => {
    let st, line, items = '';
    if (id === 'journeys') {
      const js = jdoc ? jdoc.journeys.filter(j => j && CHIP[j.status] && j.status !== 'NOT RUN') : [];
      if (!js.length) { st = 'NOT RUN'; line = 'Not run yet: no run of the journeys on the live site is recorded.'; }
      else {
        const c = (s) => js.filter(j => j.status === s).length;
        st = c('FAIL') ? 'FAIL' : c('DEGRADED') ? 'DEGRADED' : 'PASS';
        /* The failing journeys by name; their steps are listed below. */
        const failed = js.filter(j => j.status === 'FAIL').map(j => esc(j.name));
        line = c('PASS') + ' of ' + js.length + ' journeys pass' + (c('DEGRADED') ? ', ' + c('DEGRADED') + ' degraded' : '') + (c('FAIL') ? ', ' + c('FAIL') + ' failed (' + failed.join('; ') + ')' : '')
          + ' · the live site, ' + (when(jdoc.ranAt) || 'its time not recorded') + (site ? ' · ' + site : ', its commit not identified') + ' · '
          + (runOk(jdoc.run) ? log(jdoc.run, 'run log') : log(REPO_URL + '/actions/workflows/journeys.yml', 'run history'));
      }
    } else {
      const mine = list.filter(s => s.kind === id);
      const got = mine.map(s => {
        const r = byId[s.id];
        return r && (r.status === 'PASS' || r.status === 'FAIL') ? { s, r } : { s, r: null };
      });
      const pass = got.filter(x => x.r && x.r.status === 'PASS').length, fail = got.filter(x => x.r && x.r.status === 'FAIL').length, none = got.length - pass - fail;
      st = !got.length ? 'NOT RUN' : fail ? 'FAIL' : none ? 'NOT RUN' : 'PASS';
      const checked = got.reduce((a, x) => a + (x.r && Number.isFinite(x.r.passed) ? x.r.passed : 0), 0);
      const ofChecks = got.reduce((a, x) => a + (x.r && Number.isFinite(x.r.passed) ? x.r.passed + (Number.isFinite(x.r.failed) ? x.r.failed : 0) : 0), 0);
      const where = (forSite ? 'CI on ' + target + (ciAt ? ', ' + ciAt : '') : notRunFor) + ' · ' + (ciRun ? log(ciRun, 'run log') : log(REPO_URL + '/actions/workflows/checks.yml', 'run history'));
      if (st === 'NOT RUN') {
        line = notRunFor + ': ' + (none === got.length ? (got.length === 1 ? 'its one suite has no result' : 'none of its ' + got.length + ' suites has a result') + ' recorded for this commit'
          : none + ' of its ' + got.length + ' suites ' + (none === 1 ? 'has' : 'have') + ' no result for this commit; ' + pass + ' passed')
          + ' · ' + (ciRun ? log(ciRun, 'run log') : log(REPO_URL + '/actions/workflows/checks.yml', 'run history'));
      } else {
        line = pass + ' of ' + got.length + ' suites pass' + (fail ? ', ' + fail + ' failed' : '') + (none ? ', ' + none + ' not run' : '') + (ofChecks ? ' · ' + n(checked) + ' of ' + n(ofChecks) + ' checks' : '') + ' · ' + where;
      }
      items = '<ol class="kind-suites" aria-label="' + esc(name) + ': each suite">' + got.map(({ s, r }) => {
        const mark = r ? (r.status === 'PASS' ? 'PASS' : 'FAIL') : 'Not run';
        const said = r ? (r.said ? esc(r.said) : r.status === 'PASS' ? 'passed' : 'failed') : 'not run for ' + (target || 'this commit');
        const count = r && Number.isFinite(r.passed) ? ' <span class="kind-count">' + n(r.passed) + '/' + n(r.passed + (Number.isFinite(r.failed) ? r.failed : 0)) + '</span>' : '';
        return '<li data-mark="' + (r ? (r.status === 'PASS' ? 'ok' : 'fail') : 'notrun') + '"><span class="kind-mark">' + mark + '</span> ' + esc(s.name) + count + '<span class="kind-said"> — ' + said + '</span></li>';
      }).join('') + '</ol>';
    }
    status[id] = st;
    return '<li class="kind-row" id="kind-' + id + '" data-status="' + st.replace(' ', '-') + '">'
      + '<span class="chip health-chip' + (CHIP[st][0] ? ' ' + CHIP[st][0] : '') + '">' + CHIP[st][1] + '</span>'
      + '<p class="kind-name">' + esc(name) + '<span class="kind-of"> · ' + esc(of) + '</span></p>'
      + '<div class="kind-body"><p class="caption">' + line + '</p>' + items + '</div></li>';
  }).join('');
  /* The line beside the in-browser checks: what CI found on this commit for
     the two kinds those checks sample. */
  const ciSaid = ['numbers', 'data'].map(id => {
    const name = KINDS.find(k => k[0] === id)[1];
    if (status[id] === 'NOT RUN') return name + ' not run for ' + (target || 'this commit');
    const mine = list.filter(s => s.kind === id);
    const pass = mine.filter(s => byId[s.id] && byId[s.id].status === 'PASS').length;
    const checked = mine.reduce((a, s) => a + (byId[s.id] && Number.isFinite(byId[s.id].passed) ? byId[s.id].passed : 0), 0);
    const of = mine.reduce((a, s) => a + (byId[s.id] && Number.isFinite(byId[s.id].passed) ? byId[s.id].passed + (Number.isFinite(byId[s.id].failed) ? byId[s.id].failed : 0) : 0), 0);
    return name + ' ' + status[id] + ' (' + pass + ' of ' + mine.length + ' suites' + (of ? ', ' + n(checked) + '/' + n(of) + ' checks' : '') + ')';
  });
  const ci = 'Runs in your browser when the page loads — results for this commit from CI: ' + ciSaid.join(' · ')
    + (forSite ? ' · ' + target + (ciAt ? ', ' + ciAt : '') : '') + ' · <a class="journey-line-link" href="#health-kinds-h">details</a>';
  return { kinds: rows, ci, status, commit: target };
}

/* ─── COLLECT (journeys.yml) ──────────────────────────────────────────────── */
async function api(path) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'quantum-tradeworks-checks-record' };
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}`;
  let r = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30000) });
  /* The repository is public: what a token is refused, anyone may read. */
  if ((r.status === 403 || r.status === 401) && headers.authorization) {
    delete headers.authorization;
    r = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30000) });
  }
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
/* The run to read: the latest run of checks.yml on the commit that finished
   (not cancelled — a newer push cancels one, and it ran nothing to its end).
   While none has and one is still going, wait for it, up to `wait` seconds. */
export function pickRun(runs) {
  const done = runs.filter(r => r.status === 'completed' && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { run: done[0] || null, going: runs.some(r => r.status !== 'completed') };
}
async function collect({ commit, repo, wait }) {
  if (!/^[0-9a-f]{7,40}$/.test(commit || '')) return record({ commit: null, note: 'the commit the site serves was not identified, so no CI run could be matched to it' });
  const deadline = Date.now() + wait * 1000;
  let picked = null;
  for (let first = true; ; first = false) {
    const runs = (await api(`/repos/${repo}/actions/workflows/checks.yml/runs?head_sha=${commit}&per_page=30`)).workflow_runs || [];
    picked = pickRun(runs);
    if (picked.run) break;
    /* No run at all: give a just-pushed commit two minutes to start one. */
    const keepWaiting = picked.going || (!runs.length && first);
    if (!keepWaiting || Date.now() > deadline) break;
    console.log(`checks.yml on ${commit.slice(0, 12)}: ${runs.length ? 'still running' : 'no run yet'} — waiting`);
    await sleep(60000);
  }
  const run = picked.run;
  if (!run) return record({ commit, note: picked.going ? `checks.yml was still running on this commit after ${wait}s` : 'checks.yml has no finished run on this commit' });
  const jobs = (await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`)).jobs || [];
  const entries = [];
  for (const job of jobs) {
    const notes = await api(`/repos/${repo}/check-runs/${job.id}/annotations?per_page=100`).catch(() => []);
    for (const a of notes) { const e = fromAnnotation(a); if (e) entries.push(e); }
  }
  return record({ commit, run: run.html_url, ranAt: run.updated_at, event: run.event, conclusion: run.conclusion, entries,
    note: entries.length ? null : 'the run on this commit recorded no suite (it ran before checks.yml recorded them, or its jobs did not reach their last step)' });
}

/* ─── SELF-TEST ───────────────────────────────────────────────────────────── */
function selfTest() {
  let bad = 0;
  const t = (ok, what) => { if (ok) console.log(`ok    ${what}`); else { bad++; console.error(`FAIL  ${what}`); } };
  const S = (id) => SUITES.find(s => s.id === id);
  /* Outputs as the suites print them (their last lines, from real runs). */
  const OUT = {
    'model-test': 'ok   p3 A1: the waterfall …\n\nall 195 model invariants hold\n',
    'model-test-bad': 'FAIL l13: …\n\n2 failed, 193 passed. A figure that fails one of these is mislabelled, not merely imprecise.\n',
    'equity-test': 'ok   bot pages …\n\n286 passed, 0 failed\n',
    'served-check': 'ok    / is served …\nok    data/*.json …\n\ndata blocks (data/*.json, the NAPIC extract, /health/journeys.json, /health/checks.json): 4 passed, 0 failed\n\n38 passed, 0 failed\n',
    'served-check-data-bad': 'FAIL  the journeys result is not served as it is now\n\ndata blocks (data/*.json, the NAPIC extract, /health/journeys.json, /health/checks.json): 3 passed, 1 failed\n\n37 passed, 1 failed\n',
    'served-check-pages-bad': 'FAIL  a served page …\n\ndata blocks (data/*.json, the NAPIC extract, /health/journeys.json, /health/checks.json): 4 passed, 0 failed\n\n37 passed, 1 failed\n',
    'build-check': 'every page carries the navigation NAV_MARKUP draws; 181 of them (181 in scope) carry their committed render of the page in #views exactly, under prerender/.\n',
    'prerender-check': '\n181 of 181 pages are the app’s own render as committed\n',
    sweep: 'ok   deep links: …\n\n70/70 routes clean\n',
    'coverage-frames': 'ok   /status …\nok   /property/lab …\nFAIL served pages\n',
    mobile: 'ok   layout-system: …\nok   scenario-lab-verify: …\n\nno horizontal overflow at any width, and no focus stop hidden\n',
  };
  const j = (id, out, exit) => judgeSuite(S(id), out, exit);
  /* The counts are the ones the suite printed. */
  const m = j('model-test', OUT['model-test'], 0);
  t(m.status === 'PASS' && m.passed === 195 && m.failed === 0 && m.said === 'all 195 model invariants hold', `counts from the output: model-test "all 195 model invariants hold" → PASS 195/195 (${m.status} ${m.passed}/${m.failed})`);
  const mb = j('model-test', OUT['model-test-bad'], 1);
  t(mb.status === 'FAIL' && mb.passed === 193 && mb.failed === 2, `counts from the output: "2 failed, 193 passed" → FAIL 193 + 2 (${mb.status} ${mb.passed}/${mb.failed})`);
  const e = j('equity-test', OUT['equity-test'], 0);
  t(e.status === 'PASS' && e.passed === 286 && e.failed === 0, `counts from the output: equity-test "286 passed, 0 failed" → PASS 286 (${e.passed})`);
  t(j('equity-test', OUT['equity-test'], 1).status === 'FAIL', 'an exit other than 0 is a FAIL, whatever the output says');
  t(j('equity-test', '\n3 passed, 1 failed\n', 0).status === 'FAIL', 'a failure in the output is a FAIL, whatever the exit code');
  t(j('model-test', null, null).status === 'NOT RUN' && j('model-test', null, 0).status === 'NOT RUN', 'no output: the suite\'s step never ran — NOT RUN');
  t(j('model-test', 'ok   l1 …\n', null).status === 'FAIL', 'output and no exit code: it started and did not finish — FAIL, never PASS');
  const sd = judgeSuite(S('served-check-data'), OUT['served-check'], 0), sp = judgeSuite(S('served-check'), OUT['served-check'], 0);
  t(sd.status === 'PASS' && sd.passed === 4 && sp.status === 'PASS' && sp.passed === 34, `served-check's data blocks apart: data 4 passed, pages 34 (of 38) (${sd.passed}, ${sp.passed})`);
  t(judgeSuite(S('served-check-data'), OUT['served-check-data-bad'], 1).status === 'FAIL' && judgeSuite(S('served-check'), OUT['served-check-data-bad'], 1).status === 'PASS',
    'served-check: a data block that fails fails the data part only');
  t(judgeSuite(S('served-check-data'), OUT['served-check-pages-bad'], 1).status === 'PASS' && judgeSuite(S('served-check'), OUT['served-check-pages-bad'], 1).status === 'FAIL',
    'served-check: a page block that fails fails the pages part only');
  t(judgeSuite(S('served-check-data'), 'crashed\n', 1).status === 'FAIL' && judgeSuite(S('served-check'), 'crashed\n', 1).status === 'FAIL', 'served-check with no tally and a failing exit: both parts FAIL');
  const b = j('build-check', OUT['build-check'], 0), pr = j('prerender-check', OUT['prerender-check'], 0), sw = j('sweep', OUT.sweep, 0), cfr = j('coverage-frames', OUT['coverage-frames'], 1), mo = j('mobile', OUT.mobile, 0);
  t(b.passed === 181 && b.failed === 0 && pr.passed === 181 && sw.passed === 70 && sw.failed === 0 && cfr.passed === 2 && cfr.failed === 1 && cfr.status === 'FAIL' && mo.passed === 2 && mo.status === 'PASS',
    `counts from the output: build --check 181 renders, prerender 181 of 181, sweep 70/70 routes, coverage-frames and mobile by their ok and FAIL lines (${b.passed}, ${pr.passed}, ${sw.passed}, ${cfr.passed}+${cfr.failed}, ${mo.passed})`);
  /* The annotation, round trip. */
  const ann = annotation({ ...m, said: 'all 195 hold: 4.80%, a, b' });
  const msg = ann.slice(ann.indexOf('::', 2) + 2).replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%25/g, '%');
  const title = /title=([^:]*)::/.exec(ann)[1].replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%25/g, '%');
  t(/^::notice title=qt-check model-test::\{/.test(ann) && fromAnnotation({ title, message: msg })?.passed === 195 && fromAnnotation({ title: 'other', message: msg }) === null && fromAnnotation({ title: 'qt-check sweep', message: msg }) === null,
    'the annotation: "qt-check <id>" over the entry as JSON, read back only under its own id');
  /* The record: every suite, and a missing one NOT RUN. */
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  const entries = SUITES.map(s => ({ id: s.id, status: 'PASS', passed: 10, failed: 0, said: `all 10 ${s.id} hold`, exit: 0 }));
  const full = record({ commit: sha, run: 'https://github.com/georgewong1014-pixel/quantum-tradeworks/actions/runs/1', ranAt: '2026-10-10T12:30:58Z', event: 'push', conclusion: 'success', entries, now: new Date('2026-10-10T13:00:00Z') });
  t(checksProblem(full) === null && full.suites.length === SUITES.length && full.suites.every(s => s.status === 'PASS'), 'the record: every suite, each as recorded');
  t(checksProblem(placeholder()) === null && checksProblem({ ...full, suites: [{ id: 'x', status: 'PASS', failed: 2 }] }) !== null && checksProblem({ ...full, suites: [{ id: 'x', status: 'OK' }] }) !== null,
    'the record: the placeholder is valid; a pass with failures, or a status outside PASS, FAIL and NOT RUN, is not');
  const missing = record({ commit: sha, run: full.run, ranAt: full.ranAt, entries: entries.filter(x => x.id !== 'model-test') });
  t(missing.suites.find(s => s.id === 'model-test').status === 'NOT RUN', 'the record: a suite the run did not record is NOT RUN');
  /* Served: a missing suite reads "Not run for <commit>", never PASS. */
  const jrec = { kind: 'quantum-tradeworks-journeys', schema: 2, ranAt: '2026-10-10T11:17:21.501Z', commit: sha, run: 'https://github.com/georgewong1014-pixel/quantum-tradeworks/actions/runs/2',
    journeys: [{ id: 'a', name: 'A', status: 'PASS' }, { id: 'b', name: 'B <x>', status: 'FAIL', failedStep: 'Save' }] };
  const ok = checksServed(full, jrec, SUITES);
  const words = (h) => h.replace(/<[^>]*>/g, '');
  t(ok.status.numbers === 'PASS' && ok.status.data === 'PASS' && ok.status.layout === 'PASS' && ok.status.journeys === 'FAIL', `served: the four kinds, each its own status (${JSON.stringify(ok.status)})`);
  const rowOf = (out, id) => new RegExp(`<li class="kind-row" id="kind-${id}"[\\s\\S]*?</div></li>`).exec(out.kinds)?.[0] || '';
  const nums = rowOf(ok, 'numbers');
  t(/data-status="PASS"/.test(nums) && words(nums).includes('5 of 5 suites pass · 50 of 50 checks · CI on abcdef1, 10 Oct 2026, 12:30 UTC · run log') && /href="https:\/\/github\.com\/georgewong1014-pixel\/quantum-tradeworks\/actions\/runs\/1"/.test(nums),
    `served: Numbers — its counts, generated from the record, the commit, the time and the run (${words(nums).slice(0, 110)}…)`);
  t(words(rowOf(ok, 'journeys')).includes('1 of 2 journeys pass, 1 failed (B &lt;x&gt;) · the live site, 10 Oct 2026, 11:17 UTC · abcdef1 · run log'), `served: Journeys — counted from the journeys' record, a failure named and escaped (${words(rowOf(ok, 'journeys')).slice(0, 110)})`);
  const gone = checksServed(missing, jrec, SUITES);
  const gnums = rowOf(gone, 'numbers');
  t(gone.status.numbers === 'NOT RUN' && /data-status="NOT-RUN"/.test(gnums) && /<span class="chip health-chip">Not run<\/span>/.test(gnums) && !/chip-ok/.test(gnums)
    && words(gnums).includes('Not run for abcdef1: 1 of its 5 suites has no result for this commit; 4 passed') && /<li data-mark="notrun"><span class="kind-mark">Not run<\/span> model-test<span class="kind-said"> — not run for abcdef1<\/span><\/li>/.test(gnums),
    `a missing suite reads "Not run for <commit>", never PASS: Numbers ${gone.status.numbers} — ${words(gnums).slice(0, 120)}`);
  t(!/Numbers PASS/.test(words(gone.ci)) && /Numbers not run for abcdef1/.test(words(gone.ci)), `the line beside the in-browser checks: "${words(gone.ci).slice(0, 120)}"`);
  const failing = checksServed(record({ commit: sha, entries: entries.map(x => (x.id === 'mobile' ? { ...x, status: 'FAIL', failed: 1 } : x.id === 'sweep' ? { id: 'sweep', status: 'NOT RUN' } : x)) }), jrec, SUITES);
  t(failing.status.layout === 'FAIL', 'a kind with a failed suite and one not run is FAIL');
  const other = checksServed({ ...full, commit: '1111111222222233333334444444555555566666' }, jrec, SUITES);
  t(['numbers', 'data', 'layout'].every(k => other.status[k] === 'NOT RUN') && /Not run for abcdef1/.test(words(rowOf(other, 'data'))) && !/chip-ok/.test(other.kinds.replace(rowOf(other, 'journeys'), '')),
    'a record for another commit than the site\'s is no result for it: every CI kind "Not run for <the site\'s commit>"');
  const none = checksServed(placeholder(), jrec, SUITES), nothing = checksServed(null, null, SUITES);
  t(['numbers', 'data', 'layout'].every(k => none.status[k] === 'NOT RUN' && nothing.status[k] === 'NOT RUN') && nothing.status.journeys === 'NOT RUN' && /Not run for abcdef1: none of its 5 suites has a result recorded for this commit/.test(words(rowOf(none, 'numbers'))),
    'the placeholder, and no record at all: every kind Not run, for the site\'s commit where one is named');
  const recPass = record({ commit: sha, entries: entries.map(x => ({ ...x, status: 'NOT RUN' })) });
  t(checksServed(recPass, jrec, SUITES).status.numbers === 'NOT RUN', 'suites recorded NOT RUN are not run, whatever else the record says');
  t(!/[\s\S]<\/script|<!--/i.test(String(checksServed)) && !/\b(document|window|location|el|fetch|HEALTH|BASE|SUITES|KINDS_)\b\s*[.(]/.test(String(checksServed)),
    'checksServed: self-contained (the build puts its source into the app) — no page globals, no </script or <!--');
  t(KINDS.map(k => k.id).join() === 'journeys,numbers,data,layout' && ['numbers', 'data', 'layout'].every(k => SUITES.some(s => s.kind === k)) && SUITES.every(s => ['numbers', 'data', 'layout'].includes(s.kind) && JOBS[s.job]),
    'the four kinds: Journeys, Numbers, Data, Layout & served pages — every CI suite in one of the last three and one of checks.yml\'s jobs');
  /* GitHub keeps 10 notices a step: a job's summarize step writes one a
     suite, and an eleventh would be dropped — read as NOT RUN. */
  t(Object.keys(JOBS).every(k => SUITES.filter(s => s.job === k).length <= 10), `each job records at most 10 suites, the notices GitHub keeps from one step (${Object.keys(JOBS).map(k => `${k} ${SUITES.filter(s => s.job === k).length}`).join(', ')})`);
  t(pickRun([{ status: 'completed', conclusion: 'cancelled', created_at: '2026-10-10T12:00:00Z' }, { status: 'completed', conclusion: 'failure', created_at: '2026-10-10T11:00:00Z', id: 7 }]).run?.id === 7
    && pickRun([{ status: 'in_progress', created_at: '2026-10-10T12:00:00Z' }]).going === true && pickRun([{ status: 'in_progress' }]).run === null,
    'the run read: the latest finished run on the commit, never a cancelled one; one still going is waited for');

  /* THE WORKFLOWS (read as text; no YAML parser here). */
  const cf = join(ROOT, '.github/workflows/checks.yml'), jf = join(ROOT, '.github/workflows/journeys.yml');
  if (existsSync(cf)) {
    const y = readFileSync(cf, 'utf8').replace(/\r\n/g, '\n');
    const cmds = y.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    const jobs = {};
    for (const mm of cmds.slice(cmds.indexOf('\njobs:\n')).matchAll(/^ {2}([a-z][a-z0-9-]*):\n((?: {4,}[^\n]*\n|\s*\n)*)/gm)) jobs[mm[1]] = mm[2];
    for (const [key, jobName] of Object.entries(JOBS)) {
      const body = jobs[key] || '';
      const runs = [...new Set(SUITES.filter(s => s.job === key).map(s => s.run))];
      const wrapped = runs.filter(r => new RegExp(`node checks-record\\.mjs run ${r} -- node `).test(body));
      t(new RegExp(`^ {4}name: ${jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(body) && wrapped.length === runs.length,
        `checks.yml "${jobName}": each of its recorded suites runs through checks-record.mjs run (${wrapped.length} of ${runs.length}${wrapped.length < runs.length ? `; not ${runs.filter(r => !wrapped.includes(r)).join(', ')}` : ''})`);
      const sum = /- name: record each suite's result\n {8}if: always\(\)\n {8}run: node checks-record\.mjs summarize --job (\w+)\n/.exec(body);
      t(!!sum && sum[1] === key && body.lastIndexOf('node checks-record.mjs summarize') > body.lastIndexOf('node checks-record.mjs run '),
        `checks.yml "${jobName}": its last step records each suite (if: always(), summarize --job ${key}), after every suite`);
    }
    const twice = RUNS.filter(r => (cmds.match(new RegExp(`node checks-record\\.mjs run ${r} -- `, 'g')) || []).length !== 1);
    t(!twice.length, `checks.yml: each recorded suite runs once${twice.length ? ` — not ${twice.join(', ')}` : ''}`);
  }
  if (existsSync(jf)) {
    const y = readFileSync(jf, 'utf8').replace(/\r\n/g, '\n');
    const cmds = y.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    const col = cmds.indexOf('collect the checks of the served commit'), rec = cmds.indexOf('record the result on main');
    t(col > -1 && rec > col && /if: always\(\) && steps\.decide\.outputs\.commit == 'true'/.test(cmds.slice(col, rec))
      && /node checks-record\.mjs collect --commit "\$SERVED" --repo "\$GITHUB_REPOSITORY" --out "\$RUNNER_TEMP\/checks\.json" --wait (\d+)/.test(cmds.slice(col, rec))
      && /SERVED: \$\{\{ steps\.decide\.outputs\.commit_served \}\}/.test(cmds.slice(col, rec)),
      'journeys.yml: when it records, it collects checks.yml\'s results for the commit the site serves (decide\'s commit_served), before the record step');
    const body = cmds.slice(rec);
    const at = (re) => { const mm = re.exec(body); return mm ? mm.index : -1; };
    const iCopy = at(/cp "\$RUNNER_TEMP\/checks\.json" health\/checks\.json/), iBuild = at(/node build\.mjs\b/), iGuard = at(/node journeys\.mjs --guard\b/), iCommit = at(/git commit\b/);
    t(iCopy > -1 && iCopy < iBuild && iBuild < iGuard && iGuard < iCommit, 'journeys.yml: the checks record is copied over health/checks.json with the journeys record, before the island pages are rebuilt, the guard run and the commit — one bot commit, no second loop');
    const wait = Number((/--commit "\$DEPLOY_SHA" --wait (\d+)/.exec(y) || [])[1]), cwait = Number((/--out "\$RUNNER_TEMP\/checks\.json" --wait (\d+)/.exec(y) || [])[1]);
    const limit = Number((/^ {4}timeout-minutes: (\d+)$/m.exec(y) || [])[1]);
    t(wait > 0 && cwait > 0 && limit * 60 >= wait + cwait + 600, `journeys.yml: the deployment's wait (${wait}s) and the wait for checks.yml (${cwait}s) fit the job (${limit} minutes) with ten to spare`);
  }
  console.log(bad ? `\n${bad} self-test check(s) failed` : '\nself-test: a missing suite reads "Not run for <commit>", never PASS; the counts are the suites\' own; the four kinds, the record, the served block and the workflows hold');
  process.exit(bad ? 1 : 0);
}

/* ─── COMMANDS ────────────────────────────────────────────────────────────── */
const dirOf = () => flag('dir') || process.env.QT_CHECKS_DIR || join(process.env.RUNNER_TEMP || tmpdir(), 'qt-checks');

async function cli() {
  if (argv.includes('--self-test')) return selfTest();
  const cmd = argv[0];
  if (cmd === 'run') {
    const id = argv[1], dd = argv.indexOf('--');
    if (!RUNS.includes(id) || dd < 0 || !argv[dd + 1]) { console.error(`usage: node checks-record.mjs run <${RUNS.join('|')}> -- <command…>`); process.exit(2); }
    const dir = dirOf();
    mkdirSync(dir, { recursive: true });
    const logF = join(dir, `${id}.log`);
    writeFileSync(logF, '');
    /* An exit code left by an earlier run is not this one's. */
    rmSync(join(dir, `${id}.exit`), { force: true });
    const [bin, ...args] = argv.slice(dd + 1);
    const child = spawn(bin === 'node' ? process.execPath : bin, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
    child.stdout.on('data', (d) => { process.stdout.write(d); appendFileSync(logF, d); });
    child.stderr.on('data', (d) => { process.stderr.write(d); appendFileSync(logF, d); });
    const code = await new Promise((res) => { child.on('error', (e) => { appendFileSync(logF, `could not start: ${e.message}\n`); res(127); }); child.on('close', (c, sig) => res(c ?? (sig ? 128 : 1))); });
    writeFileSync(join(dir, `${id}.exit`), `${code}\n`);
    process.exit(code);
  }
  if (cmd === 'summarize') {
    const job = flag('job');
    if (!JOBS[job]) { console.error(`--job is ${job}, not ${Object.keys(JOBS).join(' or ')}`); process.exit(2); }
    const entries = summarize(job, dirOf());
    const md = [`### Recorded for /status — ${JOBS[job]}`, '', '| Suite | Kind | Result | Counts | As it printed |', '| --- | --- | --- | --- | --- |',
      ...entries.map(e => `| ${e.name} | ${KINDS.find(k => k.id === e.kind).name} | ${e.status} | ${e.passed == null ? '—' : `${e.passed}/${e.passed + (e.failed || 0)}`} | ${String(e.said || '').replace(/\|/g, '\\|')} |`), ''].join('\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    for (const e of entries) console.log(`${e.status.padEnd(8)} ${e.name.padEnd(28)} ${e.passed == null ? '' : `${e.passed}/${e.passed + (e.failed || 0)}  `}${e.said || ''}`);
    /* One annotation a suite: what collect reads. Printed on CI, or here
       with --annotate. */
    if (process.env.GITHUB_ACTIONS === 'true' || argv.includes('--annotate')) entries.forEach(e => console.log(annotation(e)));
    const out = flag('json');
    if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(entries, null, 2) + '\n'); }
    process.exit(0);
  }
  if (cmd === 'collect') {
    const commit = flag('commit') || '';
    const out = flag('out');
    if (!out) { console.error('usage: node checks-record.mjs collect --commit <sha> --out <file>'); process.exit(2); }
    let doc;
    const files = flag('entries');
    if (files) {
      const entries = files.split(',').flatMap(f => JSON.parse(readFileSync(f, 'utf8')));
      doc = record({ commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : null, run: flag('run'), ranAt: flag('ran-at'), event: 'local', entries, note: 'built from summarize --json files, not from a run of checks.yml' });
    } else {
      /* Never fails the workflow: a record it cannot read says so, and every
         suite reads NOT RUN. */
      try { doc = await collect({ commit, repo: flag('repo') || REPO, wait: Number(flag('wait') || 0) }); }
      catch (e) { doc = record({ commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : null, note: `the results of checks.yml could not be read (${e.message})` }); }
    }
    const p = checksProblem(doc);
    if (p) { console.error(`the record is not valid: ${p}`); process.exit(1); }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
    const c = (s) => doc.suites.filter(x => x.status === s).length;
    console.log(`checks on ${doc.commit ? doc.commit.slice(0, 12) : 'no commit'}: ${c('PASS')} pass, ${c('FAIL')} fail, ${c('NOT RUN')} not run${doc.run ? ` — ${doc.run}` : ''}${doc.note ? ` (${doc.note})` : ''}; wrote ${out}`);
    process.exit(0);
  }
  console.error('usage: node checks-record.mjs run|summarize|collect|--self-test (see the head of the file)');
  process.exit(2);
}
if (MAIN) cli().catch(e => { console.error(`checks-record: ${e.stack || e.message}`); process.exit(2); });
