/**
 * /api/enquiry — where a visitor's enquiry is received: stored first, then
 * the person who handles enquiries is told.
 *
 *   GET  /api/enquiry  → { ok, accepts: 'POST', configured, notifies }
 *   POST /api/enquiry  → 200 { ok: true, reference, saved: true, acceptedAt }  only after the store holds it
 *                        400 invalid (with `fields`) · 413 too large · 415 not JSON
 *                        429 rate-limited or capped · 503 not configured · 502 the store failed
 *                        — none of these carries a reference
 *
 * WHY IT EXISTS (the owner, 16 Nov 2026: "full version … an assistant will be
 * in charge to track enquiries, and we are building the funnel"). It follows
 * the contract of the ELS Source enquiry flow (a browser-made submission ID,
 * a reference made here, save first, notify second, the outcome of the
 * notification kept on the record), adapted to this site.
 *
 * THE RULE: SAVE FIRST, AND CONFIRM ONLY WHAT IS SAVED. Receipt is confirmed
 * to the visitor only after the store has the record. If the store is not
 * configured or does not answer, nothing is confirmed, no email is sent, and
 * the page keeps what was typed. Once the record is saved, a failed email is
 * a missed notification: the record says so (`notify_status`) and the daily
 * check of the store finds it.
 *
 * WHAT IT NEVER DOES
 *   - It does not read saved models, deals, watchlists or anything else in
 *     the browser: only the fields below, which the visitor typed and saw.
 *   - It does not accept a file. A document is sent by email, quoting the
 *     reference; the page says so.
 *   - It does not record the visitor's IP address or browser. The address is
 *     held in memory, with timestamps, only to limit a burst.
 *   - It sets no CORS header and refuses a body that is not application/json.
 *   - It logs status codes and error names, never a visitor's details or a key.
 *
 * THE STORE — configured by the deployment, never by code:
 *   QT_ENQUIRY_SUPABASE_URL + QT_ENQUIRY_SUPABASE_KEY
 *       a Supabase project; rows go to the table QT_ENQUIRY_TABLE
 *       (`qt_enquiries` unless set) over REST. The key is a server-only
 *       secret (service role); row-level security is on with no policies, so
 *       nothing else can read the table. docs/enquiry-store.sql creates it.
 *   QT_ENQUIRY_DIR
 *       a directory; each enquiry is written as a JSON file. For local
 *       servers and CI.
 *   neither → 503 not-configured; the page then shows no enquiry form.
 * THE NOTIFICATION — optional, and never the record:
 *   QT_ENQUIRY_RESEND_KEY + QT_ENQUIRY_TO (+ QT_ENQUIRY_FROM)
 *       one email to the enquiry inbox through Resend.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/* <enquiry-rules> — the same block stands in src/js/66-enquiry-rules.js, and
   enquiry-api-test.mjs fails if the two differ by a character: the form and
   this function apply one set of rules. */
const ENQ_TOPICS = ['property', 'equities', 'scanner', 'other'];
const ENQ_MAX = { name: 80, email: 120, phone: 30, need: 2000, timing: 120 };
const ENQ_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENQ_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/* Text as it is kept: control, bidirectional and zero-width characters
   removed; line breaks kept only where a field is prose. */
function enqClean(v, lines) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/\r\n?/g, '\n').replace(/[​-‏‪-‮⁠-⁩﻿]/g, '');
  s = lines ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.replace(/[ \t]+/g, ' ').trim();
}
/* Only these fields are read; anything else is dropped. */
function enqSanitize(body) {
  const b = body && typeof body === 'object' ? body : {};
  const topic = ENQ_TOPICS.includes(b.topic) ? b.topic : '';
  const email = enqClean(b.email), phone = enqClean(b.phone);
  const replyBy = b.replyBy === 'phone' || b.replyBy === 'email' ? b.replyBy : '';
  return { topic, name: enqClean(b.name), email, phone, replyBy, need: enqClean(b.need, true), timing: enqClean(b.timing) };
}
/* What is wrong, field by field: an empty object means it may be sent. An
   enquiry needs a name, one way to reply and what is wanted. Nothing else:
   no budget, no figures, no finished brief. */
