/* ==========================================================================
   THE CLIENT PROPOSAL — A SAVED PROPERTY, SET OUT FOR SOMEONE ELSE
   --------------------------------------------------------------------------
   The owner chose Property as the next product (3 Oct 2026). Its paying
   audience is agents, mortgage consultants and small developers, and their
   job is a proposal for a client: the property entered once, then a page
   they can hand over. Everything such a page needs was already here — a
   saved property with its scenarios (71-property-models.js), the model
   every property tool reads (dealModel, 75-property-grade.js) and a
   printable record (97-decision-record.js) — but nothing set it out for a
   reader who is not the one who made it.

   ONE PROPERTY, AS SAVED. A proposal is made from a property saved in My
   properties, never from the calculator's working copy: what a client is
   handed has to be something its preparer can open again and find the
   same. A scenario is the saved scenario — the property with its own
   changes (pmSavedInputs). Changes on the calculator that are not saved
   are said to be left out, with the way to include them. A property saved
   again in another tab, while its proposal is open, redraws the proposal —
   and printing reads the property again first — so a page carried away is
   never the version before the last save (cpRefresh, below).

   NO FIGURE IS COMPUTED HERE. Each one is dealModel's, the engine the
   calculator runs, read for the same inputs, so every number equals what
   the calculator shows for them. Money is printed in whole ringgit, as the
   decision record prints it; the calculator's tiles round the same figure
   to the hundred (RM95.3k). The cash a purchase takes — the ledger's lines,
   its subtotals and its total, and the cash figures made of them — is the
   model's own, each rounded down or up to the ringgit so that every line
   adds up to the subtotal and the total printed (cpCash): rounded one by
   one, a ledger of RM1,488 + RM3,719 + RM750 + RM8,000 printed a subtotal
   of RM13,956. model-test holds the two to one value, figure by figure. An
   input is printed as it was entered, never rounded.

   WHAT IS LEFT OUT, ON PURPOSE.
   - The grade. A letter on a page handed to a client reads as a rating of
     the property, which this product does not give.
   - The equity comparison, the risk flags and the sensitivity: research
     for the preparer, not the client's commitment.
   - A fit-out allowance. Renovation and furnishing is one line in the
     model; an allowance of its own is an open decision of the owner's, and
     no default is invented for it here.

   PREPARED BY is the preparer's own name, agency, contact and logo, kept in
   this browser under one key (proposalDetails) that /privacy names, the
   export on Your data carries and a cleared browser loses with everything
   else. PREPARED FOR is the client's name and a date: they are held in
   memory by this tab and never stored — not in storage, and not in the
   page's title either, which a browser keeps in its history. A client's
   name is somebody else's personal data, and nothing here needs to keep it.

   A PREVIEW. No plan includes a proposal and nothing is sold (the launch
   audit, 29 Sep 2026); the page and each way into it say so — the
   calculator's card, My properties and /my/reports — and the Pricing page
   is left as it is.
   ========================================================================== */

/* -------------------------------------------------------- your details */
/* The logo: an image file read to a data URL, kept with the details. A
   logo printed 56px tall needs a few tens of kilobytes, and this browser's
   storage is shared with every property, list and record the reader keeps,
   so a file over 200 KB is refused, and the page says so before one is
   chosen. Only the three raster formats every browser prints are taken —
   by what the file holds, not by its name: the type a browser gives a file
   comes from its extension, so a text file, a PDF or an SVG named logo.png
   arrived as a PNG, was stored, and printed as nothing under a toast that
   said it would print. */
const CP_LOGO_MAX = 200 * 1024;
const CP_LOGO_TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
const CP_LOGO_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CP_LOGO_CHARS = 'data:image/jpeg;base64,'.length + Math.ceil(CP_LOGO_MAX / 3) * 4;
const CP_TEXT = { name: 80, agency: 80, contact: 120 };

/* What the first bytes of a file say it is: a PNG's eight-byte signature,
   a JPEG's start-of-image marker, a WebP's RIFF container — or nothing. */
function cpSniff(b) {
  const at = (i, xs) => xs.every((x, j) => b[i + j] === x);
  if (b.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (b.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (b.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}
/* The first bytes a data URL holds. */
function cpUrlHead(url) {
  try { const i = url.indexOf(','); return Uint8Array.from(atob(url.slice(i + 1, i + 17)), c => c.charCodeAt(0)); }
  catch { return new Uint8Array(0); }
}
/* Whether an image ends where its format says it does. A file cut short
   past its header still loads as the part that came, and printed as a blank
   box or half a logo under "Logo added". Read by the format's own structure
   from its start, every byte of the file (b) — within the 200 KB cap, which
   is held first: a PNG's chunks, each by its stated length, as far as its
   IEND chunk; a JPEG's segments, each by its stated length, and the coded
   data after each start of scan, as far as its end-of-image marker (FF D9);
   a WebP as far as its RIFF container's size says. What follows an image's
   end is no part of it, and a browser draws the image whole without it.
   (2026-10-04: the end was looked for in the file's last bytes only, so a
   PNG with one byte after IEND, a JPEG with 40 after FF D9 and a PNG padded
   out to 200 KB — each drawn whole — were refused as "cut short".) A file
   whose structure cannot be followed — damaged rather than short — is
   whole here where its end marker is in it at all: whether it draws decides
   (cpReadLogo), and "cut short" is never said of it. */
const CP_PNG_END = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
function cpWhole(kind, b) {
  const n = b.length;
  const has = (marker, from) => { for (let i = Math.max(0, from); i + marker.length <= n; i++) if (marker.every((x, j) => b[i + j] === x)) return true; return false; };
  if (kind === 'image/png') {
    /* A chunk: its data's length (4 bytes), its type (4 letters), the data, a CRC (4). */
    for (let i = 8; i + 12 <= n;) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      const type = [4, 5, 6, 7].map(k => b[i + k]);
      if (!type.every(c => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return has(CP_PNG_END, i);
      if (i + 12 + len > n) return false;
      if (type[0] === 0x49 && type[1] === 0x45 && type[2] === 0x4e && type[3] === 0x44) return true;
      i += 12 + len;
    }
    return false;
  }
  if (kind === 'image/jpeg') {
    for (let i = 2; i + 1 < n;) {
      if (b[i] !== 0xff) return has([0xff, 0xd9], i);
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }                       /* fill */
      if (m === 0xd9) return true;                              /* end of image */
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      if (i + 3 >= n) return false;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) return has([0xff, 0xd9], i);
      i += 2 + len;
      /* After a start of scan, its coded data, to the next marker: a coded
         FF is followed by 00, or by a restart marker. */
      if (m === 0xda) while (i + 1 < n && !(b[i] === 0xff && b[i + 1] !== 0 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
    }
    return false;
  }
  if (kind === 'image/webp') return n >= 12 && ((b[4] | b[5] << 8 | b[6] << 16 | b[7] << 24) >>> 0) + 8 <= n;
  return false;
}
/* Every byte a data URL holds — the last one asked for kept, as the page's
   draws ask for the same stored logo again and again. */
let cpUrlBytesLast = { url: null, bytes: null };
function cpUrlBytes(url) {
  if (cpUrlBytesLast.url === url) return cpUrlBytesLast.bytes;
  let bytes;
  try { bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0)); }
  catch { bytes = new Uint8Array(0); }
  cpUrlBytesLast = { url, bytes };
  return bytes;
}
/* A size as a refusal states it: up to the next tenth of a kilobyte, so a
   file one byte over the cap is never called "200 KB" — "That image is 200
   KB. The logo can be at most 200 KB" refused a file in its own words. */
const cpKb = (bytes) => { const kb = Math.ceil(bytes / 102.4) / 10; return `${fmtNum(kb, Number.isInteger(kb) ? 0 : 1)} KB`; };
/* Why a logo cannot print, said after "a logo that…", or null when it can:
   the one rule for a file chosen here, a value already stored, and a file
   restored on Your data (STORE_SHAPES, 00-core.js). */
function cpLogoFault(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(v)) return 'is not a PNG, JPEG or WebP image';
  if (v.length > CP_LOGO_CHARS) {
    const b64 = v.length - v.indexOf(',') - 1;
    return `is ${cpKb(Math.floor(b64 * 3 / 4))}, over the 200 KB a logo can be`;
  }
  const head = cpUrlHead(v), kind = CP_LOGO_URL.test(v) ? cpSniff(head) : null;
  if (!kind) return 'is not a PNG, JPEG or WebP image';
  if (!cpWhole(kind, cpUrlBytes(v))) return `is a ${CP_LOGO_TYPES[kind]} image cut short — its end is missing, so it cannot print whole`;
  return null;
}
/* The restore's rule for the details (STORE_SHAPES, 00-core.js). A file
   whose logo this page would not print was taken whole and the logo then
   dropped without a word, while the export carried it on. */
function proposalDetailsFault(v) {
  const f = isRecord(v) ? cpLogoFault(v.logo) : null;
  return f ? `holds a logo that ${f}` : null;
}

/* The details as this page reads them, whatever storage holds: a restored
   file writes what it carries, so a field that is not text reads as empty,
   and a logo that is not an image this page writes — a PNG, JPEG or WebP
   data URL within the cap — reads as no logo, with the reason, so the page
   can say why the logo it holds does not print. Nothing else is read. */
function cpDetails() {
  const v = store.read('proposalDetails', null);
  const r = isRecord(v) ? v : {};
  const text = (k) => (typeof r[k] === 'string' ? r[k].trim().slice(0, CP_TEXT[k]) : '');
  const logoFault = cpLogoFault(r.logo);
  return { name: text('name'), agency: text('agency'), contact: text('contact'),
    logo: logoFault || !r.logo ? null : r.logo, logoFault, stored: isRecord(v) };
}
const cpHasDetails = (x) => !!(x.name || x.agency || x.contact || x.logo);
/* The details removed from this browser: the key itself, so neither Your
   data nor its export lists a record of nothing. False when refused. */
function cpForgetDetails() {
  try { localStorage.removeItem(STORE_PREFIX + 'proposalDetails'); return true; }
  catch { store.failed++; return false; }
}
/* A change to the details, written whole; false when the browser refused
   it. Emptied of everything, they are removed rather than kept as a record
   of blanks — which Your data listed as "saved", with no way here to
   remove it. */
function cpSaveDetails(patch) {
  const cur = cpDetails();
  const next = { name: cur.name, agency: cur.agency, contact: cur.contact, logo: cur.logo, ...patch };
  return cpHasDetails(next) ? store.write('proposalDetails', next) : cpForgetDetails();
}

/* A file chosen for the logo: read, or refused with the reason. What it
   holds decides; then its size, against the cap the page states; then
   whether it draws as a picture at all — a damaged file can start as an
   image does — and whether it is whole. The size comes before the rest
   (2026-10-04): a file over the cap was told it was cut short where it was
   only too large, and the cap is the reason the page states. */
async function cpReadLogo(file) {
  if (!file) return { ok: false, why: 'No file was chosen.' };
  let head;
  try { head = new Uint8Array(await file.slice(0, 16).arrayBuffer()); }
  catch { return { ok: false, why: 'That file could not be read.' }; }
  const kind = cpSniff(head);
  if (!kind) {
    const named = CP_LOGO_TYPES[file.type];
    return { ok: false, why: `That file is not a PNG, JPEG or WebP image${named ? ` — its name says ${named}, but what it holds is not one` : file.type ? ` (it is ${file.type})` : ''}, so it cannot be the logo.` };
  }
  if (file.size > CP_LOGO_MAX)
    return { ok: false, why: `That image is ${cpKb(file.size)}. The logo can be at most 200 KB — this browser keeps it with everything else you save here. An image about 600 pixels wide is plenty for print.` };
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { return { ok: false, why: 'That file could not be read.' }; }
  const read = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => resolve('');
    r.readAsDataURL(file);
  });
  if (!read) return { ok: false, why: 'That file could not be read.' };
  /* Typed by what it holds: a JPEG named .png is stored as the JPEG it is. */
  const url = `data:${kind};base64,${read.slice(read.indexOf(',') + 1)}`;
  const draws = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!draws) return { ok: false, why: `That file starts as a ${CP_LOGO_TYPES[kind]} image does, but the picture in it could not be drawn — it may be damaged or cut short.` };
  if (!cpWhole(kind, bytes))
    return { ok: false, why: `That file starts as a ${CP_LOGO_TYPES[kind]} image does, but its end is missing — it was cut short, so only part of the picture would print.` };
  const fault = cpLogoFault(url);
  return fault ? { ok: false, why: `That image ${fault}.` } : { ok: true, url };
}

