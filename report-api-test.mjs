#!/usr/bin/env node
/**
 * api/report.mjs, offline: the one address that accepts something from a
 * visitor keeps every rule it states.
 *
 *   node report-api-test.mjs
 *
 * Checked, with no network and no GitHub: the validation (kinds, the case id,
 * the report's length, the page's query dropped, the honeypot); the file
 * store (sequence numbers, a record never written over another, the record's
 * fields); the GitHub store against a fake fetch (a receipt only on 201, an
 * error otherwise — never a receipt for a record that does not exist); and
 * the handler on a real local port (the probe, a good submission, the wrong
 * method, the wrong content type, a body too large, an invalid body, no
 * store configured, a store that fails). Exit 0 when every check holds.
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import handler, { validate, storeFromEnv, accept, issueFor, rateLimited, takenToday, MAX_BODY, MAX_REPORT, PER_IP, PER_IP_WINDOW, DEFAULT_DAILY_CAP } from './api/report.mjs';

/* A GitHub that answers the day's search with `taken` issues and issue
   creation with `create` — the two calls accept() makes, told apart by URL. */
const github = ({ taken = 0, create = { status: 201, number: 42 } } = {}, calls = []) => async (url, init = {}) => {
  calls.push({ url, init });
  if (url.includes('/search/issues')) return { status: 200, json: async () => ({ total_count: taken }) };
  return { status: create.status, json: async () => (create.number ? { number: create.number, html_url: `https://github.com/o/r/issues/${create.number}` } : {}) };
};

let passed = 0, failed = 0;
const ok = (what) => { passed++; console.log(`ok    ${what}`); };
const fail = (what, why) => { failed++; console.log(`FAIL  ${what}${why ? `\n      ${why}` : ''}`); };
const t = (cond, what, why) => (cond ? ok(what) : fail(what, why));

const good = { kind: 'data-error', id: 'QT-20261109-001-abcd', report: 'Correction case QT-20261109-001-abcd\nShown: 1', page: '/company/aapl-apple-inc', build: 'app.0123456789ab.js' };

/* validation */
{
  const v = validate(good);
  t(v.ok && v.report.page === '/company/aapl-apple-inc' && v.report.build === good.build, 'a good report validates with its five fields');
  t(validate({ ...good, kind: 'praise' }).ok === false, 'an unknown kind is refused');
  t(validate({ ...good, id: 'QT-2026-1' }).ok === false, 'an id that is not a case identifier is refused');
  t(validate({ ...good, id: 'QT-20261109-001' }).ok === true, 'a case id without the random suffix (recorded before the suffix) is accepted');
  t(validate({ ...good, report: '   ' }).ok === false, 'an empty report is refused');
  t(validate({ ...good, report: 'x'.repeat(MAX_REPORT + 1) }).ok === false && validate({ ...good, report: 'x'.repeat(MAX_REPORT) }).ok === true, `a report over ${MAX_REPORT} characters is refused, one at the limit accepted`);
  t(validate({ ...good, page: '/property/calculator?d=eyJwcmljZSI6NTcyMDAwfQ#x' }).report.page === '/property/calculator', 'the page keeps its path only: the query (where the calculator keeps a deal) and the fragment are dropped');
  t(validate({ ...good, page: 'https://evil.example/x' }).ok === false, 'a page that is not a path on this site is refused');
  t(validate({ ...good, build: 'app.js' }).report.build === null, 'a build name that is not the hashed file is recorded as none');
  t(validate({ ...good, website: 'http://spam' }).ok === false, 'the honeypot field, when filled, refuses the submission');
  const v2 = validate({ ...good, deal: { price: 572000 }, watchlists: [1] });
  t(v2.ok && !('deal' in v2.report) && !('watchlists' in v2.report) && Object.keys(v2.report).sort().join() === 'build,id,kind,page,report', 'any field beyond the five is dropped, never stored');
  t(validate(null).ok === false && validate([1]).ok === false && validate('x').ok === false, 'a body that is not an object is refused');
}

