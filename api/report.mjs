/**
 * /api/report — the one address on this site that accepts something FROM a
 * visitor: a data-error report or feedback, submitted from the page.
 *
 *   GET  /api/report   → { ok, accepts: 'POST', configured, store }
 *   POST /api/report   → 200 { ok: true, receipt, acceptedAt }   only after the store accepted it
 *                        400 invalid · 413 too large · 415 not JSON · 503 not configured · 502 store failed
 *
 * WHY IT EXISTS (the owner's brief, 9 Nov 2026). "Report a data error"
 * recorded a case in the browser and handed it over as text to copy or to
 * open in the visitor's own email program. A visitor with no email program
 * set up — most phones, most office machines — had no way to get the report
 * to anyone. This function is that way: the report the visitor reviewed, and
 * the page and build it names, go to a store the owner reads. Nothing else.
 *
 * WHAT IT NEVER DOES
 *   - It does not read saved models, deals, watchlists or any other private
 *     input: the body is the report text the visitor saw in the textarea and
 *     pressed Submit on, plus the page path (the query string, where the
 *     property calculator keeps a deal's figures, is dropped here as well as
 *     on the client) and the build name.
 *   - It does not issue a receipt before the store has accepted the record.
 *     A receipt is the store's own number (a GitHub issue number, or the
 *     file's sequence number locally), so a receipt that exists names a
 *     record that exists.
 *   - It does not record the visitor's IP address, browser or any identifier.
 *     What the host logs about the request is the host's (see /privacy).
 *   - It sets no CORS header and refuses a body that is not application/json:
 *     a form on another site cannot post here, so the store is not a spam
 *     target by accident.
 *
 * THE STORE — configured by the deployment, never by code:
 *   QT_REPORTS_GITHUB_TOKEN + QT_REPORTS_REPO ("owner/name")
 *       each report becomes an issue in that (private) repository; the
 *       receipt is QTR-<issue number>. The token is a fine-grained personal
 *       access token with Issues: read and write on that one repository and
 *       nothing else. docs/report-submission.md has the owner's steps.
 *   QT_REPORTS_DIR
 *       a directory; each report is written as QTR-<n>.json. For local
 *       servers and CI (serve.mjs sets a temporary one when nothing is set).
 *   neither → 503 not-configured; the page then offers copy and email only.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KINDS = Object.freeze(['data-error', 'feedback']);
export const MAX_BODY = 16 * 1024;
export const MAX_REPORT = 8000;
export const ID_RE = /^QT-\d{8}-\d{3,}(?:-[a-z0-9]{4})?$/;
export const RECEIPT_RE = /^QTR-\d+$/;

/* Which store the environment names, or null. */
export function storeFromEnv(env = process.env) {
  const token = String(env.QT_REPORTS_GITHUB_TOKEN || '').trim();
  const repo = String(env.QT_REPORTS_REPO || '').trim();
  if (token && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { kind: 'github', repo, token };
  const dir = String(env.QT_REPORTS_DIR || '').trim();
  if (dir) return { kind: 'file', dir };
  return null;
}

/* The report as the store takes it, or why it is refused. Only these five
   fields are kept; anything else in the body is dropped, never stored. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'the body is not a JSON object' };
  const kind = String(body.kind || '');
  if (!KINDS.includes(kind)) return { ok: false, reason: `kind must be one of ${KINDS.join(', ')}` };
  const id = String(body.id || '');
  if (!ID_RE.test(id)) return { ok: false, reason: 'id is not a case identifier (QT-YYYYMMDD-NNN-xxxx)' };
  const report = typeof body.report === 'string' ? body.report.replace(/\r\n/g, '\n') : '';
  if (!report.trim()) return { ok: false, reason: 'report is empty' };
  if (report.length > MAX_REPORT) return { ok: false, reason: `report is longer than ${MAX_REPORT} characters` };
  /* The page's path only. A query string is dropped: the property calculator
     keeps the deal's figures in it, and a report carries no private figure
     unless the visitor typed one into the report. */
  const page = String(body.page || '/').split(/[?#]/)[0].slice(0, 300) || '/';
  if (!page.startsWith('/')) return { ok: false, reason: 'page is not a path on this site' };
  const build = typeof body.build === 'string' && /^app\.[0-9a-f]{12}\.js$/.test(body.build) ? body.build : null;
  /* A honeypot the form never fills: a bot that fills every field does. */
  if (body.website) return { ok: false, reason: 'refused' };
  return { ok: true, report: { kind, id, report, page, build } };
}

const TITLE = { 'data-error': 'Data error', feedback: 'Feedback' };

export function issueFor(r, acceptedAt) {
  return {
    title: `${TITLE[r.kind]} ${r.id} — ${r.page}`,
    body: [
      `| | |`, `|---|---|`,
      `| Kind | ${TITLE[r.kind]} |`, `| Case | ${r.id} |`, `| Page | ${r.page} |`,
      `| Build | ${r.build || 'not recorded'} |`, `| Accepted | ${acceptedAt} |`,
      ``, '```text', r.report.replace(/```/g, "'''"), '```', ``,
      `_Submitted from the site's report form. The visitor saw exactly the text above before pressing Submit; nothing else was attached._`,
    ].join('\n'),
    labels: [r.kind],
  };
}

/* Store the report; the receipt comes back only when the store has it.
   Throws when it does not. */
export async function accept(store, r, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const acceptedAt = now.toISOString();
  if (store.kind === 'github') {
    const res = await fetchImpl(`https://api.github.com/repos/${store.repo}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${store.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'quantum-tradeworks-report-form', 'x-github-api-version': '2022-11-28' },
      body: JSON.stringify(issueFor(r, acceptedAt)),
    });
    if (res.status !== 201) throw new Error(`GitHub answered ${res.status}`);
    const issue = await res.json();
    if (!Number.isInteger(issue?.number)) throw new Error('GitHub returned no issue number');
    return { receipt: `QTR-${issue.number}`, acceptedAt, ref: issue.html_url || null };
  }
  if (store.kind === 'file') {
    await mkdir(store.dir, { recursive: true });
    const have = (await readdir(store.dir)).map(f => /^QTR-(\d+)\.json$/.exec(f)).filter(Boolean).map(m => +m[1]);
    const n = (have.length ? Math.max(...have) : 0) + 1;
    const receipt = `QTR-${n}`;
    const file = join(store.dir, `${receipt}.json`);
    /* wx: the file must not exist — two requests in the same instant get
       different numbers or one of them fails, never one record over another. */
    await writeFile(file, JSON.stringify({ receipt, acceptedAt, ...r }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return { receipt, acceptedAt, ref: file };
  }
  throw new Error(`unknown store ${store.kind}`);
}

/* The body, as Vercel hands it (req.body, already parsed when the content
   type is JSON) or as a plain Node server streams it. */
async function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body.length > MAX_BODY ? { tooLarge: true } : { body: JSON.parse(req.body) };
    return { body: req.body };
  }
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return { tooLarge: true };
    chunks.push(c);
  }
  return { body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') };
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(status === 405 ? { allow: 'GET, POST' } : {}) });
  res.end(JSON.stringify(obj));
};

export default async function handler(req, res, { env = process.env, fetchImpl = globalThis.fetch, log = console.error } = {}) {
  const store = storeFromEnv(env);
  if (req.method === 'GET' || req.method === 'HEAD') {
    /* The directory is said only for the local file store — a local server
       on the same machine — so a local check can read the record back. */
    return send(res, 200, { ok: true, accepts: 'POST', configured: !!store, store: store?.kind || null, ...(store?.kind === 'file' ? { dir: store.dir } : {}) });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'method' });
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { ok: false, reason: 'the body must be application/json' });
  let parsed;
  try { parsed = await readJson(req); } catch { return send(res, 400, { ok: false, reason: 'the body is not valid JSON' }); }
  if (parsed.tooLarge) return send(res, 413, { ok: false, reason: `the body is larger than ${MAX_BODY} bytes` });
  const v = validate(parsed.body);
  if (!v.ok) return send(res, 400, { ok: false, reason: v.reason });
  if (!store) return send(res, 503, { ok: false, reason: 'not-configured' });
  try {
    const { receipt, acceptedAt } = await accept(store, v.report, { fetchImpl });
    return send(res, 200, { ok: true, receipt, acceptedAt });
  } catch (err) {
    log(`report store (${store.kind}) refused ${v.report.id}: ${err.message}`);
    return send(res, 502, { ok: false, reason: 'store-failed' });
  }
}