function enqValidate(v) {
  const f = {};
  if (!v.name) f.name = 'Give a name to reply to.';
  else if (v.name.length > ENQ_MAX.name) f.name = `Keep the name to ${ENQ_MAX.name} characters.`;
  if (!v.email && !v.phone) f.email = 'Give an email address or a phone number, so there is a way to reply.';
  if (v.email && (v.email.length > ENQ_MAX.email || !ENQ_EMAIL.test(v.email))) f.email = 'That does not read as an email address.';
  if (v.phone && (v.phone.length > ENQ_MAX.phone || !/^[0-9+() .-]+$/.test(v.phone) || v.phone.replace(/\D/g, '').length < 7)) f.phone = 'A phone number needs at least seven digits, and only digits, spaces and + ( ) - .';
  if (v.replyBy === 'phone' && !v.phone) f.replyBy = 'A reply by phone needs a phone number.';
  if (v.replyBy === 'email' && !v.email) f.replyBy = 'A reply by email needs an email address.';
  if (!ENQ_TOPICS.includes(v.topic)) f.topic = 'Choose what the enquiry is about.';
  if (v.need.length < 10) f.need = 'Say what you need, in a sentence or more.';
  else if (v.need.length > ENQ_MAX.need) f.need = `Keep it to ${ENQ_MAX.need} characters.`;
  if (v.timing.length > ENQ_MAX.timing) f.timing = `Keep the timing to ${ENQ_MAX.timing} characters.`;
  return f;
}
/* How a reply should be made: the visitor's choice, or the one method given. */
function enqReplyBy(v) { return v.replyBy || (v.email ? 'email' : 'phone'); }
/* </enquiry-rules> */

export { ENQ_TOPICS, ENQ_MAX, ENQ_UUID, enqClean, enqSanitize, enqValidate, enqReplyBy };

export const MAX_BODY = 16 * 1024;
export const REFERENCE_RE = /^QTE-\d{6}-[2-9A-HJKMNP-Z]{4}$/;
export const NOTIFY = Object.freeze(['pending', 'sent', 'failed', 'not-configured']);
export const TOPIC_NAME = Object.freeze({ property: 'Property Intelligence', equities: 'Equities Research', scanner: 'Quantum Scanner', other: 'Something else' });

/* THE REFERENCE: QTE-YYMMDD-XXXX. The date is the day in Kuching; the four
   characters come from a hash of the submission ID, in an alphabet with no
   0, 1, I, L or O. The same submission on the same day gives the same
   reference. It is a label to quote, not a key: two submissions can share
   one. The submission ID is the key. */
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function kuchingDay(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuching', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => p.find(x => x.type === t).value;
  return `${get('year')}${get('month')}${get('day')}`;
}
export function referenceFor(submissionId, now = new Date()) {
  let h = 0x811c9dc5;
  for (const ch of String(submissionId).toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  let s = '';
  for (let i = 0; i < 4; i++) { s += REF_ALPHABET[h % REF_ALPHABET.length]; h = Math.floor(h / REF_ALPHABET.length); }
  return `QTE-${kuchingDay(now)}-${s}`;
}

/* ABUSE CONTROL, as /api/report has it: a burst from one address is turned
   away in memory, and the store itself is asked how many it took in the
   last 24 hours before anything is created. An answer that cannot be had is
   an error: the cap fails closed. */
export const PER_IP = 5;
export const PER_IP_WINDOW = 10 * 60 * 1000;
export const DEFAULT_DAILY_CAP = 50;
export const dailyCap = (env = process.env) => { const n = Number(env.QT_ENQUIRY_DAILY_CAP); return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP; };
const RECENT = new Map();
export function senderOf(req) { const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); return fwd || req.socket?.remoteAddress || 'unknown'; }
export function rateLimited(sender, now = Date.now(), buckets = RECENT) {
  const since = now - PER_IP_WINDOW, kept = (buckets.get(sender) || []).filter(t => t > since);
  if (kept.length >= PER_IP) { buckets.set(sender, kept); return true; }
  kept.push(now); buckets.set(sender, kept);
  if (buckets.size > 10000) for (const [k, v] of buckets) if (!v.some(t => t > since)) buckets.delete(k);
  return false;
}