/* ------------------------------------------------------------ this visit */
/* Prepared for, and the scenarios chosen, per property: kept for the visit
   and never written to storage (see the head of this file). The scenarios
   start as the calculator's own comparison has them, where it has been
   used this visit, and otherwise as the first three saved. */
const CP_FOR = {}, CP_PICK = {};
const cpFor = (id) => (CP_FOR[id] ||= { client: '', date: localDay() });
function cpPicks(rec) {
  const ids = (rec.scenarios || []).map(s => s.id);
  if (!CP_PICK[rec.id]) {
    const compared = (PM_COMPARE[rec.id] || []).filter(x => ids.includes(x));
    CP_PICK[rec.id] = compared.length ? compared : ids.slice(0, 3);
  }
  CP_PICK[rec.id] = CP_PICK[rec.id].filter(x => ids.includes(x)).slice(0, 3);
  return CP_PICK[rec.id];
}
/* Whether the details card is open across a redraw, once the reader has
   opened or closed it; it starts open while nothing is filled in. */
let cpDetailsOpen = null;

/* -------------------------------------------------------------- the ways in */
const cpPath = (id) => `/property/models/${encodeURIComponent(id)}/proposal`;
const CP_PREVIEW = 'A preview: client proposals are not part of any plan yet, nothing is on sale and nothing is charged.';
/* A real link, so it can be opened in a new tab: the proposal reads the
   saved property itself and needs nothing put on the calculator first. Its
   name says it is a preview wherever it is reached. */
function cpLink(rec, { id = null, cls = 'btn btn-ghost btn-sm', label = 'Client proposal' } = {}) {
  const path = cpPath(rec.id);
  return el('a', { class: cls, id, href: href(path), 'aria-label': `${label} (a preview) — ${rec.name}`, title: CP_PREVIEW,
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
}

/* The calculator's Report section: the proposal of the property on it, or —
   while the deal is not saved — the one thing to do first. */
function propertyProposalNext(d = State.deal) {
  const st = propertyStatus(d);
  const card = el('div', { class: 'card ls-section', id: 'cp-next' });
  if (st.kind !== 'model') {
    card.append(cardHead('A proposal for a client',
      'A client proposal is made from a saved property, so that it can be opened again and read the same. Save this property first.'));
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'cp-next-save',
        onclick: () => { if (saveActiveProperty()) { render(); focusAfterRedraw('#cp-next-open', '#cp-next'); } } }, 'Save this property first'),
    ]));
    return card;
  }
  card.append(cardHead('A proposal for a client',
    `“${st.rec.name}” set out for someone else: who prepared it and for whom, what buying it takes, the loan and the monthly commitment, the rent and the cash flow, up to three of its scenarios side by side and a sale at the end of the hold. Every figure is the calculator’s, from the property as saved${st.dirty ? ' — the changes on the calculator are not saved, so they are not in it until they are' : ''}. The grade, the gates and the risk flags stay here: they are research for you, not a client’s page.`));
  card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
    cpLink(st.rec, { id: 'cp-next-open' }),
    el('span', { class: 'chip chip-bronze' }, 'Preview'),
    el('span', { class: 'metaline' }, 'Not part of any plan — nothing is on sale.'),
  ]));
  return card;
}

/* -------------------------------------------------------------- formats */
/* An input as it was entered: its own decimals, up to four, never rounded
   to fewer. A rate keeps at least two, as the calculator prints one. */
function cpDecimals(v) {
  if (!isNum(v)) return 0;
  const s = String(+v.toFixed(4));
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}
const cpN = (v) => (isNum(v) ? fmtNum(v, cpDecimals(v)) : '—');
const cpPct = (v, min = 0) => (isNum(v) ? fmtPct(v, Math.max(min, cpDecimals(v))) : '—');
/* Ringgit as entered, written as money is: whole, or with two places of
   sen — RM1,850.50, never RM1,850.5 — and more places only where more were
   entered, so nothing typed is rounded away. */
const cpMoneyIn = (v) => { if (!isNum(v)) return '—'; const dp = cpDecimals(v); return fmtMoney(v, 'MYR', dp ? Math.max(2, dp) : 0); };
/* A figure the model computed, in whole ringgit. */
const cpMoney = (v) => (isNum(v) ? fmtMoney(v, 'MYR', 0) : '—');
const cpPlural = (n, one, many = `${one}s`) => `${cpN(n)} ${Number(n) === 1 ? one : many}`;
const cpCap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/* A moment as a page carried away from the screen reads it: never "today",
   and to the second, so two saves a minute apart are two versions. */