/* the store named by the environment */
{
  t(storeFromEnv({}) === null, 'no environment names no store');
  t(storeFromEnv({ QT_REPORTS_DIR: '/tmp/x' })?.kind === 'file', 'QT_REPORTS_DIR names the file store');
  const gh = storeFromEnv({ QT_REPORTS_GITHUB_TOKEN: 'tok', QT_REPORTS_REPO: 'owner/reports' });
  t(gh?.kind === 'github' && gh.repo === 'owner/reports', 'a token and an owner/name repository name the GitHub store');
  t(storeFromEnv({ QT_REPORTS_GITHUB_TOKEN: 'tok', QT_REPORTS_REPO: 'not a repo' }) === null, 'a token with a malformed repository name names no store (never a guess)');
  t(storeFromEnv({ QT_REPORTS_GITHUB_TOKEN: 'tok', QT_REPORTS_REPO: 'owner/reports', QT_REPORTS_DIR: '/tmp/x' })?.kind === 'github', 'with both set, GitHub wins: the file store is for local servers');
}

/* the file store */
const dir = await mkdtemp(join(tmpdir(), 'qt-report-test-'));
try {
  const r = validate(good).report;
  const a = await accept({ kind: 'file', dir }, r, { now: new Date('2026-11-09T10:00:00Z') });
  const b = await accept({ kind: 'file', dir }, { ...r, id: 'QT-20261109-002-efgh' });
  t(a.receipt === 'QTR-1' && b.receipt === 'QTR-2', 'the file store numbers receipts in sequence', `${a.receipt}, ${b.receipt}`);
  const rec = JSON.parse(await readFile(join(dir, 'QTR-1.json'), 'utf8'));
  t(rec.receipt === 'QTR-1' && rec.acceptedAt === '2026-11-09T10:00:00.000Z' && rec.id === r.id && rec.report === r.report && rec.page === r.page && rec.kind === 'data-error' && Object.keys(rec).sort().join() === 'acceptedAt,build,id,kind,page,receipt,report',
    'the record holds the receipt, the acceptance time and the five fields — no address, no agent, nothing else', JSON.stringify(rec).slice(0, 200));
  t((await readdir(dir)).sort().join() === 'QTR-1.json,QTR-2.json', 'one file per record');
} finally { await rm(dir, { recursive: true, force: true }); }

/* the GitHub store, against a fake fetch */
{
  const r = validate(good).report;
  const calls = [];
  const a = await accept({ kind: 'github', repo: 'o/r', token: 'tok' }, r, { fetchImpl: github({ taken: 3 }, calls), now: new Date('2026-11-09T10:00:00Z') });
  const create = calls.find(c => !c.url.includes('/search/'));
  const search = calls.find(c => c.url.includes('/search/'));
  const sent = JSON.parse(create.init.body);
  t(a.receipt === 'QTR-42' && create.url === 'https://api.github.com/repos/o/r/issues' && create.init.headers.authorization === 'Bearer tok', 'a 201 from GitHub gives the issue number as the receipt');
  t(calls.indexOf(search) < calls.indexOf(create) && decodeURIComponent(search.url).includes('repo:o/r is:issue created:>=2026-11-08T10:00:00Z'), 'the day\'s count is asked of the repository (issues created in the last 24 hours) before anything is created');
  const capped = [];
  let cap = null;
  try { await accept({ kind: 'github', repo: 'o/r', token: 'tok' }, r, { fetchImpl: github({ taken: DEFAULT_DAILY_CAP }, capped), cap: DEFAULT_DAILY_CAP }); } catch (e) { cap = e; }
  t(cap?.code === 'capped' && capped.every(c => c.url.includes('/search/')), `at ${DEFAULT_DAILY_CAP} issues in a day the submission is refused as capped and no issue is created`);
  let searchDown = null;
  try { await accept({ kind: 'github', repo: 'o/r', token: 'tok' }, r, { fetchImpl: async (url) => (url.includes('/search/') ? { status: 403, json: async () => ({}) } : { status: 201, json: async () => ({ number: 1 }) }) }); } catch (e) { searchDown = e; }
  t(searchDown && !searchDown.code && /search answered 403/.test(searchDown.message), 'when the day\'s count cannot be had the cap fails closed: an error, no issue, no receipt');
  t(sent.title === 'Data error QT-20261109-001-abcd — /company/aapl-apple-inc' && sent.body.includes('Shown: 1') && sent.labels.join() === 'data-error' && sent.body.includes('| Build | app.0123456789ab.js |'), 'the issue carries the kind, the case, the page, the build and the text, labelled by kind');
  t(issueFor({ ...r, kind: 'feedback', report: 'a ``` fence' }, 'x').body.includes("a ''' fence") && issueFor({ ...r, kind: 'feedback' }, 'x').title.startsWith('Feedback '), 'feedback is titled Feedback and a fence in the text cannot break out of the block');
  let threw = null;
  try { await accept({ kind: 'github', repo: 'o/r', token: 'tok' }, r, { fetchImpl: github({ create: { status: 500 } }) }); } catch (e) { threw = e; }
  t(threw && /500/.test(threw.message), 'a GitHub answer other than 201 is an error — no receipt');
  threw = null;
  try { await accept({ kind: 'github', repo: 'o/r', token: 'tok' }, r, { fetchImpl: github({ create: { status: 201, number: null } }) }); } catch (e) { threw = e; }
  t(!!threw, 'a 201 without an issue number is an error — a receipt names a record that exists');
}