/* Which store, and which notification, the environment names. */
export function storeFromEnv(env = process.env) {
  const url = String(env.QT_ENQUIRY_SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(env.QT_ENQUIRY_SUPABASE_KEY || '').trim();
  const table = /^[a-z_][a-z0-9_]{0,62}$/.test(String(env.QT_ENQUIRY_TABLE || '')) ? env.QT_ENQUIRY_TABLE : 'qt_enquiries';
  if (/^https:\/\/[a-z0-9.-]+$/i.test(url) && key) return { kind: 'supabase', url, key, table };
  const dir = String(env.QT_ENQUIRY_DIR || '').trim();
  if (dir) return { kind: 'file', dir };
  return null;
}
export function emailFromEnv(env = process.env) {
  const key = String(env.QT_ENQUIRY_RESEND_KEY || '').trim(), to = String(env.QT_ENQUIRY_TO || '').trim(), from = String(env.QT_ENQUIRY_FROM || '').trim();
  return key && ENQ_EMAIL.test(to) ? { key, to, from: from || 'Quantum Tradeworks enquiries <onboarding@resend.dev>' } : null;
}

/* Supabase over REST. A legacy key is a JWT and is also sent as a bearer
   token; a newer secret key goes in `apikey` alone. */
const sbHeaders = (store, extra = {}) => ({ apikey: store.key, ...(/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(store.key) ? { authorization: `Bearer ${store.key}` } : {}), 'content-type': 'application/json', ...extra });
const sbUrl = (store, query) => `${store.url}/rest/v1/${store.table}?${query}`;
const within = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
const fileOf = (store, submissionId) => join(store.dir, `enquiry-${submissionId.toLowerCase()}.json`);

/* The record the store already holds for this submission, or null. */
export async function existing(store, submissionId, { fetchImpl = globalThis.fetch } = {}) {
  if (store.kind === 'supabase') {
    const res = await fetchImpl(sbUrl(store, `submission_id=eq.${encodeURIComponent(submissionId)}&select=reference,created_at,notify_status&limit=1`), { headers: sbHeaders(store), ...within(10000) });
    if (res.status !== 200) throw Object.assign(new Error(`store lookup answered ${res.status}`), { status: res.status });
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] && REFERENCE_RE.test(rows[0].reference) ? { reference: rows[0].reference, acceptedAt: rows[0].created_at || null, notifyStatus: rows[0].notify_status || null } : null;
  }
  if (store.kind === 'file') {
    try { const rec = JSON.parse(await readFile(fileOf(store, submissionId), 'utf8')); return { reference: rec.reference, acceptedAt: rec.created_at, notifyStatus: rec.notify_status || null }; }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  }
  throw new Error(`unknown store ${store.kind}`);
}
/* How many enquiries the store took in the last 24 hours. */
export async function takenToday(store, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (store.kind === 'supabase') {
    const res = await fetchImpl(sbUrl(store, `select=submission_id&created_at=gte.${encodeURIComponent(since.toISOString())}`), { headers: sbHeaders(store, { prefer: 'count=exact', range: '0-0' }), ...within(10000) });
    if (res.status !== 200 && res.status !== 206) throw Object.assign(new Error(`store count answered ${res.status}`), { status: res.status });
    const m = /\/(\d+)$/.exec(String(res.headers.get('content-range') || ''));
    if (!m) throw new Error('the store returned no count');
    return Number(m[1]);
  }
  if (store.kind === 'file') {
    await mkdir(store.dir, { recursive: true });
    let n = 0;
    for (const f of (await readdir(store.dir)).filter(f => /^enquiry-[0-9a-f-]+\.json$/.test(f))) if ((await stat(join(store.dir, f))).mtimeMs > since.getTime()) n++;
    return n;
  }
  throw new Error(`unknown store ${store.kind}`);
}
/* The row as it is stored. The contact fields have their own columns so the
   person tracking enquiries can filter on them; everything the visitor sent
   is in `values`. The staff columns (owner, status, next action, due date,
   related record, logged_at, logged_by) are never written from here. */
export function rowFor(v, { submissionId, reference, page, build, acceptedAt }) {
  return { submission_id: submissionId.toLowerCase(), reference, kind: 'enquiry', created_at: acceptedAt, topic: v.topic, name: v.name, email: v.email || null, phone: v.phone || null, reply_by: enqReplyBy(v),
    main_need: v.need.split('\n')[0].slice(0, 160), values: { ...v, page, build }, notify_status: 'pending' };
}
/* Save it. One submission, one record: a record already held comes back as
   it is, with `duplicate: true`, and nothing is created or changed. */