function cpWhen(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || !Number.isFinite(t.getTime())) return 'on a date not recorded';
  return `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
function cpLongDate(day) {
  const [y, mo, da] = String(day || '').split('-').map(Number);
  const t = new Date(y, (mo || 1) - 1, da || 1);
  return Number.isFinite(t.getTime()) && y ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/* A figure the proposal prints, marked with the model's name for it, so a
   check can hold it to the calculator's (model-test, property-proposal). */
const cpFig = (key, text, extra = {}) => el('span', { class: 'num', 'data-cp': key, ...extra }, text);

/* ----------------------------------------------- money that adds up */
/* Whole ringgit that add up. Each part of `raw` rounded down or up — never
   further — so that together they make `target`: the parts with the
   largest fractions are the ones rounded up (the largest-remainder rule).
   `target` is itself the whole's figure rounded down or up, so it always
   can be met. */
function cpApportion(raw, target) {
  const xs = raw.map(x => (Math.abs(x - Math.round(x)) < 1e-7 ? Math.round(x) : x));
  const out = xs.map(Math.floor);
  let need = target - out.reduce((a, b) => a + b, 0);
  xs.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([f, i]) => { if (need > 0 && f > 0) { out[i]++; need--; } });
  return out;
}
/* The ledger as the proposal prints it, from the model's own lines: the
   total is the model's safe cash required, rounded; it is shared between
   what is paid at completion (acquisition and financing), the improvement
   and the reserve, the completion cash between its two groups, and each
   group between its lines — every amount the model's, rounded down or up
   to the ringgit, and every printed sum the sum of what is printed under
   it. The key figures, the cash figures under the ledger and each scenario
   column read their cash from here, so no two can disagree. */
function cpCash(m) {
  const groups = m.costGroups.map(g => ({ id: g.id, label: g.label, items: g.items,
    raw: g.items.reduce((t, it) => t + (isNum(it[1]) ? it[1] : 0), 0) }));
  const rawOf = (ids) => groups.filter(g => ids.includes(g.id)).reduce((t, g) => t + g.raw, 0);
  const total = Math.round(groups.reduce((t, g) => t + g.raw, 0));
  const COMPLETION = ['acquisition', 'financing'];
  const PARTS = [COMPLETION, ...groups.map(g => g.id).filter(id => !COMPLETION.includes(id)).map(id => [id])];
  const parts = cpApportion(PARTS.map(rawOf), total);
  const printed = {};
  PARTS.forEach((ids, i) => {
    const mine = groups.filter(g => ids.includes(g.id));
    cpApportion(mine.map(g => g.raw), parts[i]).forEach((v, j) => { printed[mine[j].id] = v; });
  });
  groups.forEach(g => {
    g.printed = printed[g.id] ?? 0;
    const lines = cpApportion(g.items.map(it => (isNum(it[1]) ? it[1] : 0)), g.printed);
    g.lines = g.items.map((it, j) => (isNum(it[1]) ? lines[j] : null));
  });
  const sub = (id) => printed[id] ?? 0;
  const paid = Math.round(num0(m.cashAlreadyPaid));
  return { groups, total, paid, complete: sub('acquisition') + sub('financing') - paid,
    improvement: sub('improvement'), reserve: isNum(m.reserveCash) ? sub('reserve') : null, safe: total };
}

/* ------------------------------------------------- where an input came from */
/* Still the calculator's own starting figure: by the review queue's rule
   for the figures it lists (70-property.js) — untouched is the tool's —
   and for any other input, untouched and the sample deal's value. A field
   left empty is said to be empty, not called a sample: a valuation, a tax
   rate or a quote of nought is "Not entered". */
const CP_EMPTY_AT_NIL = ['bankValuation', 'marginalTaxPct', 'mrtaPremium', 'mltaPremiumAnnual', 'flatQuotePct', 'flatQuoteAmount', 'flatQuoteYears'];
function cpSeeded(d, k) {
  if (k === 'place') return cpSeeded(d, 'city') && cpSeeded(d, 'district');
  if (isTouched(d, k)) return false;
  if (CP_EMPTY_AT_NIL.includes(k) && !(num0(d[k]) > 0)) return false;
  if (PROPERTY_REVIEW.some(f => f.k === k)) return true;
  if (d[k] == null || d[k] === '') return false;
  return pmCanon(d[k]) === pmCanon(PROPERTY_DEFAULT_DEAL[k]);
}
const cpSampleMark = () => el('span', { class: 'cp-mark', title: 'The calculator’s own starting value: not changed for this property, and taken from no market or document.' }, 'Sample');

/* Each input as the proposal words it — its value in words and units, as
   entered. One table, read by the assumptions and by what a scenario
   changes, so an input is never worded two ways on one page. */
const CP_RULE_WORDS = { lower_of: 'The lower of the price and the valuation', valuation_only: 'The valuation' };
const cpMoneyMonth = (v) => `${cpMoneyIn(num0(v))} a month`, cpMoneyYear = (v) => `${cpMoneyIn(num0(v))} a year`;
const CP_IN = {
  price: (v) => cpMoneyIn(v), bankValuation: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'Not entered'),
  valuationRule: (v) => CP_RULE_WORDS[v || 'lower_of'] || 'The purchase price',
  bookingDepositPaid: (v) => cpMoneyIn(num0(v)), renovation: (v) => cpMoneyIn(num0(v)),
  renoValueRecoveryPct: (v) => cpPct(num0(v)), renoRentUpliftPct: (v) => `${cpPct(num0(v))} of the rent`,
  reserveMonths: (v) => cpPlural(v, 'month'),
  downPct: (v) => cpPct(v), ratePct: (v) => `${cpPct(v, 2)} a year`, tenureYears: (v) => cpPlural(v, 'year'),
  mrtaPremium: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'Not entered'), mltaPremiumAnnual: (v) => (num0(v) > 0 ? cpMoneyYear(v) : 'Not entered'),
  flatQuotePct: (v) => (num0(v) > 0 ? `${cpPct(v, 2)} a year` : 'Not entered'), flatQuoteAmount: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'Not entered'),
  flatQuoteYears: (v) => (num0(v) > 0 ? cpPlural(v, 'year') : 'Not entered'),
  rent: (v) => `${cpMoneyIn(v)} a month`, rentGrowthPct: (v) => `${cpPct(v)} a year`, vacancyPct: (v) => cpPct(v),
  maintenance: cpMoneyMonth, sinkingFund: cpMoneyMonth, assessment: cpMoneyYear, quitRent: cpMoneyYear, insurance: cpMoneyYear,
  repairReservePct: (v) => `${cpPct(num0(v))} of the rent collected`,
  selfManaged: (v) => (v ? 'By the owner, with no fee' : 'By a letting agent'),
  mgmtPct: (v) => `${cpPct(num0(v))} of the rent collected`, mgmtMinMonthly: cpMoneyMonth,
  leasingFeeMonths: (v) => `${cpPlural(num0(v), 'month')} of rent a tenancy`, renewalFeeMonths: (v) => `${cpPlural(num0(v), 'month')} of rent a renewal`,
  tenancyMonths: (v) => cpPlural(v, 'month'), daysToFirstTenant: (v) => cpPlural(v, 'day'), depositMonths: (v) => `${cpPlural(num0(v), 'month')} of rent`,
  repairApprovalLimit: (v) => cpMoneyIn(num0(v)), inspectionsPerYear: (v) => `${cpN(num0(v))} a year`, arrearsChaseDays: (v) => cpPlural(v, 'day'),
  ownerReportCadence: (v) => cpCap(String(v || 'not agreed')), tenantPaysUtilities: (v) => (v ? 'By the tenant' : 'By the owner'),
  ownUseWeeks: (v) => `${cpPlural(num0(v), 'week')} a year`,
  holdYears: (v) => cpPlural(v, 'year'), apprecPct: (v) => `${cpPct(v)} a year`, sellMonths: (v) => cpPlural(num0(v), 'month'),
  agentPct: (v) => cpPct(num0(v)), exitLegalPct: (v) => cpPct(num0(v)),
  disposerCategory: (v) => rpgtCategory(v).label, marginalTaxPct: (v) => (num0(v) > 0 ? cpPct(v) : 'Not entered'),
  equityReturnPct: (v) => `${cpPct(v)} a year`,
  sqft: (v) => `${cpN(v)} sq ft`, landSqft: (v) => (num0(v) > 0 ? `${cpN(v)} sq ft` : 'None'), parking: (v) => cpN(num0(v)),
  remainingLease: (v) => (num0(v) > 0 ? cpPlural(v, 'year') : 'Freehold (0 entered)'),
  propertyType: (v) => String(v || 'Property'),
  propertyClassOverride: (v) => (v && PROPERTY_CLASSES[v] ? PROPERTY_CLASSES[v].label : 'As the property type has it'),
  titleType: (v) => TITLE_TYPES.find(t => t.id === v)?.label || 'Not recorded',
  projectId: (v) => (PROJECTS.find(p => p.id === v) || {}).name || 'None named',
  /* The property decision layer's answers (P1, P2): each in its own words. */
  route: (v) => PROPERTY_ROUTES[v || DEFAULT_PROPERTY_ROUTE]?.label || PROPERTY_ROUTES[DEFAULT_PROPERTY_ROUTE].label,
  commercialSubtype: (v) => COMMERCIAL_SUBTYPES[v]?.label || 'Not chosen',
  objective: (v) => PROPERTY_OBJECTIVES[v]?.label || 'Not chosen',
  askingPrice: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'Not entered'),
  comparableIds: (v) => (Array.isArray(v) && v.length ? `${v.length} named from the register` : 'None named'),
  tenancy: (v) => SUBSALE_TENANCY[v]?.label || 'Not recorded', tenancyRent: (v) => (num0(v) > 0 ? cpMoneyMonth(v) : 'Not entered'),
  condition: (v) => SUBSALE_CONDITION[v]?.label || 'Not recorded', buildingAge: (v) => (v == null ? 'Not entered' : cpPlural(v, 'year')),
  chargesToBuyer: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'None entered'),
  targetKind: (v) => PRICE_TARGETS[v]?.label || 'Not set', targetValue: (v) => (v == null ? 'Not set' : cpN(v)),
  /* The auction risk mode's answers (P3): a term not entered says so. */
  auctionDepositOf: (v) => AUCTION_DEPOSIT_OF[v]?.label || 'Not entered',
  auctionChecks: (v) => (Array.isArray(v) && v.length ? `${v.length} of ${AUCTION_CHECK_IDS.length} ticked` : 'None ticked'),
  /* The developer premium model's answers (P4): a figure not entered says so. */
  ndCompPrice: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'Not entered'), ndRebates: (v) => (num0(v) > 0 ? cpMoneyIn(v) : 'None entered'),
  ndCompSource: (v) => (v ? String(v) : 'Not entered'), ndCompDate: (v) => (v ? String(v) : 'Not entered'),
  ndSpaMonth: (v) => ndMonthWords(v), ndVpMonth: (v) => ndMonthWords(v),
  ndSchedule: (v) => { const st = parseNdSchedule(v), t = ndTemplateOf(st); return st ? `${st.length} stage${st.length === 1 ? '' : 's'}${t ? `, Sarawak’s ${t.form} template` : ''}` : 'Not entered'; },
  /* The commercial models' answers (P5): a figure not entered says so. */
  cmAskingRent: (v) => (num0(v) > 0 ? cpMoneyMonth(v) : 'Not entered'), cmFitOut: (v) => (v == null ? 'Not entered' : cpMoneyIn(v)),
  rentComparableIds: (v) => (Array.isArray(v) && v.length ? `${v.length} named from the register` : 'None named'),
  cmLeaseExpiry: (v) => ndMonthWords(v), cmPosition: (v) => CM_POSITIONS[v]?.label || 'Not recorded',
  cmDeposit: (v) => (v == null ? 'Not entered' : `${cpN(v)} months of rent`),
};
/* Where the calculator's own label does not suit a page for someone else:
   its input box speaks as the reader ("I will manage this property
   myself") or needs the calculator's context. Every other label is the
   calculator's, without the box's hint ("(RM, 0 if not yet known)"). */
const CP_IN_LABEL = {
  selfManaged: 'Management', valuationRule: 'What the loan is calculated on', disposerCategory: 'Who would be selling',
  marginalTaxPct: 'Marginal tax rate on the rent', reserveMonths: 'Months of reserve to hold', mrtaPremium: 'Mortgage protection premium, as quoted',
  tenantPaysUtilities: 'Utilities paid', ownUseWeeks: 'The owner’s own use', projectId: 'Development',
};
const cpLabel = (k) => CP_IN_LABEL[k] || String(PROPERTY_I18N[`in.${k}`]?.en || PM_FIELD_WORDS[k] || k).replace(/\s*\([^)]*\)$/, '');
const cpInText = (k, v) => (CP_IN[k] ? CP_IN[k](v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? cpN(v) : v == null ? 'Not set' : String(v));

/* What a scenario changes, for a client: each input it changes, in the
   assumptions' own words and units, as entered. The calculator's line for
   the same (pmOverrideLine) is shorthand for the one who made it — "Loan
   interest rate (%) 4.38" for an entered 4.375, "I will manage this
   property myself false", "valuation_only" — and it was printed here. */
const CP_RECORD_WORDS = { evidence: 'how its figures were established', checks: 'the checklist answers', checkEvidence: 'how the checklist answers were established' };
function cpChangeBits(ov, base) {
  const merged = pmMerge(base, ov);
  const keys = Object.keys(ov || {}).filter(k => !PM_POINTERS.includes(k) && k !== 'touched' && k !== 'userStarted');
  const place = keys.includes('city') || keys.includes('district');
  const bits = [];
  if (place) bits.push(`Location: ${pmPlace(merged)}`);
  keys.forEach(k => {
    if (k === 'city' || k === 'district' || (k === 'projectId' && place)) return;
    if (isRecord(ov[k])) { bits.push(cpCap(CP_RECORD_WORDS[k] || k)); return; }
    bits.push(`${cpLabel(k)}: ${cpInText(k, merged[k])}`);
  });
  return bits;
}
const cpChangeLine = (ov, base) => cpChangeBits(ov, base).join('; ');
/* The name a new scenario is offered (saveAsScenario, 71-property-models.js):
   what it changes in the same words, as many whole changes as fit in the 80
   characters a name keeps. The calculator's shorthand was offered, cut at
   80 — "…; I will manage this property myself fal" — and, accepted as
   offered, it headed the scenario's column on a client's proposal. */
function cpScenarioName(ov, base, max = 80) {
  const bits = cpChangeBits(ov, base);
  for (let n = bits.length; n > 0; n--) {
    const s = `${bits.slice(0, n).join('; ')}${n < bits.length ? `; and ${bits.length - n} more` : ''}`;
    if (s.length <= max) return s;
  }
  if (!bits.length) return '';
  /* One change too long to name whole: cut at a word, and say so. */
  const room = bits.length > 1 ? max - `…; and ${bits.length - 1} more`.length : max - 1;
  const cut = bits[0].slice(0, room).replace(/[\s;:,]+\S*$/, '');
  return `${cut}…${bits.length > 1 ? `; and ${bits.length - 1} more` : ''}`;
}

/* The inputs every figure rests on, in the calculator's own groups and
   words, each only where the property's class uses it (propertyInputApplies
   and the class's own rules) and only where a figure here reads it: the
   share of the rent that depends on the renovation moves the renovation's
   own return (renovationReturn), which a proposal does not print, so it is
   not listed as something the proposal rests on; a property bought without
   a loan uses no rate or tenure; a class with no rent, no tax rate on it. */
function cpInputGroups(d, m) {
  const lets = m.letsToTenant, strata = m.strataCharges, reno = num0(d.renovation) > 0, loan = m.loan > 0;
  const managed = lets && !d.selfManaged;
  const row = (k, value = cpInText(k, d[k])) => ({ k, label: cpLabel(k), value });
  /* The price and the built-up area are the property's own facts, listed
     above these groups with their marks; they are not listed twice. */
  return [
    ['Purchase', [
      row('bankValuation'),
      num0(d.bankValuation) > 0 ? row('valuationRule') : null,
      row('bookingDepositPaid'),
      row('renovation'),
      reno ? row('renoValueRecoveryPct') : null,
      row('reserveMonths', cpPlural(m.reserveMonths, 'month')),
    ]],
    ['Loan', [
      row('downPct'),
      loan ? row('ratePct') : null,
      loan ? row('tenureYears') : null,
      num0(d.mrtaPremium) > 0 ? row('mrtaPremium') : null,
    ]],
    lets ? ['Rent', [row('rent'), row('rentGrowthPct'), row('vacancyPct')]] : null,
    ['Running costs', [
      strata ? row('maintenance') : null,
      strata ? row('sinkingFund') : null,
      row('assessment'), row('quitRent'), row('insurance'),
      lets ? row('repairReservePct') : null,
      lets ? row('selfManaged') : null,
      managed ? row('mgmtPct') : null,
      managed ? row('mgmtMinMonthly') : null,
      managed ? row('leasingFeeMonths') : null,
      managed ? row('tenancyMonths', cpPlural(m.monthsPerCycle, 'month')) : null,
    ]],
    ['Sale and tax', [
      row('holdYears'), row('apprecPct'), row('sellMonths'), row('agentPct'), row('exitLegalPct'),
      row('disposerCategory'),
      lets ? row('marginalTaxPct') : null,
    ]],
  ].filter(Boolean).map(([title, rows]) => [title, rows.filter(Boolean)]);
}
/* Every input the proposal prints that is still the calculator's starting
   value — the property's facts and the groups' inputs — counted in one
   place, so the note under the assumptions and the disclosure at the foot
   cannot give two different numbers. */
const cpFacts = (d) => ['place', 'propertyType', 'titleType', ...(d.titleType !== 'strata' ? ['remainingLease'] : []), 'sqft', 'price'];
const cpSampleKeys = (d, m) => [...cpFacts(d), ...cpInputGroups(d, m).flatMap(([, rows]) => rows.map(r => r.k))].filter(k => cpSeeded(d, k));

/* ------------------------------------------------------------- the document */
function cpSection(id, title) {
  const s = el('section', { class: 'cp-sec', 'aria-labelledby': `cp-h-${id}` });
  s.append(el('h2', { id: `cp-h-${id}` }, title));
  return s;
}
/* A list of label and figure, each pair in its own row (a <div> in the
   <dl>, as HTML allows), so on paper a pair is never split — a label at the
   foot of one page with its figure on the next, or a group's heading left
   alone at the foot of a column with its rows in the next. On screen the
   rows dissolve into the list's two columns (styles.css). A value may be
   several nodes (a figure and its Sample mark): el() flattens its children
   one level, so they are spread here rather than nested. */
const cpPair = (label, value, attrs = {}) => el('div', { class: 'cp-kv-row' }, [el('dt', {}, label), el('dd', attrs, value)]);
function cpList(rows) {
  const dl = el('dl', { class: 'cp-kv' });
  rows.filter(Boolean).forEach(([label, value, note, attrs = {}]) =>
    dl.append(cpPair(label, [...(Array.isArray(value) ? value : [value]), note ? el('span', { class: 'cp-kv-note' }, note) : null], attrs)));
  return dl;
}
const cpNote = (text, { warn = false } = {}) => el('p', { class: `cp-note${warn ? ' cp-warn' : ''}` }, text);
function cpTable(caption, head, rows, { cls = '' } = {}) {
  const t = el('table', { class: `dt cp-table ${cls}`.trim() });
  t.append(el('caption', { class: 'sr-only' }, caption));
  if (head) t.append(el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { scope: 'col', class: i ? 'num' : '' }, h)))));
  t.append(el('tbody', {}, rows));
  /* A named stop of its own on a phone, where it scrolls sideways; on paper
     it is the page's width (styles.css). */
  return el('div', { class: 'tablewrap cp-tablewrap', tabindex: '0', role: 'region', 'aria-label': caption }, t);
}
const cpRow = (label, ...cells) => el('tr', {}, [el('th', { scope: 'row' }, label), ...cells.map(c => el('td', { class: 'num' }, c))]);

/* The head: who prepared it, for whom, and of what. */
function cpHead(rec, d, details, forWhom) {
  const head = el('header', { class: 'cp-head' });
  const by = el('div', { class: 'cp-by' });
  if (details.logo) by.append(el('img', { class: 'cp-logo', src: details.logo, alt: details.agency ? `${details.agency} logo` : 'Logo',
    onerror: (e) => { e.target.remove(); } }));
  /* What is filled in prints; what is not is said on the screen only, so
     an empty block never reaches the client's copy. */
  const said = details.name || details.agency || details.contact;
  by.append(el('p', { class: `cp-eyebrow${said ? '' : ' cp-screen-only'}` }, 'Prepared by'));
  if (details.name) by.append(el('p', { class: 'cp-by-name' }, details.name));
  if (details.agency) by.append(el('p', { class: 'cp-by-agency' }, details.agency));
  if (details.contact) by.append(el('p', { class: 'cp-by-contact' }, details.contact));
  if (!said) by.append(el('p', { class: 'cp-blank cp-screen-only' }, 'Your name, agency and contact print here — add them under “Your details for proposals”.'));
  const fr = el('div', { class: 'cp-for' });
  fr.append(el('p', { class: `cp-eyebrow${forWhom.client ? '' : ' cp-screen-only'}` }, 'Prepared for'));
  if (forWhom.client) fr.append(el('p', { class: 'cp-for-name' }, forWhom.client));
  else fr.append(el('p', { class: 'cp-blank cp-screen-only' }, 'The client’s name prints here.'));
  fr.append(el('p', { class: 'cp-for-date' }, cpLongDate(forWhom.date) || cpLongDate(localDay())));
  head.append(by, fr);
  return head;
}

/* The four figures a client asks first, before any table. */
function cpKeyFigures(d, m, cash) {
  const short = (m.missingCostLines || []).length;
  const shortComplete = (m.missingCostLines || []).filter(x => x.groupId === 'acquisition' || x.groupId === 'financing').length;
  const fig = (label, key, value, sub) => el('div', { class: 'cp-fig' }, [
    el('p', { class: 'cp-fig-k' }, label), el('p', { class: 'cp-fig-v' }, cpFig(key, cpMoney(value))), el('p', { class: 'cp-fig-s' }, sub)]);
  return el('div', { class: 'cp-figs' }, [
    fig('Cash to complete', 'cashStillRequiredToComplete', cash.complete,
      shortComplete ? 'So far — a cost line is not priced' : cash.paid > 0 ? ['On completion day, after ', cpFig('cashAlreadyPaid', cpMoney(cash.paid)), ' paid at offer'] : 'Paid out on completion day'),
    fig('Safe cash required', 'safeCashRequired', cash.safe,
      short ? 'So far — a cost line is not priced' : 'With the renovation and the reserve'),
    fig('Monthly instalment', 'instalment', m.instalment,
      !(m.loan > 0) ? 'No loan: the price is paid without one'
        : isNum(m.instalment) ? `${cpPct(d.ratePct, 2)} over ${cpPlural(d.tenureYears, 'year')}` : 'Not computed — the loan has no repayment schedule'),
    fig('Monthly position', 'cashflowMonthly', m.cashflowMonthly,
      !isNum(m.cashflowMonthly) ? 'Not computed' : m.letsToTenant ? (m.loan > 0 ? 'After vacancy, running costs and the loan, before tax' : 'After vacancy and running costs, before tax') :`Running costs${m.loan > 0 ? ' and the loan' : ''}; this class earns no rent`),
  ]);
}

function cpPropertySection(rec, d, m) {
  const s = cpSection('property', 'The property and what it assumes');
  const title = TITLE_TYPES.find(t => t.id === d.titleType);
  const cls = PROPERTY_CLASSES[m.propertyClass];
  const mark = (k) => (cpSeeded(d, k) ? cpSampleMark() : null);
  const type = d.propertyType || 'Property';
  /* The property's own facts: where, what and on which title — each marked
     where it is still the sample deal's, as every figure is. The location,
     the type and the title of a property nobody placed or classed printed
     as the preparer's, and a land parcel's untouched title as "Strata
     (parcel title) — recorded from the preparer's input". */
  const titleNote = cpSeeded(d, 'titleType')
    ? 'The calculator’s starting value: nobody chose it for this property. Confirm the class on the title document itself.'
    : `Recorded from the preparer’s input and not verified.${title?.restricted ? ` ${title.note}` : ''}`;
  s.append(cpList([
    ['Location', [pmPlace(d), mark('place')], null, { 'data-cp-in': 'place' }],
    ['Property type', [`${type}${cls.label !== type ? ` · ${cls.label}` : ''}${m.propertyClassSrc === 'reader' ? ', as the preparer classed it' : ''}`, mark('propertyType')], null, { 'data-cp-in': 'propertyType' }],
    ['Title class', [title ? title.label : 'Not recorded', mark('titleType')], titleNote, { 'data-cp-in': 'titleType' }],
    d.titleType !== 'strata' ? ['Years remaining on the lease', [cpInText('remainingLease', d.remainingLease), mark('remainingLease')], null, { 'data-cp-in': 'remainingLease' }] : null,
    ['Built-up area', [`${cpN(d.sqft)} sq ft`, mark('sqft')], null, { 'data-cp-in': 'sqft' }],
    num0(d.landSqft) > 0 ? ['Land area', `${cpN(d.landSqft)} sq ft`] : null,
    ['Purchase price', [cpMoneyIn(d.price), mark('price')],
      isNum(m.psf) ? [cpFig('psf', fmtMoney(m.psf, 'MYR', 0)), ' per sq ft of built-up area'] : null, { 'data-cp-in': 'price' }],
  ]));
  s.append(el('h3', {}, 'The assumptions behind every figure'));
  const grid = el('div', { class: 'cp-assume' });
  cpInputGroups(d, m).forEach(([title2, rows]) => {
    const box = el('div', { class: 'cp-assume-grp' });
    box.append(el('p', { class: 'cp-eyebrow' }, title2));
    const dl = el('dl', { class: 'cp-kv cp-kv-tight' });
    rows.forEach(r => dl.append(cpPair(r.label, [r.value, mark(r.k)], { 'data-cp-in': r.k })));
    box.append(dl);
    grid.append(box);
  });
  s.append(grid);
  const samples = cpSampleKeys(d, m).length;
  if (samples) s.append(cpNote(`${samples === 1 ? 'One input marked' : `${samples} inputs marked`} Sample ${samples === 1 ? 'is' : 'are'} still the calculator’s own starting value: nobody changed ${samples === 1 ? 'it' : 'them'} for this property, and none comes from a market or from the property’s documents. Every result below inherits that.`, { warn: true }));
  return s;
}

/* The model's own label for a cost line, as a page for the client reads
   it: the line for a quoted premium is "your quote" — the calculator
   speaking to its user — and the client is not the one who was quoted. */
const cpLineLabel = (s) => String(s).replace(/ — your quote$/, ' — as quoted');

function cpAcquisitionSection(d, m, cash) {
  const s = cpSection('acquisition', 'What buying it takes');
  /* How the price itself is met, in the model's own split: the loan, the
     deposit and — where the valuation is below the price — the gap. Every
     line under it is cash, the price's own share and the costs on top.
     Where the loan is calculated on a valuation above the price, the loan
     and the deposit the model counts make the valuation, not the price, and
     the sentence says that rather than an arithmetic that does not hold. */
  const above = m.lenderValueBasis > d.price + 0.5;
  s.append(el('p', { class: 'cp-note cp-lead' }, !(m.loan > 0)
    ? `The ${cpMoneyIn(d.price)} price is paid without a loan: it is the deposit below. The other lines are the cost of buying on top of the price, and what is set aside.`
    : above ? [`The loan of `, cpFig('loan', cpMoney(m.loan)), ` is calculated on the `, cpFig('lenderValueBasis', cpMoney(m.lenderValueBasis)),
      ` valuation, which is above the ${cpMoneyIn(d.price)} price — see the note under “The loan and the monthly commitment”. The lines below are the deposit the model counts, the cost of buying on top of the price, and what is set aside.`]
    : [`The ${cpMoneyIn(d.price)} price is met by a loan of `, cpFig('loan', cpMoney(m.loan)),
      m.valuationGapCash > 0 ? ', the deposit and the valuation-gap cash below.' : ' and the deposit below.',
      ' The other lines are the cost of buying on top of the price, and what is set aside.']));
  const rows = [];
  /* Each fee line by its provenance in the fee rulebook (70-property.js). */
  const mark = (r) => {
    const pv = r?.provenance;
    return pv === 'estimated' ? el('span', { class: 'cp-mark', title: 'A commonly quoted approximation, not a quotation and not read off an official scale.' }, 'estimated')
      : pv === 'unknown' ? el('span', { class: 'cp-mark', title: 'The rule for this jurisdiction could not be verified from an official source; the amount rests on it — see the fee rulebook.' }, 'unknown rule')
      : pv === 'verified' ? el('span', { class: 'cp-mark cp-mark-quiet', title: `Computed from the official scale the fee rulebook ${FEE_TABLE.version} cites, checked ${feeDay(FEE_TABLE.checkedOn)}.` }, 'verified scale')
      : pv === 'quote' ? el('span', { class: 'cp-mark cp-mark-quiet', title: 'A figure from a quotation the preparer was given.' }, 'quoted')
      : null;
  };
  cash.groups.forEach(g => {
    rows.push(el('tr', { class: 'cp-grp' }, el('th', { scope: 'rowgroup', colspan: 2 }, g.label)));
    g.items.forEach((it, j) => {
      rows.push(el('tr', {}, [
        el('th', { scope: 'row' }, [cpLineLabel(it[0]), mark(it[2])]),
        el('td', { class: 'num' }, isNum(g.lines[j]) ? cpFig('line', cpMoney(g.lines[j]), { 'data-cp-line': it[0], 'data-cp-group': g.id })
          : el('span', { class: 'cp-unpriced', 'data-cp': 'line', 'data-cp-line': it[0], 'data-cp-group': g.id }, 'not priced')),
      ]));
    });
    if (g.items.length > 1) rows.push(el('tr', { class: 'cp-sub' }, [el('th', { scope: 'row' }, `${g.label}, together`),
      el('td', { class: 'num' }, cpFig('subtotal', cpMoney(g.printed), { 'data-cp-group': g.id }))]));
  });
  const missing = m.missingCostLines || [];
  rows.push(el('tr', { class: 'cp-total' }, [el('th', { scope: 'row' }, missing.length ? 'Total so far' : 'Total'),
    el('td', { class: 'num' }, cpFig('totalInitialCash', cpMoney(cash.total)))]));
  s.append(cpTable('What buying it takes, line by line', ['Cost', 'Amount'], rows, { cls: 'cp-ledger' }));
  s.append(cpNote('Each amount is in whole ringgit, rounded so that the lines add up to the totals printed: a line can be a ringgit under or over its own rounding.'));
  if (missing.length) s.append(cpNote(`Not the full amount: ${missing.map(x => x.label.toLowerCase()).join(', ')} could not be priced, so the total is short by whatever ${missing.length === 1 ? 'it comes' : 'they come'} to. ${missing.length === 1 ? 'It is' : 'They are'} left unpriced rather than counted as nothing.`, { warn: true }));
  if (isNum(m.unconfirmedCost) && m.unconfirmedCost > 0 && m.totalInitialCash > 0)
    s.append(el('p', { class: 'cp-note cp-warn' }, [cpFig('unconfirmedCost', cpMoney(m.unconfirmedCost)),
      ' of the total — ', cpFig('unconfirmedShare', fmtPct(m.unconfirmedCost / m.totalInitialCash * 100, 0)),
      ' — rests on unverified or unknown fee lines: estimates, or amounts resting on a rule that could not be verified for this jurisdiction — none checked against an official source. Confirm each with the lender, the solicitor and the local authority before relying on it.']));
  /* The optional lines left out of the total, named so the absence is seen
     (the fee rulebook 1.1.0). */
  (m.optionalCostLines || []).forEach(x => s.append(cpNote(`${x.label} — not included in the total. Optional cover a lender may ask for; with no quote entered it is left out, and would add the premium quoted (the fee rulebook’s estimate is ${cpMoneyIn(x.estimate)}).`)));
  const lets = m.letsToTenant;
  s.append(cpList([
    cash.paid > 0 ? ['Cash already paid', cpFig('cashAlreadyPaid', cpMoney(cash.paid)), 'The booking deposit handed over at offer — part of the deposit, not on top of it.'] : null,
    ['Cash still to complete', cpFig('cashStillRequiredToComplete', cpMoney(cash.complete)), `Paid out on completion day: the deposit, any valuation gap, the duties, the legal fees and the financing costs${cash.paid > 0 ? ', less what was paid at offer' : ''}.`],
    [lets ? 'Cash to make it rent-ready' : 'Cash to make it ready', cpFig('improvementCash', cpMoney(cash.improvement)),
      lets ? 'Spent after completion, before it can earn: renovation, furnishing and deposits.' : 'Spent after completion: renovation, furnishing and deposits.'],
    ['Cash to keep untouched', isNum(cash.reserve) ? cpFig('reserveCash', cpMoney(cash.reserve)) : el('span', { class: 'cp-unpriced' }, 'not priced'),
      `${cpPlural(m.reserveMonths, 'month')} of instalment and owner-paid running costs, held in the owner’s account rather than spent.`],
    ['Safe cash required', cpFig('safeCashRequired', cpMoney(cash.safe)), missing.length ? 'Everything priced so far — short by the lines named above.' : 'Everything together: the cash that decides whether the purchase can be carried.'],
  ]));
  return s;
}

function cpFinancingSection(d, m) {
  const s = cpSection('financing', 'The loan and the monthly commitment');
  const loan = m.loan > 0;
  const basis = !m.financingBasisConfirmed ? 'the purchase price'
    : m.valuationRule === 'valuation_only' ? 'the valuation' : m.valuationRule === 'lower_of' ? 'the lower of the price and the valuation' : 'the purchase price';
  /* The commitment is the model's figures for it, never one worked out
     here: the instalment owed to the lender each month; the calculator's
     own "Monthly commitment" — what the owner funds from their income each
     month (monthlyCommitment, 75-property-grade.js) — and the same over a
     year (its "Costs you … a year to hold"). Without a loan there is no
     rate, tenure or repayment to describe, and nothing here describes one. */
  const cf = m.cashflowMonthly, mc = monthlyCommitment(m);
  const lets = m.letsToTenant;
  s.append(cpList([
    loan && m.financingBasisConfirmed ? ['Value the loan is calculated on', cpFig('lenderValueBasis', cpMoney(m.lenderValueBasis)), `${cpMoney(m.bankValuation)} bank or valuer estimate against a ${cpMoneyIn(d.price)} price`] : null,
    ['Loan', cpFig('loan', cpMoney(m.loan)), loan ? ['A ', cpFig('marginOfFinancePct', `${cpN(m.marginOfFinancePct)}%`), ` margin of finance on ${basis}`] : 'None: the deposit is the whole price'],
    loan ? ['Share of the price the loan funds', cpFig('financingCoverageOfPrice', fmtPct(m.financingCoverageOfPrice, 1))] : null,
    ['Monthly instalment', cpFig('instalment', cpMoney(m.instalment)), !loan ? 'Nothing is owed to a lender: there is no loan.'
      : isNum(m.instalment) ? `Owed to the lender each month: ${cpPct(d.ratePct, 2)} a year over ${cpPlural(d.tenureYears, 'year')}` : 'Not computed: the loan has no repayment schedule at the entered tenure'],
    loan ? ['Loan repayments a year', cpFig('annualDebtService', cpMoney(m.annualDebtService))] : null,
    !isNum(cf) ? null : ['Monthly commitment', cpFig('monthlyCommitment', cpMoney(mc)), mc > 0
      ? `What the owner pays from their own income each month: ${lets ? `the part of the ${loan ? 'instalment and the running costs' : 'running costs'} that the rent, after vacancy, does not meet` : `the ${loan ? 'instalment and the running costs' : 'running costs'}, as this class earns no rent`}.`
      : `Nothing from the owner’s income: ${lets ? `the rent, after vacancy, meets the running costs${loan ? ' and the instalment' : ''}` : 'there is no instalment or running cost to meet'}.`],
    !isNum(cf) || !(m.annualOwnerSubsidy > 0) ? null : ['From the owner’s own income, a year', cpFig('annualOwnerSubsidy', cpMoney(m.annualOwnerSubsidy)),
      lets ? `The monthly commitment over a year — what the rent, after vacancy and running costs, leaves unpaid${loan ? ' of the loan repayments' : ' of the running costs'} — before any major repair.`
        : `The ${loan ? 'loan repayments and the running costs together' : 'running costs'}: this class earns no rent to meet them.`],
  ]));
  if (loan && !m.financingBasisConfirmed) s.append(cpNote('The loan is calculated on the purchase price: no bank or valuer estimate has been entered, so the financing is modelled, not lender-confirmed. A valuation below the price would turn the difference into cash due on completion.', { warn: true }));
  else if (loan && m.valuationGapCash > 0) s.append(el('p', { class: 'cp-note cp-warn' }, ['The valuation is ', cpFig('valuationGapCash', cpMoney(m.valuationGapCash)),
    ` below the price, so the ${cpN(m.marginOfFinancePct)}% margin funds `, cpFig('financingCoverageOfPrice', fmtPct(m.financingCoverageOfPrice, 1)), ' of what is paid. The difference is cash due on completion, and is in the costs above as valuation-gap cash.']));
  /* A gap in the model, said where it shows: on a valuation above the price,
     dealModel lends its margin of the valuation and still counts a deposit
     of the rest of the valuation, so the loan can exceed the price and the
     cash to complete carries a deposit that would not be paid as such. */
  if (loan && m.lenderValueBasis > d.price + 0.5) s.append(el('p', { class: 'cp-note cp-warn' }, [
    `The loan is calculated on a valuation above the ${cpMoneyIn(d.price)} price, so it funds `, cpFig('financingCoverageOfPrice', fmtPct(m.financingCoverageOfPrice, 1)),
    ` of the price. The model still counts a deposit of ${cpPct(d.downPct)} of the valuation in the costs above, so the loan and that deposit together make the valuation, not the price, and the cash to complete includes a deposit that may not be paid as such. How a loan above the price would be drawn is not modelled: confirm with the lender what it will lend and what deposit it asks for before relying on the cash figures.`]));
  if (loan && m.zeroRateModelled) s.append(cpNote('The interest rate entered is 0%. If that was not intended, the instalment and everything after it are understated.', { warn: true }));
  if (!m.tenureValid && loan) s.append(cpNote('The loan tenure entered is 0, so there is no repayment schedule: the instalment, the reserve and the sale’s figures are not computed rather than shown as nothing.', { warn: true }));
  if (loan) s.append(cpNote('Scenarios, not an offer: no lender has seen this property or this borrower, and the margin a lender extends depends on its own valuation and credit policy.'));
  return s;
}

/* What "running costs" holds for this property, in words: the lines the
   model charges this class (dealModel's opex), so the client can find each
   one's figure among the assumptions. */
function cpRunningWords(d, m) {
  const managed = m.letsToTenant && !d.selfManaged;
  const bits = [...(m.strataCharges ? ['maintenance', 'sinking fund'] : []), 'assessment', 'quit rent', 'insurance',
    ...(m.letsToTenant ? ['repairs'] : []), ...(managed ? ['the letting agent’s fees'] : [])];
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

function cpRentSection(d, m, paid = false) {
  const s = cpSection('rental', m.letsToTenant ? 'Rent and the monthly cash flow' : 'What holding it costs');
  const loan = m.loan > 0;
  if (!m.letsToTenant) {
    s.append(cpNote(`A ${String(PROPERTY_CLASSES[m.propertyClass].label).toLowerCase()} class has no tenancy, so no rent, vacancy, yield or break-even rent is computed for it — working them out would mean inventing a rent nobody expects to receive.`));
    s.append(cpTable('What holding it costs, a year', null, [
      cpRow(`Running costs, a year — ${cpRunningWords(d, m)}`, cpFig('opex', cpMoney(m.opex))),
      loan ? cpRow('Loan repayments, a year', cpFig('annualDebtService', cpMoney(m.annualDebtService))) : null,
    ].filter(Boolean)));
  } else {
    s.append(cpTable('A year at the rent entered', null, [
      cpRow(`Rent, a year — ${cpMoneyIn(d.rent)} a month`, cpFig('grossAnnualRent', cpMoney(m.grossAnnualRent))),
      cpRow(`Rent collected, after ${cpPct(d.vacancyPct)} vacancy`, cpFig('effectiveRent', cpMoney(m.effectiveRent))),
      cpRow(`less running costs — ${cpRunningWords(d, m)}`, cpFig('opex', cpMoney(m.opex))),
      cpRow('Net operating income', cpFig('noi', cpMoney(m.noi))),
      loan ? cpRow('less loan repayments', cpFig('annualDebtService', cpMoney(m.annualDebtService))) : null,
    ].filter(Boolean)));
  }
  s.append(cpList([
    ['Monthly position', cpFig('cashflowMonthly', cpMoney(m.cashflowMonthly)),
      m.letsToTenant ? (loan ? 'Net operating income for a month, less the monthly instalment.' : 'Net operating income for a month; there is no instalment.')
        : `The running costs for a month${loan ? ' and the instalment' : ''}, met from the owner’s income.`],
    m.letsToTenant ? ['Break-even rent', cpFig('breakEvenRent', cpMoney(m.breakEvenRent)), 'The monthly rent at which the position is nil, after vacancy and the rent-linked costs.'] : null,
    m.letsToTenant ? ['Gross yield', cpFig('grossYield', fmtPct(m.grossYield, 2)), 'A year’s rent as a share of the price, before any cost.'] : null,
    m.letsToTenant ? ['Net yield', cpFig('netYield', fmtPct(m.netYield, 2)), 'Net operating income as a share of the price, before the loan.'] : null,
  ]));
  /* Which figures carry tax, said as the decision record says it — for a
     class that earns rent: one that earns none has no tax on it to state. */
  if (m.letsToTenant) {
    const taxKnown = m.taxComputed && isNum(m.cumTax);
    if (!m.taxComputed) s.append(cpNote('Before tax: no marginal tax rate was entered, so every figure here is before tax on the rent — what the property produces, not what an owner keeps.'));
    else if (!taxKnown) s.append(cpNote(`No tax on the rent is computed although a marginal rate of ${cpPct(d.marginalTaxPct)} is entered: the loan’s interest — the deduction that decides the tax — could not be worked out from the entered tenure.`, { warn: true }));
    else s.append(el('p', { class: 'cp-note' }, [`The monthly position and the break-even rent are before tax on the rent. ${paid ? 'The rental cash and the rate of return under “If it is sold” are' : 'The rate of return under “If it is sold” is'} after tax at ${cpPct(d.marginalTaxPct)}, which comes to `,
      cpFig('cumTax', cpMoney(m.cumTax)), ' across the hold: loan interest is deducted and principal is not. Nothing here is tax advice.']));
  }
  return s;
}

/* The property beside the scenarios chosen, on the same model. What each
   changes is said above the figures, in the assumptions' words. */
function cpScenariosSection(rec, picks) {
  const base = pmInputsOf(rec);
  const cols = [{ id: 'base', name: 'Base case', what: 'The property as saved: the figures above', d: base },
    ...picks.map(id => rec.scenarios.find(s => s.id === id)).filter(Boolean)
      .map(sc => ({ id: sc.id, name: sc.name, what: cpChangeLine(sc.overrides, base) || 'Nothing the figures use', d: pmMerge(base, sc.overrides) }))];
  const s = cpSection('scenarios', `The scenarios side by side — ${cols.length - 1} beside the base case`);
  const models = cols.map(c => dealModel(c.d));
  const cashes = models.map(cpCash);
  s.append(cpList(cols.slice(1).map(c => [c.name, el('span', { class: 'cp-sc-change', 'data-cp-what': c.id }, c.what)])));
  const line = (label, key, get, fmt = cpMoney) => el('tr', {}, [el('th', { scope: 'row' }, label),
    ...models.map((m, i) => el('td', { class: 'num' }, cpFig(key, fmt(get(m, cashes[i])), { 'data-cp-col': cols[i].id })))]);
  const t = el('table', { class: 'dt cp-table cp-sc-table' });
  t.append(el('caption', { class: 'sr-only' }, `The base case and ${cols.length - 1} scenario${cols.length === 2 ? '' : 's'}, side by side`));
  t.append(el('thead', {}, el('tr', {}, [el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Figure')),
    ...cols.map(c => el('th', { scope: 'col', class: 'num' }, c.name))])));
  t.append(el('tbody', {}, [
    line('Monthly instalment', 'instalment', m => m.instalment),
    line('Monthly position', 'cashflowMonthly', m => m.cashflowMonthly),
    line('Cash to complete', 'cashStillRequiredToComplete', (m, c) => c.complete),
    line('Safe cash required', 'safeCashRequired', (m, c) => c.safe),
    line('Net yield', 'netYield', m => m.netYield, v => (isNum(v) ? fmtPct(v, 2) : '—')),
    line('Break-even rent', 'breakEvenRent', m => m.breakEvenRent),
  ]));
  s.append(el('div', { class: 'tablewrap cp-tablewrap', tabindex: '0', role: 'region', 'aria-label': 'The scenarios side by side' }, t));
  if (models.some(m => (m.missingCostLines || []).length)) s.append(cpNote('Where a cost line could not be priced, the cash figures of that column are what is priced so far.', { warn: true }));
  s.append(cpNote('Each column is the same model run on that column’s inputs: the property as saved, with only what the scenario changes. Scenarios, not forecasts — and none is ranked above another.'));
  return s;
}

/* The sale at the end of the hold, as the model prices it (dealModel's own
   exit: exitAt for the holding period, and the rate of return of the whole
   hold). Nothing is assumed here that the model does not already assume.

   THE OWNER'S PAYWALL RULE (3 Oct 2026). The sale's costs, its net proceeds
   and the total profit are the full report's, as on the calculator (its
   exit table) and the Scenario Lab (LAB_PAID): shown only where the report
   is unlocked (propertyReportUnlocked, the calculator's own test). Until
   then the proposal prints the Lab's two free figures — in the Lab's own
   words (LAB_FIGURES), so the two pages cannot word them differently — and
   says where the rest is. From ee173ce to this change the table printed all
   ten rows to anyone, the net proceeds and the profit included. */
const CP_EXIT_LOCKED = 'In the full analysis — preview in the calculator; nothing is on sale';
function cpExitSection(d, m, paid = false) {
  const s = cpSection('exit', `If it is sold after ${cpPlural(d.holdYears, 'year')}`);
  /* A deduction carries its minus — except one that prints as nothing: a
     gains tax of nil read "−RM0", a sign on a zero. */
  const less = (key, v) => cpFig(key, !isNum(v) ? '—' : cpMoney(v) === 'RM0' ? 'RM0' : `−${cpMoney(v)}`, { 'data-cp-sign': '-' });
  const lets = m.letsToTenant;
  const rate = () => (isNum(m.irrPct) ? cpFig('irrPct', fmtPct(m.irrPct, 2)) : el('span', { class: 'cp-unpriced', 'data-cp': 'irrPct' }, 'No rate'));
  if (!paid) {
    const label = (key) => LAB_FIGURES.find(f => f.key === key).label(d);
    s.append(cpTable(`If it is sold after ${d.holdYears} years`, null, [
      cpRow(label('valueLessLoanAtExit'), isNum(m.valueLessLoanAtExit) ? cpFig('valueLessLoanAtExit', cpMoney(m.valueLessLoanAtExit))
        : el('span', { class: 'cp-unpriced', 'data-cp': 'valueLessLoanAtExit' }, 'Not computed — the loan has no schedule')),
      cpRow(label('irrPct'), rate()),
    ], { cls: 'cp-exit cp-exit-free' }));
    s.append(el('p', { class: 'cp-note cp-exit-locked', 'data-cp-locked': 'exit' }, CP_EXIT_LOCKED));
  } else s.append(cpTable(`If it is sold after ${d.holdYears} years`, null, [
    cpRow('Sale value', cpFig('exitValue', cpMoney(m.exitValue))),
    cpRow('Loan outstanding', less('outstanding', m.outstanding)),
    cpRow('Agent commission', less('agentFee', m.agentFee)),
    cpRow('Legal fees on the sale', less('exitLegal', m.exitLegal)),
    cpRow(`Carried while it sells — ${cpPlural(num0(d.sellMonths), 'month')}`, less('carryWhileSelling', m.carryWhileSelling)),
    cpRow(`Real property gains tax (${m.rpgtPct}%)`, less('rpgt', m.rpgt)),
    cpRow('Net proceeds', cpFig('netExitProceeds', cpMoney(m.netExitProceeds))),
    cpRow(!lets ? 'Cash to hold it over the hold — running costs and loan repayments' : m.taxComputed ? 'Rental cash over the hold, after tax on the rent' : 'Rental cash over the hold, before tax', cpFig('cumCash', cpMoney(m.cumCash))),
    cpRow('Total profit on the cash put in', cpFig('totalProfit', cpMoney(m.totalProfit))),
    cpRow('Rate of return over the hold', rate()),
  ], { cls: 'cp-exit' }));
  if (!isNum(m.irrPct) && m.irrWhy) s.append(cpNote(`No rate of return: ${m.irrWhy}`));
  const reno = num0(d.renovation) > 0 && num0(d.renoValueRecoveryPct) > 0
    ? `, with ${cpPct(num0(d.renoValueRecoveryPct))} of the renovation recovered in the price` : '';
  /* Whose the growth rate is, as the assumptions mark it: a rate nobody set
     for this property was credited to the preparer. */
  const growth = cpSeeded(d, 'apprecPct')
    ? `The ${cpPct(d.apprecPct)} a year of capital growth is the calculator’s Sample figure — nobody set it for this property — and it is not a forecast.`
    : 'Capital growth is the preparer’s assumption, not a forecast.';
  s.append(el('p', { class: 'cp-note' }, [`Sold at the price grown by ${cpPct(d.apprecPct)} a year${reno}, by ${rpgtCategory(d.disposerCategory).who}. The rate of return discounts each year’s cash to when it arrives, on `,
    cpFig('equityOut', cpMoney(m.equityOut)), ` put in at the start — the reserve included, which comes back at the sale. ${growth}`]));
  s.append(cpNote('The gains-tax rates are cited to Schedule 5 of the Real Property Gains Tax Act 1976 and have not been verified against the current schedule or any exemption order in force.', { warn: true }));
  return s;
}

function cpDisclosures(rec, d, m) {
  const s = cpSection('disclosures', 'What this proposal is, and is not');
  /* By the fee rulebook's provenance (70-property.js): estimates, and
     amounts resting on a rule unknown for the jurisdiction. */
  const placeholders = (m.unconfirmedLines || []).filter(x => x.provenance === 'estimated').length;
  const unverified = (m.unconfirmedLines || []).filter(x => x.provenance === 'unknown').length;
  const samples = cpSampleKeys(d, m).length;
  const ul = el('ul', { class: 'cp-points' });
  [
    'Research and illustration, not financial advice and not a recommendation to buy, sell, let or finance this property. It does not take account of anyone’s objectives, financial situation or needs; before acting, take advice from someone licensed to give it.',
    /* The duties and fees come from the registry's amounts and scales as
       well as from the inputs: a fixed RM1,200 of registration and searches
       is computed from no input listed. */
    'Every figure is computed by the model the Quantum Tradeworks property calculator runs: from the inputs listed under “The property and what it assumes”, and — for the duties and fees — from the amounts and scales of the fee registry this build carries, each fee line marked as it stands. None is a forecast, a quotation or an offer.',
    'Not a valuation. In Malaysia an official valuation must be carried out by a registered valuer, and nothing here is a price opinion.',
    placeholders || unverified
      ? `Fee lines are marked as they stand, by the fee rulebook ${FEE_TABLE.version} (checked ${feeDay(FEE_TABLE.checkedOn)}): ${placeholders ? `${placeholders} ${placeholders === 1 ? 'is an estimate' : 'are estimates'} — a commonly quoted approximation, not a quotation` : ''}${placeholders && unverified ? ', and ' : ''}${unverified ? `${unverified} ${unverified === 1 ? 'rests' : 'rest'} on a rule that could not be verified for this jurisdiction from an official source` : ''}. Duties and fees change without notice; confirm every one with the lender, the solicitor and the local authority.`
      : 'Duties and fees follow the fee registry this build carries, which changes without notice; confirm every one with the lender, the solicitor and the local authority.',
    samples
      ? `Sample marks ${samples === 1 ? 'an input' : `${samples} inputs`} still at the calculator’s illustrative starting value, chosen for no property and taken from no market.`
      : 'Every input here was entered or changed by the preparer; none is the calculator’s illustrative starting value.',
    cpSeeded(d, 'titleType')
      ? 'Title, tenure and eligibility have not been verified, and the title class is the calculator’s starting value, which nobody chose for this property. Confirm them with a property lawyer and the land office before relying on them.'
      : 'Title, tenure and eligibility are recorded from the preparer’s input and have not been verified. Confirm them with a property lawyer and the land office before relying on them.',
  ].forEach(x => ul.append(el('li', {}, x)));
  s.append(ul);
  s.append(el('p', { class: 'cp-stamp' }, `Prepared ${caseRaisedAt(new Date())} with Quantum Tradeworks (${MODEL_VERSION}), from the saved property “${rec.name}”, as saved ${cpWhen(pmUpdated(rec))}.`));
  return s;
}

function cpDocument(rec, details, forWhom, picks) {
  const d = pmInputsOf(rec), m = dealModel(d), cash = cpCash(m), paid = propertyReportUnlocked(d.projectId);
  const doc = el('article', { class: 'cp-doc', id: 'cp-doc', 'aria-label': 'Client proposal' });
  doc.append(cpHead(rec, d, details, forWhom));
  const where = pmPlace(d);
  doc.append(el('div', { class: 'cp-title' }, [
    el('p', { class: 'cp-eyebrow' }, 'Client proposal'),
    el('h1', {}, `${d.propertyType || 'Property'}${where !== '—' ? ` — ${where}` : ''}`),
    el('p', { class: 'cp-sub' }, `Research and illustration, not financial advice. From the saved property “${rec.name}”.`),
  ]));
  if (workIsSample(rec)) doc.append(el('p', { class: 'cp-note cp-warn cp-sample' },
    'Illustrative: every figure in this proposal comes from the calculator’s sample inputs, which nobody chose for any real property.'));
  doc.append(cpKeyFigures(d, m, cash));
  doc.append(cpPropertySection(rec, d, m));
  doc.append(cpAcquisitionSection(d, m, cash));
  doc.append(cpFinancingSection(d, m));
  doc.append(cpRentSection(d, m, paid));
  if (picks.length) doc.append(cpScenariosSection(rec, picks));
  doc.append(cpExitSection(d, m, paid));
  doc.append(cpDisclosures(rec, d, m));
  return doc;
}

/* ------------------------------------------------------------ the controls */
function cpRail(rec, details, forWhom, picks) {
  const rail = el('aside', { class: 'card cp-rail rail-sticky', 'aria-label': 'Set up the proposal' });
  rail.append(el('div', { class: 'cp-rail-hd' }, [
    el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
      el('p', { class: 'h-card', style: 'margin:0' }, 'Client proposal'),
      el('span', { class: 'chip chip-bronze' }, 'Preview'),
    ]),
    el('p', { class: 'caption' }, CP_PREVIEW),
    el('button', { type: 'button', class: 'btn btn-primary cp-print', id: 'cp-print', onclick: () => window.print() }, 'Print or save as PDF'),
    el('p', { class: 'metaline' }, 'Printing leaves this column out. The proposal prints on A4, in light colours whatever theme the screen uses.'),
  ]));
  const st = propertyStatus(State.deal);
  if (st.kind === 'model' && st.rec.id === rec.id && st.dirty) rail.append(el('p', { class: 'cp-rail-warn', role: 'note' }, [
    'The calculator holds changes to this property that are not saved. This proposal is the property as saved; ',
    el('a', { href: href('/property/calculator'), onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate('/property/calculator'); } }, 'save them on the calculator'),
    ' to include them.',
  ]));
  if (CP_REDRAWN[rec.id]) rail.append(el('p', { class: 'cp-rail-warn', role: 'status', id: 'cp-redrawn' },
    `Redrawn at ${CP_REDRAWN[rec.id].toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}: the property or your details were saved again in another tab, and the proposal now shows them as saved.`));

  const body = el('div', { class: 'cp-rail-body' });
  /* Prepared for — this visit only. */
  const pf = el('fieldset', { class: 'cp-fs' });
  pf.append(el('legend', {}, 'Prepared for'));
  const field = (id, label, input, note) => el('div', { class: 'field' }, [el('label', { for: id }, label), input, note ? el('p', { class: 'metaline' }, note) : null]);
  pf.append(field('cp-client', 'Client’s name', el('input', { class: 'input', id: 'cp-client', type: 'text', maxlength: '80', autocomplete: 'off', value: forWhom.client,
    onchange: e => { forWhom.client = e.target.value.trim().slice(0, 80); renderAfterTyping(); } })));
  pf.append(field('cp-date', 'Date', el('input', { class: 'input', id: 'cp-date', type: 'date', value: forWhom.date,
    onchange: e => { forWhom.date = /^\d{4}-\d\d-\d\d$/.test(e.target.value) ? e.target.value : localDay(); renderAfterTyping(); } })));
  pf.append(el('p', { class: 'metaline' }, 'Not stored: the client’s name is held by this tab until it is reloaded or closed, and prints on the proposal. Nothing about the client is written to this browser’s storage.'));
  body.append(pf);

  /* The scenarios, three at most. */
  const sf = el('fieldset', { class: 'cp-fs' });
  sf.append(el('legend', {}, 'Scenarios beside it — up to three'));
  const scs = rec.scenarios || [];
  const base = pmInputsOf(rec);
  if (!scs.length) {
    sf.append(el('p', { class: 'metaline' }, 'No scenario is saved for this property. On the calculator, change a figure — the rent, the rate, the deposit — and save it as a scenario to set it beside the property here.'));
  } else scs.forEach(sc => {
    const on = picks.includes(sc.id);
    sf.append(el('label', { class: 'checkline cp-pick', for: `cp-pick-${sc.id}` }, [
      el('input', { type: 'checkbox', id: `cp-pick-${sc.id}`, checked: on ? '' : null, onchange: e => {
        const now = CP_PICK[rec.id] || [];
        if (e.target.checked && now.length >= 3) { e.target.checked = false; toast('Three scenarios at most beside the property — clear one first'); return; }
        CP_PICK[rec.id] = e.target.checked ? [...now, sc.id] : now.filter(x => x !== sc.id);
        renderKeepFocus();
      } }),
      el('span', {}, [el('strong', {}, sc.name), el('span', { class: 'metaline cp-pick-what' }, cpChangeLine(sc.overrides, base) || 'Nothing the figures use')]),
    ]));
  });
  body.append(sf);

  /* Your details for proposals — kept in this browser. The fields sit in a
     box of their own: a <details> lays its content out in one internal
     box, so the gap set on it never reached them and each label touched
     the field above it. */
  const open = cpDetailsOpen ?? !cpHasDetails(details);
  const yd = el('details', { class: 'cp-fs cp-details', id: 'cp-details', open: open ? '' : null });
  yd.addEventListener('toggle', () => { cpDetailsOpen = yd.open; });
  yd.append(el('summary', {}, cpHasDetails(details)
    ? `Your details: ${[details.name, details.agency].filter(Boolean).join(', ') || details.contact || 'a logo'}`
    : 'Your details for proposals'));
  const inner = el('div', { class: 'cp-details-body' });
  const saveField = (k) => (e) => {
    const refused = store.failed;
    cpSaveDetails({ [k]: e.target.value.trim().slice(0, CP_TEXT[k]) });
    if (store.failed !== refused) toast(STORE_REFUSED);
    renderAfterTyping();
  };
  inner.append(field('cp-name', 'Your name', el('input', { class: 'input', id: 'cp-name', type: 'text', maxlength: String(CP_TEXT.name), autocomplete: 'name', value: details.name, onchange: saveField('name') })));
  inner.append(field('cp-agency', 'Agency or firm', el('input', { class: 'input', id: 'cp-agency', type: 'text', maxlength: String(CP_TEXT.agency), autocomplete: 'organization', value: details.agency, onchange: saveField('agency') })));
  inner.append(field('cp-contact', 'Contact', el('input', { class: 'input', id: 'cp-contact', type: 'text', maxlength: String(CP_TEXT.contact), autocomplete: 'off', placeholder: 'Phone, email or both', value: details.contact, onchange: saveField('contact') })));
  /* Behind a button, as Your data's restore is: the native file control
     cannot be styled, and reads as a browser artefact. */
  const fileIn = el('input', { type: 'file', id: 'cp-logo-file', accept: Object.keys(CP_LOGO_TYPES).join(','), style: 'display:none',
    onchange: async (e) => {
      const res = await cpReadLogo(e.target.files && e.target.files[0]);
      e.target.value = '';
      if (!res.ok) { toast(res.why); return; }
      const refused = store.failed;
      cpSaveDetails({ logo: res.url });
      toast(store.failed !== refused ? STORE_REFUSED : 'Logo added — it prints at the top of the proposal');
      renderKeepFocus(); focusAfterRedraw('#cp-logo-add');
    } });
  const logoRow = el('div', { class: 'cp-logo-row' });
  if (details.logo) logoRow.append(el('img', { class: 'cp-logo-thumb', src: details.logo, alt: 'Your logo, as it prints' }));
  logoRow.append(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'cp-logo-add', onclick: () => fileIn.click() }, details.logo || details.logoFault ? 'Replace the logo' : 'Add a logo'));
  if (details.logo || details.logoFault) logoRow.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'cp-logo-remove', onclick: () => {
    const refused = store.failed;
    cpSaveDetails({ logo: null });
    toast(store.failed !== refused ? STORE_REFUSED : 'Logo removed');
    render(); focusAfterRedraw('#cp-logo-add');
  } }, 'Remove the logo'));
  inner.append(el('div', { class: 'field' }, [el('span', { class: 'cp-fs-label' }, 'Logo'), logoRow, fileIn]));
  /* A logo kept here that this page cannot print — restored from a file,
     or kept by an earlier version — is named, not dropped without a word. */
  if (details.logoFault) inner.append(el('p', { class: 'cp-rail-warn', id: 'cp-logo-fault', role: 'note' },
    `The logo kept in this browser does not print: it ${details.logoFault}. Replace it or remove it.`));
  inner.append(el('p', { class: 'metaline' }, 'A PNG, JPEG or WebP image of at most 200 KB. Your name, agency, contact and logo are kept in this browser only — no server holds them. The export on Your data carries them, and clearing this browser’s storage removes them.'));
  /* Offered while the key holds anything at all, so whatever Your data
     lists can be removed here. */
  if (details.stored) inner.append(el('button', { type: 'button', class: 'btn btn-quiet btn-sm cp-details-remove', id: 'cp-details-remove', onclick: () => {
    if (!confirm('Remove your name, agency, contact and logo from this browser? An export or backup you saved from Your data keeps its own copy.')) return;
    const refused = store.failed;
    cpForgetDetails();
    cpDetailsOpen = true;
    toast(store.failed !== refused ? STORE_UNDELETED : 'Your details are removed from this browser');
    render(); focusAfterRedraw('#cp-name');
  } }, 'Remove my details'));
  yd.append(inner);
  body.append(yd);
  rail.append(body);

  const go = (path, label, id) => el('a', { class: 'btn btn-quiet btn-sm', id, href: href(path),
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
  rail.append(el('div', { class: 'cp-rail-links' }, [
    el('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'cp-open-calc', onclick: () => openPropertyModel(rec.id) }, 'Open it on the calculator'),
    go('/property/models', 'My properties', 'cp-models'),
  ]));
  return rail;
}

/* A proposal address whose property this browser does not hold. */
function cpMissing(wrap, id) {
  const any = pmAll().length;
  wrap.append(pageHead({ title: 'Client proposal', lede: 'A saved property, set out for a client to read.' }));
  const card = el('section', { class: 'card cp-missing', 'aria-labelledby': 'cp-missing-hd' });
  card.append(el('h2', { class: 'h-card', id: 'cp-missing-hd' }, id ? 'That property is not saved in this browser' : 'No property named'));
  card.append(el('p', { class: 'body' }, any
    ? 'A client proposal is made from a property saved in My properties. This one may have been deleted, or saved in another browser — nothing saved here leaves the browser it was saved in.'
    : 'A client proposal is made from a property saved in My properties, and none is saved in this browser yet. Model a property on the calculator and save it; its proposal is then a click away.'));
  card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [any
    ? el('a', { class: 'btn btn-primary', href: href('/property/models'), onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate('/property/models'); } }, 'Open My properties')
    : el('a', { class: 'btn btn-primary', href: href('/property/calculator'), onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate('/property/calculator'); } }, productById('property')?.action || 'Analyse a property')]));
  wrap.append(card);
  return wrap;
}

/* ------------------------------------------------ saved again elsewhere */
/* A PROPOSAL OPEN IN ITS OWN TAB IS THE PROPERTY AS SAVED NOW. The way in
   is a real link, so a proposal is often open in a tab of its own; the
   property was then saved again on the calculator in another, and this tab
   went on showing — and printing — the figures before the save, its stamp
   unchanged to the minute. Every other tab of this origin is told of a
   write (`storage`), and the proposal is drawn again when the property or
   the details it prints change; printing reads them again first, for a
   change no event announced. What the reader is typing in this tab stays:
   the client's name and date are taken as they stand, and a detail field
   part-typed is left alone — its own change event redraws from storage. */
const CP_REDRAWN = {};
let cpShown = null;
const cpSignature = (id) => `${pmCanon(pmFind(id))}|${pmCanon(store.read('proposalDetails', null))}`;
function cpRefresh(why) {
  if (State.view !== 'propertyProposal' || !cpShown) return false;
  const changed = cpSignature(cpShown.id) !== cpShown.sig;
  /* Printing always draws the page again: a client's name typed and then
     "Print" pressed is committed by its change event, whose redraw waits
     for a timer the print does not wait for. */
  if (!changed && why !== 'print') return false;
  const f = CP_FOR[cpShown.id];
  const c = document.getElementById('cp-client'), dt = document.getElementById('cp-date');
  if (f && c) f.client = c.value.trim().slice(0, 80);
  if (f && dt && /^\d{4}-\d\d-\d\d$/.test(dt.value)) f.date = dt.value;
  const a = document.activeElement;
  if (why === 'storage' && a?.matches?.('.cp-details input[type=text]') && a.value.trim() !== (cpDetails()[a.id.replace('cp-', '')] || '')) return false;
  if (changed) CP_REDRAWN[cpShown.id] = new Date();
  renderKeepFocus();
  if (changed && why === 'storage') toast('Saved again in another tab — the proposal now shows the property as saved');
  return changed;
}
window.addEventListener('storage', (e) => {
  if (e.storageArea && e.storageArea !== localStorage) return;
  if (e.key === null || e.key === STORE_PREFIX + 'savedWork' || e.key === STORE_PREFIX + 'proposalDetails') cpRefresh('storage');
});
window.addEventListener('beforeprint', () => { cpRefresh('print'); });

VIEWS.propertyProposal = () => {
  const route = matchRoute(location.pathname);
  let id = '';
  try { id = decodeURIComponent(route?.params?.property || ''); } catch { id = ''; }
  const rec = pmFind(id);
  cpShown = { id, sig: cpSignature(id) };
  const wrap = el('div', { class: 'cp-page' });
  if (!rec) return cpMissing(wrap, id);
  const details = cpDetails(), forWhom = cpFor(rec.id), picks = cpPicks(rec);
  wrap.append(el('div', { class: 'cp-layout' }, [cpRail(rec, details, forWhom, picks), cpDocument(rec, details, forWhom, picks)]));
  wrap.append(el('div', { class: 'cp-foot cp-screen-only' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', id: 'cp-print-foot', onclick: () => window.print() }, 'Print or save as PDF'),
    el('span', { class: 'metaline' }, CP_PREVIEW),
  ]));
  /* The title is the file name a browser offers for the PDF, so it names the
     property. Never the client: a browser writes every title it is shown
     into its history, and a client's name is the one thing this page
     promises not to keep. */
  document.title = `Client proposal — ${rec.name} · Quantum Tradeworks`;
  return wrap;
};
