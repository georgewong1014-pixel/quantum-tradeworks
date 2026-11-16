/* ==========================================================================
   THE ENQUIRY FORM (the owner, 16 Nov 2026: "full version … an assistant will
   be in charge to track enquiries, and we are building the funnel"). It
   follows the contract of the ELS Source enquiry flow, adapted to this site
   (api/enquiry.mjs holds the server's half).

   WHAT IT ASKS FOR: a name, one way to reply — an email address or a phone
   number, whichever the visitor has; never a particular app — and what is
   wanted, in a sentence. Nothing else is required: no budget, no figures, no
   finished brief. The rules are in 66-enquiry-rules.js, and the function
   applies the same text again.

   THREE THINGS KEPT APART, in what the page says:
     - what is typed and not sent: it stays in this form, in this page's
       memory, and is lost on reload. The form says "Not sent yet".
     - an enquiry received: said only when the store has answered that it
       holds the record, with the reference the server made.
     - an order, a commission or an agreement: this is none of them, and the
       confirmation says so.

   WHEN IT IS OFFERED. Two things must both be true, and neither is set in
   this file:
     1. LAUNCH.enquiry.retention holds the owner's sentence on how long an
        enquiry is kept (15-derivation.js). Until it does, no button is
        drawn and the privacy page lists nothing about enquiries: personal
        data is not collected before the notice says how long it is kept.
     2. The deployment has an enquiry store configured (the probe below).
        Until it has, the drawer says enquiries are not switched on and
        offers the email address.

   ONE SUBMISSION, ONE RECORD. The submission ID is made here, once for a
   given set of answers, and kept while they are unchanged: a retry after a
   slow answer or a failure carries the same ID and the store keeps one
   record. Change an answer and it is a new submission.

   NOTHING ELSE LEAVES THE BROWSER: not a saved model, a deal or a watchlist.
   No file is taken: a document goes by email, quoting the reference.
   ========================================================================== */
const enquiryOffered = () => !!(LAUNCH.enquiry && LAUNCH.enquiry.endpoint && LAUNCH.enquiry.retention);
const ENQUIRY_TOPIC_NAMES = { property: 'Property Intelligence', equities: 'Equities Research', scanner: 'Quantum Scanner', other: 'Something else' };
let enquiryProbe = null;
function enquirySubmission() {
  if (!enquiryOffered() || typeof fetch !== 'function') return Promise.resolve({ configured: false });
  if (!enquiryProbe) enquiryProbe = fetch(LAUNCH.enquiry.endpoint, { method: 'GET', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : { configured: false }))
    .then(j => ({ configured: !!j.configured }))
    .catch(() => ({ configured: false }));
  return enquiryProbe;
}
/* What is typed and not sent, and the ID of the submission those answers
   make. In memory only. */
const enquiryDraft = { values: {}, signature: '', id: '' };
function enquirySubmissionId(v) {
  const signature = JSON.stringify(v);
  if (signature !== enquiryDraft.signature || !enquiryDraft.id) { enquiryDraft.signature = signature; enquiryDraft.id = crypto.randomUUID(); }
  return enquiryDraft.id;
}
async function sendEnquiry(v, honeypot) {
  const res = await fetch(LAUNCH.enquiry.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...v, submissionId: enquirySubmissionId(v), page: location.pathname, ...(reportBuild() ? { build: reportBuild() } : {}), ...(honeypot ? { website: honeypot } : {}) }) });
  let j = null;
  try { j = await res.json(); } catch { j = null; }
  if (res.ok && j?.ok && j.saved === true && /^QTE-\d{6}-[2-9A-HJKMNP-Z]{4}$/.test(j.reference || '')) return { ok: true, reference: j.reference, acceptedAt: j.acceptedAt };
  return { ok: false, status: res.status, reason: j?.reason || String(res.status), fields: j?.fields || null };
}
/* What the visitor is told when it was not received. Each says that nothing
   was received and that what they typed is still here. */
function enquiryFailure(r) {
  const alt = supportEmail() ? ` Or write to ${supportEmail()} from your own email program.` : '';
  if (r.reason === 'not-configured') return `Enquiries from this page are not switched on. Nothing was received.${alt}`;
  if (r.reason === 'rate-limited' || r.reason === 'capped') return `The site is not taking more enquiries right now (${r.reason === 'capped' ? 'its daily limit is reached' : 'too many from here in a short time'}). Nothing was received; what you typed is still here.${alt}`;
  if (r.fields) return 'Some details need another look. Nothing was sent.';
  return `That did not go through. Nothing was received, and what you typed is still here: try again.${alt}`;
}

function openEnquiry() {
  const body = el('div');
  const lead = el('p', { class: 'body', style: 'margin-bottom:var(--md)' }, 'Checking whether this page can take an enquiry…');
  body.append(lead);
  openDrawer('Send an enquiry', body);
  enquirySubmission().then(({ configured }) => {
    if (!body.isConnected) return;
    if (!configured) {
      lead.textContent = supportEmail()
        ? `Enquiries from this page are not switched on yet. Write to ${supportEmail()} from your own email program; this site does not send the message or confirm that it arrived.`
        : 'Enquiries from this page are not switched on yet.';
      return;
    }
    lead.textContent = 'Tell the site’s owner what you need. A name, one way to reply and a sentence are enough: no budget, no figures and no finished brief are needed to ask.';
    body.append(enquiryForm());
  });
}