/* the per-sender limit, in memory */
{
  const buckets = new Map();
  const t0 = 1_000_000;
  const hits = Array.from({ length: PER_IP }, (_, i) => rateLimited('1.2.3.4', t0 + i, buckets));
  t(hits.every(h => h === false) && rateLimited('1.2.3.4', t0 + PER_IP, buckets) === true, `a sender's first ${PER_IP} attempts pass and the next is refused`);
  t(rateLimited('5.6.7.8', t0 + PER_IP, buckets) === false, 'another sender is not affected');
  t(rateLimited('1.2.3.4', t0 + PER_IP_WINDOW + 1, buckets) === false, `after ${PER_IP_WINDOW / 60000} minutes the sender may submit again`);
  t(![...buckets.keys()].some(k => /\d/.test(k) === false) && JSON.stringify([...buckets.values()]).indexOf('report') < 0, 'the buckets hold addresses and times only');
}

/* the file store's day count */
{
  const d = await mkdtemp(join(tmpdir(), 'qt-report-test-'));
  try {
    const r = validate(good).report;
    await accept({ kind: 'file', dir: d }, r, { cap: 2 });
    await accept({ kind: 'file', dir: d }, r, { cap: 2 });
    t(await takenToday({ kind: 'file', dir: d }) === 2, 'the file store counts the records written in the last 24 hours');
    let c = null;
    try { await accept({ kind: 'file', dir: d }, r, { cap: 2 }); } catch (e) { c = e; }
    t(c?.code === 'capped' && (await readdir(d)).length === 2, 'the file store refuses the record over the cap and writes nothing');
  } finally { await rm(d, { recursive: true, force: true }); }
}

/* the handler on a port */
const dir2 = await mkdtemp(join(tmpdir(), 'qt-report-test-'));
let env = { QT_REPORTS_DIR: dir2 };
let fetchImpl = globalThis.fetch;
let clock = Date.now();
const buckets = new Map();
const logged = [];
const server = createServer((req, res) => handler(req, res, { env, fetchImpl, log: (m) => logged.push(m), now: () => clock, buckets }).catch(e => { res.writeHead(500); res.end(e.message); }));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
/* Each request names its sender, as Vercel does with x-forwarded-for, so the
   tests below are not limited by one another; the limit's own test sets one. */
