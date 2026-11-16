#!/usr/bin/env node
/**
 * api/enquiry.mjs, offline: an enquiry is confirmed only once it is stored,
 * is stored once, and its notification is a separate matter.
 *
 *   node enquiry-api-test.mjs
 *
 * Checked, with no network, no Supabase and no email provider: the rules
 * the form and the function share (and that the two copies are the same
 * text); the reference; the file store; the Supabase store against a fake
 * (lookup, cap, insert, a lost race, a failure at each call); the email
 * (content, escaping, idempotency key) and its outcome on the record; and
 * the handler on a real local port for each case in the owner's list:
 * email only, phone only, optional details left out, a duplicate retry, the
 * store failing, the email failing after the store saved, and that nothing
 * but a reference ever comes back. Exit 0 when every check holds.
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler, { enqSanitize, enqValidate, enqReplyBy, enqClean, ENQ_MAX, ENQ_UUID, referenceFor, kuchingDay, REFERENCE_RE, storeFromEnv, emailFromEnv, saveEnquiry, existing, takenToday, setNotifyStatus, buildEmail, notify, rowFor, rateLimited, MAX_BODY, PER_IP, PER_IP_WINDOW, DEFAULT_DAILY_CAP, NOTIFY } from './api/enquiry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (what) => { passed++; console.log(`ok    ${what}`); };
const fail = (what, why) => { failed++; console.log(`FAIL  ${what}${why ? `\n      ${why}` : ''}`); };
const t = (cond, what, why) => (cond ? ok(what) : fail(what, why));

const ID = '3f2b8c1e-6d4a-4b7e-9a10-5c2d7e8f9a01', ID2 = '9a1c2e3f-4b5d-4e6f-8a7b-0c1d2e3f4a5b';
const NOW = new Date('2026-11-16T04:00:00Z');   /* noon in Kuching */
const good = { submissionId: ID, topic: 'property', name: 'Test Enquirer', email: 'someone@example.test', phone: '', need: 'TEST enquiry: I would like help comparing two property scenarios.', timing: '', page: '/contact', build: 'app.0123456789ab.js' };

/* A Supabase that keeps rows in memory and can be told to fail one call. */
const supabase = ({ rows = [], failOn = null, lostRace = false } = {}, calls = []) => {
  const api = async (url, init = {}) => {
    const method = init.method || 'GET'; calls.push({ url, method, headers: init.headers || {}, body: init.body || null });
    if (url.startsWith('https://api.resend.com/')) throw new Error('the store fake was asked to send email');
    const q = new URL(url).searchParams, bySub = (q.get('submission_id') || '').replace(/^eq\./, '');
    if (method === 'GET' && q.get('created_at')) { if (failOn === 'count') return { status: 500, headers: new Map(), json: async () => ({}) }; return { status: 206, headers: new Map([['content-range', `0-0/${rows.length}`]]), json: async () => rows.slice(0, 1) }; }
    if (method === 'GET') { if (failOn === 'lookup') return { status: 503, headers: new Map(), json: async () => ({}) }; return { status: 200, headers: new Map(), json: async () => rows.filter(r => r.submission_id === bySub) }; }
    if (method === 'POST') { if (failOn === 'insert') return { status: 500, headers: new Map(), json: async () => ({ message: 'boom' }) };
      const row = JSON.parse(init.body)[0];
      if (lostRace || rows.some(r => r.submission_id === row.submission_id)) { if (lostRace && !rows.length) rows.push({ ...row, reference: row.reference }); return { status: 201, headers: new Map(), json: async () => [] }; }
      rows.push(row); return { status: 201, headers: new Map(), json: async () => [row] }; }
    if (method === 'PATCH') { if (failOn === 'update') return { status: 500, headers: new Map(), json: async () => ({}) }; const r = rows.find(x => x.submission_id === bySub); if (r) Object.assign(r, JSON.parse(init.body)); return { status: 204, headers: new Map(), json: async () => null }; }
    return { status: 400, headers: new Map(), json: async () => ({}) };
  };
  api.rows = rows; api.calls = calls; return api;
};
const SB = { kind: 'supabase', url: 'https://example-project.supabase.co', key: 'sb_secret_TESTKEY', table: 'qt_enquiries' };

