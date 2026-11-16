/* THE RULES OF AN ENQUIRY, as the form applies them before anything is sent.
   The same text stands in api/enquiry.mjs, where the function applies them
   again; enquiry-api-test.mjs fails if the two differ by a character. Change
   both together. */
/* <enquiry-rules> — the same block stands in api/enquiry.mjs. */
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