function enquiryForm() {
  const v = enquiryDraft.values, form = el('div', { 'data-enquiry-form': '' });
  const errs = {}, boxes = {};
  const field = (key, label, input, hint) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    input.id = `enq-${key}`; input.setAttribute('aria-describedby', `enq-${key}-err`);
    const err = el('p', { class: 'metaline', id: `enq-${key}-err`, role: 'alert', style: 'margin-top:6px;color:var(--dn-text)' });
    errs[key] = err; boxes[key] = input;
    f.append(...[el('label', { for: input.id }, label), input, hint ? el('p', { class: 'metaline', style: 'margin-top:6px' }, hint) : null, err].filter(Boolean));
    const keep = () => { v[key] = input.value; };
    input.addEventListener('input', keep); input.addEventListener('change', keep);
    if (v[key] !== undefined) input.value = v[key];
    return f;
  };
  const text = (key, attrs = {}) => el('input', { class: 'input', type: 'text', autocomplete: 'off', ...attrs });
  form.append(
    field('topic', 'What it is about', el('select', { class: 'input' }, [el('option', { value: '' }, 'Choose'), ...ENQ_TOPICS.map(t => el('option', { value: t }, ENQUIRY_TOPIC_NAMES[t]))])),
    field('name', 'Your name', text('name', { maxlength: String(ENQ_MAX.name), autocomplete: 'name' })),
    field('email', 'Email address', text('email', { type: 'email', inputmode: 'email', maxlength: String(ENQ_MAX.email), autocomplete: 'email' }), 'An email address or a phone number: one is enough.'),
    field('phone', 'Phone number', text('phone', { type: 'tel', inputmode: 'tel', maxlength: String(ENQ_MAX.phone), autocomplete: 'tel' })),
    field('replyBy', 'How you would like the reply', el('select', { class: 'input' }, [el('option', { value: '' }, 'By whichever I gave'), el('option', { value: 'email' }, 'By email'), el('option', { value: 'phone' }, 'By phone')])),
    field('need', 'What you need', el('textarea', { class: 'input', maxlength: String(ENQ_MAX.need), placeholder: 'What you are trying to do, and what would help.' }), 'Leave out anything private you would not want read: your income, your loan, an identity number.'),
    field('timing', 'When you need it (optional)', text('timing', { maxlength: String(ENQ_MAX.timing) })));
  /* A field no person sees or reaches: a program that fills every field
     fills this one, and the function refuses the enquiry. */
  const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', 'data-enquiry-trap': '' });
  form.append(el('div', { 'aria-hidden': 'true', style: 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden' }, trap));
  /* Stacked, not a two-column list: in a drawer the second column is too
     narrow to read a paragraph in. */
  form.append(el('div', { class: 'sunk', 'data-enquiry-passes': '', style: 'margin-bottom:var(--md)' }, [
    el('p', { class: 'body', style: 'margin-bottom:var(--sm)' }, [el('strong', {}, 'What sending passes on. '), 'Your name, the email address or phone number you give, and your message, with the page you were on and the build. They go to this site’s enquiry store and to the person who handles enquiries. Nothing from your saved work is sent, and no file. ', LAUNCH.enquiry.retention, ' ', tlink('Privacy', '/privacy'), '.']),
    el('p', { class: 'body' }, [el('strong', {}, 'What it is. '), 'An enquiry. It is not an order, a commission or an agreement, and sending one costs nothing.']),
  ]));
  const status = el('p', { class: 'metaline', role: 'status', 'data-enquiry-status': '', style: 'margin-top:8px' }, 'Not sent yet.');
  const btn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-enquiry-send': '', onclick: async () => {
    const clean = enqSanitize({ topic: boxes.topic.value, name: boxes.name.value, email: boxes.email.value, phone: boxes.phone.value, replyBy: boxes.replyBy.value, need: boxes.need.value, timing: boxes.timing.value });
    const show = (fields) => { let first = null; for (const k of Object.keys(errs)) { errs[k].textContent = fields[k] || ''; boxes[k].toggleAttribute('aria-invalid', !!fields[k]); if (fields[k] && !first) first = boxes[k]; } if (first) first.focus(); return !!first; };
    if (show(enqValidate(clean))) { status.textContent = 'Not sent yet: some details need another look.'; return; }
    btn.disabled = true; status.textContent = 'Sending…';
    const r = await sendEnquiry(clean, trap.value).catch(() => ({ ok: false, reason: 'network' }));
    if (!r.ok) { btn.disabled = false; if (r.fields) show(r.fields); status.textContent = enquiryFailure(r); return; }
    /* Received: the store holds it. The draft is done with. */
    enquiryDraft.values = {}; enquiryDraft.signature = ''; enquiryDraft.id = '';
    const at = r.acceptedAt ? caseRaisedAt(new Date(r.acceptedAt)) : caseRaisedAt(new Date());
    const title = document.getElementById('drawerTitle');
    if (title) title.textContent = `Enquiry received — reference ${r.reference}`;
    const done = el('div', { 'data-enquiry-received': r.reference }, [
      el('p', { class: 'body', style: 'margin-bottom:var(--md)' }, `Received. Reference ${r.reference}. It was saved in this site’s enquiry store at ${at}.`),
      el('p', { class: 'body', style: 'margin-bottom:var(--md)' }, 'It has not been read yet, and no reply time is promised. It is an enquiry, not an order, a commission or an agreement.'),
      el('p', { class: 'body', style: 'margin-bottom:var(--md)' }, supportEmail() ? `To send a document, email it to ${supportEmail()} from your own email program and quote the reference. This page takes no files.` : 'This page takes no files.'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-enquiry-copy': '', onclick: () => { navigator.clipboard?.writeText(r.reference).then(() => toast('Reference copied'), () => toast('Copy it by hand: ' + r.reference)); } }, 'Copy the reference'),
    ]);
    form.replaceWith(done);
    const lead = document.querySelector('#drawer p.body');
    if (lead && !done.contains(lead)) lead.remove();
    toast(`Enquiry received — reference ${r.reference}`);
  } }, 'Send this enquiry');
  form.append(btn, status);
  return form;
}