/* the rules: one text, in the function and in the form */
{
  const block = (s) => (/\/\* <enquiry-rules>[\s\S]*?\*\/\n([\s\S]*?)\/\* <\/enquiry-rules> \*\//.exec(s) || [])[1];
  const server = block(readFileSync(join(HERE, 'api/enquiry.mjs'), 'utf8')), clientFile = join(HERE, 'src/js/66-enquiry-rules.js');
  t(typeof server === 'string' && server.includes('function enqValidate'), 'the function holds the rules between its markers');
  t(existsSync(clientFile) && block(readFileSync(clientFile, 'utf8')) === server, 'the form’s copy of the rules is the same text, character for character', 'src/js/66-enquiry-rules.js differs from api/enquiry.mjs between the <enquiry-rules> markers');
}

/* what an enquiry needs: a name, one way to reply, what is wanted — nothing more */
{
  const v = (over) => enqValidate(enqSanitize({ ...good, ...over }));
  t(Object.keys(v({})).length === 0, 'email only: accepted');
  t(Object.keys(v({ email: '', phone: '+60 82-123 456' })).length === 0, 'phone only: accepted');
  t(enqReplyBy(enqSanitize({ ...good, email: '', phone: '082 123456' })) === 'phone' && enqReplyBy(enqSanitize(good)) === 'email', 'the reply is by the one method given');
  t(enqReplyBy(enqSanitize({ ...good, phone: '082 123456', replyBy: 'phone' })) === 'phone', 'with both given, the visitor’s choice is kept');
  t(Object.keys(v({ timing: '', phone: '' })).length === 0, 'timing and the second contact method are optional');
  t(v({ email: '', phone: '' }).email === 'Give an email address or a phone number, so there is a way to reply.', 'neither email nor phone: refused, and told why');
  t(!JSON.stringify(v({ email: '', phone: '' })).toLowerCase().includes('whatsapp'), 'no message asks for WhatsApp');
  t('email' in v({ email: 'not-an-address' }) && 'phone' in v({ phone: '12345' }) && 'phone' in v({ phone: 'call me maybe 1234567' }), 'an email that is not one, and a phone with too few digits or with words, are refused');
  t('replyBy' in v({ replyBy: 'phone' }), 'a reply by phone with no phone number is refused');
  t('name' in v({ name: ' ' }) && 'need' in v({ need: 'help' }) && 'topic' in v({ topic: 'crypto' }), 'no name, a need of one word, and a topic not on the list are refused');
  t('need' in v({ need: 'x'.repeat(ENQ_MAX.need + 1) }) && !('need' in v({ need: 'x'.repeat(ENQ_MAX.need) })), `a need over ${ENQ_MAX.need} characters is refused, one at the limit accepted`);
  const s = enqSanitize({ ...good, deal: { price: 572000 }, budget: 1, name: 'A‮b\u0007c', need: 'line one\nline two​' });
  t(Object.keys(s).sort().join() === 'email,name,need,phone,replyBy,timing,topic', 'only the seven known fields are read; a deal, a budget or anything else is dropped');
  t(s.name === 'Ab c' && s.need === 'line one\nline two', 'control, direction and zero-width characters are removed; line breaks are kept only in the need');
  t(enqClean(42) === '' && enqClean(null) === '', 'a value that is not text is read as empty');
  t(ENQ_UUID.test(ID) && !ENQ_UUID.test('QT-20261116-001-abcd') && !ENQ_UUID.test(''), 'a submission ID is a UUID');
}

/* the reference */
{
  const r = referenceFor(ID, NOW);
  t(REFERENCE_RE.test(r) && r.startsWith('QTE-261116-'), `the reference is QTE-, the day in Kuching and four characters: ${r}`);
  t(referenceFor(ID, NOW) === r && referenceFor(ID.toUpperCase(), NOW) === r, 'the same submission on the same day gives the same reference, whatever its letter case');
  t(referenceFor(ID2, NOW) !== r, 'another submission gives another reference');
  t(kuchingDay(new Date('2026-11-16T15:59:00Z')) === '261116' && kuchingDay(new Date('2026-11-16T16:00:00Z')) === '261117', 'the day turns at midnight in Kuching, not in London');
  t(!/[01ILO]/.test(r.slice(11)), 'the four characters use no 0, 1, I, L or O');
}

/* the store and the notification the environment names */
{
  t(storeFromEnv({}) === null && emailFromEnv({}) === null, 'no environment names no store and no notification');
  const s = storeFromEnv({ QT_ENQUIRY_SUPABASE_URL: 'https://abc.supabase.co/', QT_ENQUIRY_SUPABASE_KEY: 'k' });
  t(s.kind === 'supabase' && s.url === 'https://abc.supabase.co' && s.table === 'qt_enquiries', 'a project address and a key name the Supabase store, in the table qt_enquiries');
  t(storeFromEnv({ QT_ENQUIRY_SUPABASE_URL: 'http://abc.supabase.co', QT_ENQUIRY_SUPABASE_KEY: 'k' }) === null && storeFromEnv({ QT_ENQUIRY_SUPABASE_URL: 'https://abc.supabase.co' }) === null, 'an address that is not https, or an address with no key, names none');
  t(storeFromEnv({ QT_ENQUIRY_SUPABASE_URL: 'https://abc.supabase.co', QT_ENQUIRY_SUPABASE_KEY: 'k', QT_ENQUIRY_TABLE: 'x; drop table' }).table === 'qt_enquiries', 'a table name that is not a plain identifier is ignored');
  t(storeFromEnv({ QT_ENQUIRY_DIR: '/tmp/x' }).kind === 'file', 'a directory names the file store');
  t(emailFromEnv({ QT_ENQUIRY_RESEND_KEY: 'k', QT_ENQUIRY_TO: 'inbox@example.test' }).to === 'inbox@example.test' && emailFromEnv({ QT_ENQUIRY_RESEND_KEY: 'k', QT_ENQUIRY_TO: 'not an address' }) === null, 'the notification needs a key and one address to send to');
}

/* the Supabase store, against a fake */
{
  const v = enqSanitize(good), meta = { submissionId: ID, page: '/contact', build: null };
  const sb = supabase();
  const a = await saveEnquiry(SB, v, meta, { fetchImpl: sb, now: NOW });
  t(REFERENCE_RE.test(a.reference) && !a.duplicate && sb.rows.length === 1, 'a new enquiry is looked up, counted, inserted, and comes back with its reference');
  const row = sb.rows[0];
  t(row.submission_id === ID && row.name === 'Test Enquirer' && row.email === 'someone@example.test' && row.phone === null && row.reply_by === 'email' && row.notify_status === 'pending' && row.values.need === v.need && row.values.page === '/contact', 'the row holds the submission ID, the contact fields, how to reply, and everything sent');
  t(!('owner' in row) && !('status' in row) && !('logged_at' in row) && !('logged_by' in row) && !('next_action' in row) && !('due_date' in row) && !('related_ref' in row), 'the site writes none of the staff columns');
  const ins = sb.calls.find(c => c.method === 'POST');
  t(ins.url.includes('on_conflict=submission_id') && /ignore-duplicates/.test(ins.headers.prefer), 'the insert ignores a duplicate submission ID');
  t(sb.calls.every(c => c.headers.apikey === SB.key && !('authorization' in c.headers)), 'a new-style secret key is sent as apikey alone');
  const jwtCalls = []; await existing({ ...SB, key: 'eyJhbGciOi.eyJyb2xlIjoi.c2lnbmF0dXJl' }, ID, { fetchImpl: supabase({}, jwtCalls) });
  t(/^Bearer eyJ/.test(jwtCalls[0].headers.authorization), 'a legacy JWT key is also sent as a bearer token');
  const b = await saveEnquiry(SB, v, meta, { fetchImpl: sb, now: new Date('2026-11-17T17:00:00Z') });
  t(b.duplicate === true && b.reference === a.reference && sb.rows.length === 1 && sb.calls.filter(c => c.method === 'POST').length === 1, 'the same submission again, even a day later: the stored reference comes back, and nothing is inserted');
  const race = supabase({ lostRace: true });
  const c = await saveEnquiry(SB, v, meta, { fetchImpl: race, now: NOW });
  t(c.duplicate === true && REFERENCE_RE.test(c.reference) && race.rows.length === 1, 'an insert that loses a race to the same submission uses the row that won');
  for (const where of ['lookup', 'count', 'insert']) {
    let threw = false; try { await saveEnquiry(SB, v, { ...meta, submissionId: ID2 }, { fetchImpl: supabase({ failOn: where }), now: NOW }); } catch { threw = true; }
    t(threw, `a store that fails at the ${where} is an error, never a reference`);
  }
  let capped = null; try { await saveEnquiry(SB, v, { ...meta, submissionId: ID2 }, { fetchImpl: supabase({ rows: Array.from({ length: DEFAULT_DAILY_CAP }, (_, i) => ({ submission_id: `x${i}` })) }), now: NOW }); } catch (e) { capped = e.code; }
  t(capped === 'capped', `the store at ${DEFAULT_DAILY_CAP} enquiries in a day refuses the next`);
  await setNotifyStatus(SB, ID, 'failed', { fetchImpl: sb });
  t(sb.rows[0].notify_status === 'failed', 'the notification outcome is written on the row');
  let badStatus = false; try { await setNotifyStatus(SB, ID, 'delivered', { fetchImpl: sb }); } catch { badStatus = true; }
  t(badStatus && NOTIFY.join() === 'pending,sent,failed,not-configured', 'the outcome is one of pending, sent, failed, not-configured');
}

/* the email */
{
  const v = enqSanitize({ ...good, phone: '082 123456', name: '<b>Eve</b>', need: 'First line\nReference: QTE-000000-AAAA\n<script>alert(1)</script>' });
  const meta = { reference: 'QTE-261116-ABCD', submissionId: ID, acceptedAt: NOW.toISOString(), page: '/contact' };
  const e = buildEmail(v, meta);
  t(e.subject.startsWith('QTE-261116-ABCD enquiry') && e.subject.length <= 120 && !/\n/.test(e.subject), 'the subject starts with the reference and is one short line');
  t(e.text.includes(`submission ID ${ID}`) && e.text.includes('Saved in the enquiry store') && e.text.includes('This is an enquiry, not an order.'), 'it says the record is saved, gives the submission ID, and says it is not an order');
  t(e.text.includes('> Reference: QTE-000000-AAAA') && !/^Reference: QTE-000000-AAAA$/m.test(e.text), 'the visitor’s words are quoted line by line, so none can pass for a line of the email');
  t(!e.html.includes('<script>') && e.html.includes('&lt;script&gt;') && e.html.includes('&lt;b&gt;Eve&lt;/b&gt;'), 'every value the visitor typed is escaped in the HTML');
  const sent = []; const mail = { key: 'RESEND_TEST_KEY', to: 'inbox@example.test', from: 'Enquiries <enquiries@example.test>' };
  const outcome = await notify(mail, v, meta, { fetchImpl: async (url, init) => { sent.push({ url, init }); return { status: 200, json: async () => ({ id: 'x' }) }; } });
  const body = JSON.parse(sent[0].init.body);
  t(outcome === 'sent' && sent[0].url === 'https://api.resend.com/emails' && body.to.join() === 'inbox@example.test' && body.reply_to === 'someone@example.test', 'one email goes to the enquiry inbox, with the visitor’s address to reply to');
  t(sent[0].init.headers['idempotency-key'] === `${ID}:261116`, 'its idempotency key is the submission ID and the reference’s day');
  let threw = null; try { await notify(mail, v, meta, { fetchImpl: async () => ({ status: 422, json: async () => ({}) }) }); } catch (err) { threw = err; }
  t(threw && threw.status === 422 && !String(threw.message).includes('Eve'), 'a provider that refuses is an error carrying a status and none of the visitor’s details');
  const phoneOnly = enqSanitize({ ...good, email: '', phone: '082 123456' });
  const sent2 = []; await notify(mail, phoneOnly, meta, { fetchImpl: async (url, init) => { sent2.push(init); return { status: 200, json: async () => ({}) }; } });
  t(!('reply_to' in JSON.parse(sent2[0].body)) && buildEmail(phoneOnly, meta).text.includes('Reply by: phone, on 082 123456'), 'a phone-only enquiry has no reply-to, and the email says to reply by phone');
}

/* the per-sender limit */
{
  const b = new Map(); let n = 0; for (let i = 0; i < PER_IP; i++) if (!rateLimited('a', 1000 + i, b)) n++;
  t(n === PER_IP && rateLimited('a', 2000, b) === true && rateLimited('b', 2000, b) === false && rateLimited('a', 2000 + PER_IP_WINDOW + 10, b) === false, `one address gets ${PER_IP} in the window, then is turned away; another address, and the same one later, are not`);
}

/* the handler, on a real port */
const dir = await mkdtemp(join(tmpdir(), 'qt-enquiry-test-'));
let env = { QT_ENQUIRY_DIR: dir }, fetchImpl = async () => { throw new Error('no network in this test'); }, clock = NOW.getTime();
const logged = [];
const server = createServer((req, res) => handler(req, res, { env, fetchImpl, log: (m) => logged.push(m), now: () => clock, buckets: new Map() }));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/api/enquiry`;
const post = async (body, headers = { 'content-type': 'application/json' }) => { const res = await fetch(base, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: res.status, json: await res.json().catch(() => null), headers: res.headers }; };
try {
  const probe = await (await fetch(base)).json();
  t(probe.ok && probe.configured === true && probe.notifies === false && probe.accepts === 'POST', 'the probe says whether enquiries can be taken, and whether a notification will be sent');
  t(JSON.stringify(Object.keys(probe).sort()) === JSON.stringify(['accepts', 'configured', 'dir', 'limits', 'notifies', 'ok']), 'the probe returns no record and no address');

  const a = await post(good);
  t(a.status === 200 && a.json.ok && a.json.saved === true && REFERENCE_RE.test(a.json.reference) && a.headers.get('cache-control') === 'no-store', 'email only: stored, and confirmed with a reference');
  t(JSON.stringify(Object.keys(a.json).sort()) === JSON.stringify(['acceptedAt', 'ok', 'reference', 'saved']), 'the answer carries the reference and nothing of the enquiry');
  const rec = JSON.parse(await readFile(join(dir, `enquiry-${ID}.json`), 'utf8'));
  t(rec.reference === a.json.reference && rec.email === 'someone@example.test' && rec.notify_status === 'not-configured' && rec.values.need === good.need, 'the record holds what was sent, and says no notification is configured');

  const b = await post({ ...good, submissionId: ID2, email: '', phone: '+60 82 123 456' });
  t(b.status === 200 && b.json.saved === true && JSON.parse(await readFile(join(dir, `enquiry-${ID2}.json`), 'utf8')).reply_by === 'phone', 'phone only: stored, to be answered by phone');

  const again = await post(good);
  t(again.status === 200 && again.json.reference === a.json.reference && again.json.duplicate === true && (await readdir(dir)).length === 2, 'the same submission sent again: the same reference, and still one record');
  clock = new Date('2026-11-17T18:00:00Z').getTime();
  const nextDay = await post(good);
  t(nextDay.json.reference === a.json.reference, 'a retry after midnight keeps the stored reference');
  clock = NOW.getTime();

  const none = await post({ ...good, submissionId: '5d6e7f80-1a2b-4c3d-8e9f-a0b1c2d3e4f5', email: '', phone: '' });
  t(none.status === 400 && none.json.fields.email && !('reference' in none.json), 'no way to reply: 400 with the field named, and no reference');
  t((await post({ ...good, submissionId: 'not-a-uuid' })).status === 400 && (await post({ ...good, website: 'http://spam.example' })).status === 400, 'a submission ID that is not a UUID, and a filled honeypot, are refused');
  t((await post('{', { 'content-type': 'application/json' })).status === 400 && (await post('a=1', { 'content-type': 'application/x-www-form-urlencoded' })).status === 415, 'a body that is not JSON is refused: a form on another site cannot post here');
  t((await post({ ...good, need: 'x'.repeat(MAX_BODY) })).status === 413, 'a body over the limit is refused');
  t((await fetch(base, { method: 'DELETE' })).status === 405, 'any other method is refused');
  t((await readdir(dir)).length === 2, 'none of the refused requests left a record');

  /* the store failing: nothing confirmed, nothing sent */
  env = { QT_ENQUIRY_SUPABASE_URL: SB.url, QT_ENQUIRY_SUPABASE_KEY: SB.key, QT_ENQUIRY_RESEND_KEY: 'RESEND_TEST_KEY', QT_ENQUIRY_TO: 'inbox@example.test' };
  const mailCalls = [];
  const withMail = (sb, mailStatus) => async (url, init) => { if (url.startsWith('https://api.resend.com/')) { mailCalls.push(init); if (mailStatus === 'throw') throw new Error('network'); return { status: mailStatus, json: async () => ({}) }; } return sb(url, init); };
  fetchImpl = withMail(supabase({ failOn: 'insert' }), 200);
  const down = await post({ ...good, submissionId: '11111111-2222-4333-8444-555555555555' });
  t(down.status === 502 && down.json.reason === 'store-failed' && !('reference' in down.json) && mailCalls.length === 0, 'the store failing: 502, no reference, and no email was sent');
  fetchImpl = withMail(supabase({ failOn: 'lookup' }), 200);
  t((await post({ ...good, submissionId: '11111111-2222-4333-8444-555555555556' })).status === 502 && mailCalls.length === 0, 'the store failing at the first lookup: the same');

  /* stored, then notified */
  let sb = supabase(); fetchImpl = withMail(sb, 200);
  const sid = '22222222-3333-4444-8555-666666666666';
  const sentOk = await post({ ...good, submissionId: sid });
  t(sentOk.status === 200 && sb.rows[0].notify_status === 'sent' && mailCalls.length === 1, 'stored, then one email, and the row says sent');
  await post({ ...good, submissionId: sid });
  t(mailCalls.length === 1 && sb.rows.length === 1, 'the same submission again: no second row and no second email');

  /* the email failing after the store saved */
  sb = supabase(); fetchImpl = withMail(sb, 500); mailCalls.length = 0;
  const sid2 = '33333333-4444-4555-8666-777777777777';
  const mailDown = await post({ ...good, submissionId: sid2 });
  t(mailDown.status === 200 && mailDown.json.saved === true && REFERENCE_RE.test(mailDown.json.reference) && sb.rows[0].notify_status === 'failed', 'the email failing after the store saved: still confirmed, and the row says failed');
  fetchImpl = withMail(sb, 'throw');
  await post({ ...good, submissionId: sid2 });
  t(sb.rows.length === 1 && sb.rows[0].notify_status === 'failed' && mailCalls.length === 2, 'a retry tries the email again and creates nothing');
  fetchImpl = withMail(sb, 200);
  const recovered = await post({ ...good, submissionId: sid2 });
  t(recovered.json.reference === mailDown.json.reference && sb.rows.length === 1 && sb.rows[0].notify_status === 'sent', 'when the email works again the same record is notified: recovered without a duplicate');
  fetchImpl = withMail(sb, 409);
  const sid3 = '44444444-5555-4666-8777-888888888888';
  await post({ ...good, submissionId: sid3 });
  t(sb.rows.find(r => r.submission_id === sid3).notify_status === 'sent', 'a provider answering that the key was already used counts as sent');
  sb = supabase({ failOn: 'update' }); fetchImpl = withMail(sb, 200);
  const sid4 = '55555555-6666-4777-8888-999999999999';
  const noUpdate = await post({ ...good, submissionId: sid4 });
  t(noUpdate.status === 200 && sb.rows[0].notify_status === 'pending', 'if the outcome cannot be written the enquiry is still confirmed, and the row stays pending');

  /* nothing configured */
  env = {}; fetchImpl = async () => { throw new Error('no network'); };
  const off = await post({ ...good, submissionId: '66666666-7777-4888-8999-aaaaaaaaaaaa' });
  t(off.status === 503 && off.json.reason === 'not-configured' && !('reference' in off.json), 'no store: 503, and no reference');
  t((await (await fetch(base)).json()).configured === false, 'the probe then says enquiries are not taken');
  env = { QT_ENQUIRY_RESEND_KEY: 'RESEND_TEST_KEY', QT_ENQUIRY_TO: 'inbox@example.test' };
  t((await post({ ...good, submissionId: '66666666-7777-4888-8999-aaaaaaaaaaab' })).status === 503, 'an email service with no store is not enough: nothing is confirmed without the store');

  /* what is logged, and what comes back */
  const all = JSON.stringify(logged);
  t(logged.length > 0 && !all.includes('Test Enquirer') && !all.includes('someone@example.test') && !all.includes('TESTKEY') && !all.includes('RESEND_TEST_KEY') && !all.includes('TEST enquiry'), 'the log carries statuses and error names: no name, address, message or key');
  t(!JSON.stringify([a.json, again.json, down.json, mailDown.json, off.json]).includes('someone@example.test'), 'no answer repeats the visitor’s details');
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}

/* the SQL: who can reach a record, and what the person tracking enquiries fills in */
{
  const f = join(HERE, 'docs/enquiry-store.sql');
  const sql = existsSync(f) ? readFileSync(f, 'utf8') : '';
  t(/submission_id\s+uuid\s+not null unique/.test(sql) && /notify_status[^,]*check \(notify_status in \('pending', 'sent', 'failed', 'not-configured'\)\)/.test(sql), 'the table has a unique submission ID and the four notification outcomes');
  t(/enable row level security/.test(sql) && !/create policy/i.test(sql) && /revoke all on public\.qt_enquiries from anon, authenticated/.test(sql), 'row-level security is on with no policy, and the public roles hold nothing: a record cannot be read without the server’s key');
  t(/grant select, insert, update on public\.qt_enquiries to service_role/.test(sql) && !/grant[^;]*delete/i.test(sql) && !/\b(delete from|truncate)\b/i.test(sql), 'the server may read, add and update; nothing in the file deletes');
  for (const col of ['logged_at', 'logged_by', 'owner', 'status', 'outcome', 'next_action', 'due_date', 'related_ref']) t(new RegExp(`^\\s+${col}\\s`, 'm').test(sql), `the person tracking enquiries has a column for ${col}`);
  t(/security_invoker = true/.test(sql) && /revoke all on public\.qt_enquiries_open from anon, authenticated/.test(sql), 'the tracking view is the invoker’s, and closed to the public roles');
  t(!/storage\.buckets/.test(sql), 'no file bucket is made: an enquiry carries no file');
}

console.log(failed ? `${failed} enquiry-api check(s) broken.` : `all ${passed} enquiry-api checks hold`);
process.exit(failed ? 1 : 0);