export async function saveEnquiry(store, v, meta, { fetchImpl = globalThis.fetch, now = new Date(), cap = DEFAULT_DAILY_CAP } = {}) {
  const had = await existing(store, meta.submissionId, { fetchImpl });
  if (had) return { ...had, duplicate: true };
  if (await takenToday(store, { fetchImpl, now }) >= cap) throw Object.assign(new Error(`the store took ${cap} enquiries in the last 24 hours`), { code: 'capped' });
  const acceptedAt = now.toISOString(), reference = referenceFor(meta.submissionId, now), row = rowFor(v, { ...meta, reference, acceptedAt });
  if (store.kind === 'supabase') {
    const res = await fetchImpl(sbUrl(store, 'on_conflict=submission_id'), { method: 'POST', headers: sbHeaders(store, { prefer: 'resolution=ignore-duplicates,return=representation' }), body: JSON.stringify([row]), ...within(10000) });
    if (res.status !== 201 && res.status !== 200) throw Object.assign(new Error(`store insert answered ${res.status}`), { status: res.status });
    const rows = await res.json().catch(() => null);
    if (Array.isArray(rows) && rows[0] && rows[0].reference === reference) return { reference, acceptedAt, notifyStatus: 'pending' };
    /* Nothing came back: another request for the same submission got there
       first. Its record is the record. */
    const won = await existing(store, meta.submissionId, { fetchImpl });
    if (won) return { ...won, duplicate: true };
    throw new Error('the store returned no row and holds none');
  }
  if (store.kind === 'file') {
    await mkdir(store.dir, { recursive: true });
    try { await writeFile(fileOf(store, meta.submissionId), JSON.stringify(row, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); }
    catch (err) { if (err.code === 'EEXIST') { const won = await existing(store, meta.submissionId); if (won) return { ...won, duplicate: true }; } throw err; }
    return { reference, acceptedAt, notifyStatus: 'pending' };
  }
  throw new Error(`unknown store ${store.kind}`);
}
/* The outcome of the notification, written on the record. Best effort: the
   record is already safe, and a `pending` row is to be read as "possibly not
   emailed". */
export async function setNotifyStatus(store, submissionId, status, { fetchImpl = globalThis.fetch } = {}) {
  if (!NOTIFY.includes(status)) throw new Error(`unknown notify status ${status}`);
  if (store.kind === 'supabase') {
    const res = await fetchImpl(sbUrl(store, `submission_id=eq.${encodeURIComponent(submissionId.toLowerCase())}`), { method: 'PATCH', headers: sbHeaders(store, { prefer: 'return=minimal' }), body: JSON.stringify({ notify_status: status }), ...within(10000) });
    if (res.status !== 204 && res.status !== 200) throw Object.assign(new Error(`store update answered ${res.status}`), { status: res.status });
    return;
  }
  if (store.kind === 'file') { const f = fileOf(store, submissionId), rec = JSON.parse(await readFile(f, 'utf8')); rec.notify_status = status; await writeFile(f, JSON.stringify(rec, null, 2) + '\n', 'utf8'); return; }
  throw new Error(`unknown store ${store.kind}`);
}

/* THE EMAIL to the person who handles enquiries. A pure function. Every
   value the visitor typed is escaped in the HTML; in the text their message
   is quoted line by line, so it cannot pass for a line of the email's own. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function buildEmail(v, { reference, submissionId, acceptedAt, page }) {
  const by = enqReplyBy(v), lines = [
    ['Reference', reference], ['Received', acceptedAt], ['About', TOPIC_NAME[v.topic]], ['Name', v.name], ['Reply by', by === 'email' ? `email, to ${v.email}` : `phone, on ${v.phone}`],
    ['Email', v.email || 'not given'], ['Phone', v.phone || 'not given'], ['Timing', v.timing || 'not given'], ['Sent from', page],
  ];
  const note = `Saved in the enquiry store. Open it there, set its owner, status, next action and due date, and set logged_at and logged_by. Match by submission ID ${submissionId}, never by the reference alone. This is an enquiry, not an order.`;
  const subject = `${reference} enquiry — ${TOPIC_NAME[v.topic]} — ${v.name}`.replace(/\s+/g, ' ').slice(0, 120);
  const text = [note, '', ...lines.map(([k, x]) => `${k}: ${x}`), '', 'What they need (their words):', ...v.need.split('\n').map(l => `> ${l}`)].join('\n');
  const html = `<p>${esc(note)}</p><table>${lines.map(([k, x]) => `<tr><th align="left">${esc(k)}</th><td>${esc(x)}</td></tr>`).join('')}</table><p><b>What they need (their words):</b></p><blockquote>${esc(v.need).replace(/\n/g, '<br>')}</blockquote>`;
  return { subject, text, html };
}
/* Send it. 'sent' or 'failed'; a provider's answer that the same key was
   already used counts as sent, because the earlier send is the send. */
export async function notify(mail, v, meta, { fetchImpl = globalThis.fetch } = {}) {
  const e = buildEmail(v, meta);
  const res = await fetchImpl('https://api.resend.com/emails', { method: 'POST', ...within(15000),
    headers: { authorization: `Bearer ${mail.key}`, 'content-type': 'application/json', 'idempotency-key': `${meta.submissionId.toLowerCase()}:${meta.reference.slice(4, 10)}` },
    body: JSON.stringify({ from: mail.from, to: [mail.to], ...(v.email ? { reply_to: v.email } : {}), subject: e.subject, text: e.text, html: e.html }) });
  if (res.status === 200 || res.status === 201) return 'sent';
  throw Object.assign(new Error(`email provider answered ${res.status}`), { status: res.status });
}

async function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body.length > MAX_BODY ? { tooLarge: true } : { body: JSON.parse(req.body) };
    return JSON.stringify(req.body).length > MAX_BODY ? { tooLarge: true } : { body: req.body };
  }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return { tooLarge: true }; chunks.push(c); }
  return { body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') };
}
const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(status === 405 ? { allow: 'GET, POST' } : {}) });
  res.end(JSON.stringify(obj));
};
/* What a failure is called in the log: a status or an error's name. Never
   the message of an error that could quote a visitor's words. */