let sender = 0;
const call = (init = {}, path = '/api/report') => fetch(base + path, { ...init, headers: { 'x-forwarded-for': `10.0.0.${++sender}`, ...(init.headers || {}) } }).then(async r => ({ status: r.status, headers: r.headers, json: await r.json().catch(() => null) }));
const post = (body, headers = { 'content-type': 'application/json' }) => call({ method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
try {
  const probe = await call();
  t(probe.status === 200 && probe.json.configured === true && probe.json.store === 'file' && probe.json.dir === dir2 && probe.headers.get('cache-control') === 'no-store', 'GET says a store is configured, which kind, and (file store) where; never cached');
  t(probe.json.limits?.perSender === PER_IP && probe.json.limits?.perDay === DEFAULT_DAILY_CAP, 'GET states the limits');
  /* The sender limit, with invalid bodies: nothing is created by the test. */
  const same = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
  const burst = [];
  for (let i = 0; i < PER_IP + 1; i++) burst.push((await post('{not json', same)).status);
  t(burst.slice(0, PER_IP).every(s => s === 400) && burst[PER_IP] === 429 && (await post('{not json', same)).json?.reason === 'rate-limited', `${PER_IP} attempts from one sender are answered on their merits, the next is 429 rate-limited — before the body is read`, burst.join());
  clock += PER_IP_WINDOW + 1;
  t((await post('{not json', same)).status === 400, 'after the window the sender is answered again');
  t((await readdir(dir2)).length === 0, 'the burst created no record');
  const a = await post(good);
  t(a.status === 200 && a.json.ok === true && a.json.receipt === 'QTR-1' && /^\d{4}-/.test(a.json.acceptedAt), 'a good POST is accepted with a receipt and the acceptance time', JSON.stringify(a.json));
  t(!JSON.stringify(a.json).includes('Shown: 1'), 'the answer does not echo the report');
  t((await call({ method: 'PUT' })).status === 405, 'PUT is 405');
  t((await post('a=b', { 'content-type': 'application/x-www-form-urlencoded' })).status === 415, 'a form-encoded body (what a form on another site could post) is 415');
  t((await post('{not json')).status === 400, 'a body that is not JSON is 400');
  const big = await post({ ...good, report: 'x'.repeat(MAX_BODY) });
  t(big.status === 413, `a body over ${MAX_BODY} bytes is 413`, String(big.status));
  t((await post({ ...good, kind: 'x' })).status === 400, 'an invalid report is 400');
  env = {};
  const none = await post(good);
  t(none.status === 503 && none.json.reason === 'not-configured' && (await call()).json.configured === false, 'with no store configured, POST is 503 not-configured and GET says configured: false');
  env = { QT_REPORTS_DIR: dir2, QT_REPORTS_DAILY_CAP: '1' };
  const over = await post(good);
  t(over.status === 429 && over.json.reason === 'capped' && (await readdir(dir2)).join() === 'QTR-1.json', 'at the day\'s cap (QT_REPORTS_DAILY_CAP) POST is 429 capped and nothing is written');
  env = { QT_REPORTS_GITHUB_TOKEN: 'tok', QT_REPORTS_REPO: 'o/r' };
  fetchImpl = github({ create: { status: 502 } });
  const bad = await post(good);
  t(bad.status === 502 && bad.json.reason === 'store-failed' && logged.some(m => /GitHub answered 502/.test(m)), 'a store that fails is 502 store-failed, logged server-side with the cause, with no receipt');
  fetchImpl = github({ taken: DEFAULT_DAILY_CAP });
  const ghCap = await post(good);
  t(ghCap.status === 429 && ghCap.json.reason === 'capped', 'the GitHub store at its daily cap answers 429 capped');
  t(!JSON.stringify(logged).includes('tok') && !JSON.stringify([bad.json, ghCap.json, over.json]).includes('tok'), 'the token appears in no log line and no answer');
  t((await readdir(dir2)).join() === 'QTR-1.json', 'only the accepted submission left a record');
} finally {
  server.close();
  await rm(dir2, { recursive: true, force: true });
}

console.log(failed ? `${failed} report-api check(s) broken.` : `all ${passed} report-api checks hold`);
process.exit(failed ? 1 : 0);