const named = (err) => (err && (err.status || err.code || err.name)) || 'error';

export default async function handler(req, res, { env = process.env, fetchImpl = globalThis.fetch, log = console.error, now = () => Date.now(), buckets = RECENT } = {}) {
  const store = storeFromEnv(env), mail = emailFromEnv(env);
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { ok: true, accepts: 'POST', configured: !!store, notifies: !!mail, limits: { perSender: PER_IP, windowMinutes: PER_IP_WINDOW / 60000, perDay: dailyCap(env) }, ...(store?.kind === 'file' ? { dir: store.dir } : {}) });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'This address takes an enquiry by POST only.' });
  if (rateLimited(senderOf(req), now(), buckets)) return send(res, 429, { ok: false, reason: 'rate-limited', error: 'Too many enquiries from here in a short time. Nothing was received.' });
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { ok: false, error: 'The body must be application/json.' });
  let parsed;
  try { parsed = await readJson(req); } catch { return send(res, 400, { ok: false, error: 'The enquiry could not be read.' }); }
  if (parsed.tooLarge) return send(res, 413, { ok: false, error: 'The enquiry is too long to send.' });
  const body = parsed.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { ok: false, error: 'The enquiry could not be read.' });
  const v = enqSanitize(body);
  /* A honeypot the form never fills: a bot that fills every field does. */
  if (body.website) return send(res, 400, { ok: false, error: 'The enquiry could not be read.' });
  const submissionId = String(body.submissionId || '');
  if (!ENQ_UUID.test(submissionId)) return send(res, 400, { ok: false, error: 'The enquiry could not be read. Reload the page and try again.' });
  const fields = enqValidate(v);
  if (Object.keys(fields).length) return send(res, 400, { ok: false, error: 'Some details need another look.', fields });
  if (!store) return send(res, 503, { ok: false, reason: 'not-configured', error: 'Enquiries from this page are not switched on. Nothing was received.' });
  const page = String(body.page || '/').split(/[?#]/)[0].slice(0, 300) || '/';
  const meta = { submissionId, page: page.startsWith('/') ? page : '/', build: typeof body.build === 'string' && /^app\.[0-9a-f]{12}\.js$/.test(body.build) ? body.build : null };
  let saved;
  try { saved = await saveEnquiry(store, v, meta, { fetchImpl, now: new Date(now()), cap: dailyCap(env) }); }
  catch (err) {
    if (err.code === 'capped') { log(`enquiry store (${store.kind}) at its daily cap`); return send(res, 429, { ok: false, reason: 'capped', error: 'The site is not taking more enquiries today. Nothing was received.' }); }
    log(`enquiry store (${store.kind}) did not save: ${named(err)}`);
    return send(res, 502, { ok: false, reason: 'store-failed', error: 'The enquiry was not received. Nothing was saved or sent.' });
  }
  /* Saved. From here the visitor is told it was received, whatever the email
     does. A record that was already held and already notified is left alone. */
  if (!(saved.duplicate && (saved.notifyStatus === 'sent' || saved.notifyStatus === 'not-configured'))) {
    let outcome = 'not-configured';
    if (mail) { try { outcome = await notify(mail, v, { ...meta, reference: saved.reference, acceptedAt: saved.acceptedAt }, { fetchImpl }); } catch (err) { outcome = err.status === 409 ? 'sent' : 'failed'; if (outcome === 'failed') log(`enquiry notification did not send: ${named(err)}`); } }
    try { await setNotifyStatus(store, submissionId, outcome, { fetchImpl }); } catch (err) { log(`enquiry notify status was not recorded: ${named(err)}`); }
  }
  return send(res, 200, { ok: true, reference: saved.reference, saved: true, acceptedAt: saved.acceptedAt, ...(saved.duplicate ? { duplicate: true } : {}) });
}
