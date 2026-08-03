#!/usr/bin/env node
/**
 * Watchlist screenshot → reviewed price candidates.  PERSONAL RESEARCH ONLY.
 *
 *   node ingest/watchlist.mjs --clipboard      after Win+Shift+S
 *   node ingest/watchlist.mjs                 newest image in watchlist-shots/
 *   node ingest/watchlist.mjs --in shot.png   an explicit path
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPE
 *   Reads pixels you are entitled to look at, under your own subscription, for
 *   your own research. It confers no right to redistribute what it recognises.
 *   It therefore refuses to write data/prices.json, which is the file the app
 *   serves from — see the guard at the bottom.
 *
 * WHY THERE IS A REVIEW STEP AND NOT A DIRECT WRITE
 *   OCR misreads digits. On the very first test run against a real screenshot,
 *   Windows OCR returned "814.30" for a price of 214.30 — a single character,
 *   a 280% error, and nothing about the output looked wrong.
 *
 *   A wrong price does not surface as an error downstream. It produces a
 *   confident, fully-decomposed, source-linked valuation built on a bad number,
 *   which is the exact failure this product exists to avoid. So OCR proposes
 *   and you dispose: every candidate is checked against the last known close
 *   and anything implausible is held back for you to look at.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve, join } from 'node:path';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };

const baseline  = flag('baseline', 'data/personal-prices.json');
const outPath   = flag('out', 'data/watchlist-review.csv');
const moveLimit = Number(flag('max-move', 15));      /* % day move that needs a human */
const DROP      = 'watchlist-shots';                 /* where screenshots live */

/* Three ways to point at an image, so "where do I put the file?" has an answer
   at every level of effort: name it, drop it in a folder, or just snip it. */
const IMG = /\.(png|jpg|jpeg|bmp)$/i;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function newestInDrop() {
  let names;
  try { names = (await readdir(DROP)).filter(n => IMG.test(n)); }
  catch { return null; }
  if (!names.length) return null;
  const withTime = await Promise.all(names.map(async n => {
    const p = join(DROP, n);
    return { p, t: (await stat(p)).mtimeMs };
  }));
  return withTime.sort((a, b) => b.t - a.t)[0].p;
}

async function fromClipboard() {
  await mkdir(DROP, { recursive: true });
  const out = join(DROP, `clip-${stamp()}.png`);
  /* Surface the reason, not a Node stack trace. clip.ps1 reports its own cause
     on an ERR: line so nothing here has to parse PowerShell error formatting. */
  let stdout = '';
  try { ({ stdout } = await run('powershell', ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass',
    '-File', resolve('ingest/clip.ps1'), '-Out', resolve(out)])); }
  catch (e) { stdout = String(e.stdout || ''); }

  const err = stdout.split('\n').map(s => s.trim()).find(s => s.startsWith('ERR:'));
  if (err || !stdout.trim()) {
    console.error(`Could not take the image from the clipboard: ${err ? err.slice(4).trim() : 'the capture returned nothing'}.`);
    console.error(`\nTake a snip with Win+Shift+S — drag a box over your watchlist — then run this again.`);
    console.error(`Or save the image into ${DROP}/ and run without --clipboard.`);
    process.exit(1);
  }
  return out;
}

/* A scrolled list arrives as several overlapping screenfuls, so a whole folder
   is a valid input. Sorted by name, because autoshot numbers them in order. */
async function allInDir(dir) {
  const names = (await readdir(dir)).filter(n => IMG.test(n)).sort();
  if (!names.length) throw new Error(`no images in ${dir}`);
  return names.map(n => join(dir, n));
}

let inPath = flag('in', null);
let picked = 'named on the command line';
const dirArg = flag('dir', null);
if (!inPath && dirArg) { inPath = await allInDir(dirArg); picked = `${inPath.length} page(s) from ${dirArg}`; }
if (!inPath && has('clipboard')) { inPath = await fromClipboard(); picked = 'clipboard'; }
if (!inPath) { inPath = await newestInDrop(); if (inPath) picked = `newest image in ${DROP}/`; }

if (!inPath) {
  await mkdir(DROP, { recursive: true });
  console.error(`No screenshot found. There is nothing to upload anywhere — this reads a file on this PC.

Pick whichever is least effort:

  1. Snip it and go              Win+Shift+S, drag over your watchlist, then
                                 node ingest/watchlist.mjs --clipboard

  2. Drop the file in a folder   save or drag the image into
                                 ${resolve(DROP)}
                                 then just: node ingest/watchlist.mjs

  3. Name it yourself            node ingest/watchlist.mjs --in "C:\\path\\to\\shot.png"

The folder in (2) has been created for you. It is git-ignored, so nothing you
put there is committed or published.`);
  process.exit(1);
}

/* The guard, made real rather than asserted. data/prices.json is the file the
   app serves from; OCR output is licensed for your eyes only, so this refuses
   to aim at it however the flags are set. */
const SERVED = 'data/prices.json';
const aimsAtServed = (p) => resolve(p) === resolve(SERVED);
for (const [name, value] of [['out', outPath], ['baseline', baseline]]) {
  if (aimsAtServed(value)) {
    console.error(`refusing: --${name} points at ${SERVED}, which is the file the app serves.`);
    console.error(`OCR output is for your own research and carries no right to redistribute.`);
    console.error(`Use a separate file, e.g. --${name} data/personal-prices.json`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------- OCR */
async function ocrWords(imagePath) {
  const script = resolve('ingest/ocr.ps1');
  const { stdout } = await run('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Path', resolve(imagePath), '-Lines',
  ], { maxBuffer: 1024 * 1024 * 32 });
  /* Row icons come back as raw control characters that ConvertTo-Json emits
     unescaped, which makes the whole payload invalid. The compressed JSON
     contains no legitimate control characters, so stripping them here is safe
     — and one bullet glyph must not be able to kill an entire run. */
  const CTRL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\uE000-\\uF8FF\\uFFFD]', 'g');
  const clean = stdout.replace(CTRL, '').trim();
  const parsed = JSON.parse(clean || '[]');
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter(w => w && String(w.text || '').trim());
}

/* --------------------------------------------------------------- parsing */
/* A watchlist is a table, so the symbol and its price share a row. The OCR
   engine emits column by column, not row by row, so rows are rebuilt from
   vertical position. Tolerance scales with glyph height rather than assuming
   a zoom level. */
function groupRows(words) {
  const rows = [];
  for (const w of [...words].sort((a, b) => a.top - b.top)) {
    const tol = Math.max(6, (w.h || 14) * 0.6);
    const row = rows.find(r => Math.abs(r.top - w.top) <= tol);
    if (row) { row.parts.push(w); row.top = (row.top * row.parts.length + w.top) / (row.parts.length + 1); }
    else rows.push({ top: w.top, parts: [w] });
  }
  for (const r of rows) r.parts.sort((a, b) => a.left - b.left);
  return rows;
}

/* One number can arrive as several words: "4,643" comes back as "4," + "643".
   Joining by gap rather than by guessing keeps a thousands separator together
   without also welding two genuinely separate columns into one number. */
function weldNumbers(parts) {
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    let suspect = false;
    if (prev && prev.w != null && p.w != null) {
      /* The wider of the two estimates. A lone "1" is a narrow glyph, so
         measuring the font by it alone underestimates the character width and
         refuses a join that should happen — which is how "115.00", split by
         OCR into "1" and "15.00", became 15.00. */
      const charW = Math.max(prev.w / Math.max(1, prev.text.length),
                             p.w / Math.max(1, p.text.length));
      const gap = p.left - (prev.left + prev.w);
      const numeric = /[\d.,]$/.test(prev.text) && /^[\d.,]/.test(p.text);
      if (numeric && gap < charW * 0.5) {
        prev.text += p.text;
        prev.w = (p.left + p.w) - prev.left;
        prev.welded = true;
        continue;
      }
      /* Close enough to belong together, too far to join safely. This is what a
         dropped decimal point looks like — "62,847" "3" for 62,847.3. Welding
         would invent 62,8473, so record the doubt and let the review gate raise
         it rather than silently shipping the truncated number. */
      /* Marked on BOTH: the price finally selected is whichever token lands in
         the price column, and flagging only the left one let the doubt go
         unreported when the right one was chosen. Recorded on the copies, never
         on the caller's row objects — weldNumbers runs twice over the same rows
         and must not leave state behind between passes. */
      if (numeric && gap < charW * 2) { prev.suspectSplit = true; suspect = true; }
    }
    out.push({ ...p, suspectSplit: suspect });
  }
  return out;
}

/* Strict on purpose. A malformed join such as "62,8473" — which is what a lost
   decimal point looks like — fails this and gets flagged rather than silently
   becoming a price. */
const NUMBER = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

/* OCR returns "113.oo" for 113.00 often enough to matter. In a numeric field
   there is no legitimate o, l or I, so mapping them back is deterministic
   rather than a guess — and the result still has to satisfy NUMBER above and
   the day-move check below. Repairing beats dropping the row: a silently
   missing instrument is harder to notice than a flagged one.

   Applied ONLY to tokens that are already numeric apart from these glyphs, so
   a ticker is never touched. */
const NUMLIKE = /^[-+]?[\d.,oOlI|]+$/;
const numText = (t) => (NUMLIKE.test(t) && /\d/.test(t))
  ? t.replace(/[oO]/g, '0').replace(/[lI|]/g, '1')
  : t;

/* OCR confuses a small, fixed set of glyph pairs. Folding both sides onto one
   representative lets "USIOO" match "US100" and "uszooo" match "US2000"
   without inventing a fuzzy edit distance that would also match the wrong
   ticker. */
const fold = (s) => s.toUpperCase()
  .replace(/[OQ]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5')
  .replace(/Z/g, '2').replace(/B/g, '8').replace(/G/g, '6');

/* Leading icon debris and the trailing status dot both attach to the symbol. */
const cleanSymbol = (t) => t.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9!]+$/, '').toUpperCase();

/* Anything that could plausibly be an instrument: equities, FX pairs, futures
   with a continuation suffix, index codes, and Bursa's four-digit numbers. */
const SYMBOLISH = /^(?:[A-Z][A-Z0-9]{0,9}!?|\d{4}[A-Z]{0,2})$/;

/* The price lives in a COLUMN, not simply to the right of the symbol. A
   description containing a digit — "Test Instrument 2", "S&P 500", "3M" —
   otherwise wins the race and becomes the price, which is silently catastrophic:
   102.00 read as 2 looks like a number, not like an error.

   Price columns are right-aligned, so they share a right edge to within a few
   pixels. A number sitting inside prose does not. Clustering the right edges
   across every row therefore finds the real column, and the leftmost
   well-populated cluster is Last (change and percent sit to its right). */
/* A number that begins a column is separated from what precedes it by a gutter.
   A number inside prose — the "2" of "Test Instrument 2" — is one word-space
   away. A space runs well under one character width; a gutter runs to several.
   This is what stops a description from being read as a price. */
function startsColumn(parts, i) {
  if (i === 0) return true;
  const prev = parts[i - 1];
  if (prev.w == null || parts[i].w == null) return true;   /* no geometry: do not exclude */
  const charW = prev.w / Math.max(1, prev.text.length);
  return (parts[i].left - (prev.left + prev.w)) > charW * 1.5;
}

function priceColumn(allRows) {
  const edges = [];
  for (const row of allRows) {
    const parts = weldNumbers(row.parts);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.w == null || p.text.includes('%')) continue;
      const t = numText(p.text).replace(/^\+/, '');
      if (!/\d/.test(t) || !NUMBER.test(t)) continue;
      if (!startsColumn(parts, i)) continue;               /* prose, not a column */
      edges.push({ right: p.left + p.w, row });
    }
  }
  if (edges.length < 4) return null;

  const clusters = [];
  for (const e of edges.sort((a, b) => a.right - b.right)) {
    const c = clusters[clusters.length - 1];
    if (c && e.right - c.mean <= 14) {
      c.items.push(e);
      c.mean = c.items.reduce((s, i) => s + i.right, 0) / c.items.length;
    } else clusters.push({ mean: e.right, items: [e] });
  }

  /* Coverage is counted in distinct rows: a cluster fed by many numbers from a
     handful of rows is prose, not a column. */
  for (const c of clusters) c.rows = new Set(c.items.map(i => i.row)).size;
  const enough = clusters.filter(c => c.rows >= Math.max(3, allRows.length * 0.4));
  if (!enough.length) return null;
  return enough[0];                                   /* leftmost qualifying */
}

function extractCandidates(rows, known) {
  const col = priceColumn(rows);
  const foldedKnown = new Map();
  for (const k of known) {
    const f = fold(k);
    /* An ambiguous fold would silently rename one instrument to another, so
       drop both rather than pick. */
    foldedKnown.set(f, foldedKnown.has(f) ? null : k);
  }

  const out = [], skipped = [];
  for (const row of rows) {
    const parts = weldNumbers(row.parts);
    const text = parts.map(p => p.text).join(' ');

    /* Every row carries an instrument icon, and OCR reads those as stray
       letters — "O" beside SPY, "a" beside NVDA. Taking the first symbol-shaped
       token therefore picks the debris.

       Leftmost wins, NOT longest: a watchlist that shows descriptions would
       otherwise yield "MICROSOFT" in preference to "MSFT". Single characters
       are dropped first, which is what removes the icon debris, and a declared
       symbol outranks both. */
    const cands = [];
    for (let i = 0; i < parts.length; i++) {
      /* An icon fused to the ticker arrives as one word — "K@VTI". Try the
         whole token first, then each alphanumeric run inside it, so the ticker
         is still recoverable when the icon did not separate cleanly. */
      const raw = parts[i].text;
      for (const frag of [raw, ...raw.split(/[^A-Za-z0-9!]+/)]) {
        const c = cleanSymbol(frag);
        if (!c || !SYMBOLISH.test(c)) continue;
        /* A pure-digit token is a Bursa code at the head of the row and a price
           anywhere else. Requiring a further number to its right keeps "1155
           Malayan Banking 10.84" working without letting a bare price become a
           ticker. */
        if (!/[A-Z]/.test(c)) {
          if (i !== 0 || !/^\d{4}$/.test(c)) continue;
          if (!parts.slice(1).some(p => NUMBER.test(p.text.replace(/^\+/, '')))) continue;
        }
        cands.push({ i, c, snapped: foldedKnown.get(fold(c)) });
      }
    }
    const named = cands.filter(x => x.snapped);
    const multi = cands.filter(x => x.c.length >= 2);
    const pool = named.length ? named : (multi.length ? multi : cands);
    const hit = pool[0];                                     /* leftmost of the best class */

    if (!hit) { if (parts.some(p => NUMBER.test(p.text))) skipped.push({ why: 'no symbol recognised', text }); continue; }
    const si = hit.i, symbol = hit.snapped || hit.c;

    /* The first number to the right of the symbol is the last price. The change
       columns sit further right, so first-wins is the correct rule. */
    let close = null, ambiguous = false, split = false;
    for (let i = si + 1; i < parts.length; i++) {
      const t = parts[i].text;
      if (t.includes('%')) continue;
      if (!/\d/.test(t)) continue;
      /* When a price column was identified, only a token whose right edge sits
         in it can be the price. Without one — a single cropped row, an unusual
         layout — fall back to first-number-wins. */
      if (col) {
        if (parts[i].w == null) continue;
        if (Math.abs((parts[i].left + parts[i].w) - col.mean) > 14) continue;
      } else if (!startsColumn(parts, i)) continue;        /* no column found: at least reject prose */
      const rt = numText(t);
      if (!NUMBER.test(rt.replace(/^\+/, ''))) { ambiguous = true; break; }
      const v = Number(rt.replace(/[,+]/g, ''));
      if (!Number.isFinite(v) || v <= 0) continue;
      close = v;
      split = !!parts[i].suspectSplit;
      break;
    }
    if (close == null) {
      skipped.push({ why: ambiguous ? 'the price did not parse cleanly' : 'no price found on the row', text, symbol });
      continue;
    }
    out.push({ symbol, close, line: text, split,
               unknown: known.length > 0 && !foldedKnown.has(fold(symbol)) });
  }

  /* Overlapping pages repeat rows, so the same symbol legitimately appears more
     than once. Identical readings collapse silently; two different prices for
     one symbol mean at least one page was misread, and that is worth stopping
     for rather than letting first-wins pick arbitrarily. */
  const bySymbol = new Map();
  for (const c of out) {
    const prev = bySymbol.get(c.symbol);
    if (!prev) { bySymbol.set(c.symbol, c); continue; }
    if (prev.close !== c.close) { prev.conflict = `read as both ${prev.close} and ${c.close} across pages`; }
  }
  return { candidates: [...bySymbol.values()], skipped };
}

/* ---------------------------------------------------------------- review */
/* One image or a scrolled sequence — the rest of the pipeline does not care.
   Rows from every page are pooled before extraction so a row split across the
   boundary of two screenfuls is still resolvable from whichever page shows it
   whole. */
const images = Array.isArray(inPath) ? inPath : [inPath];
const rows = [];
for (const img of images) rows.push(...groupRows(await ocrWords(img)));
const words = { length: rows.reduce((n, r) => n + r.parts.length, 0) };

/* A list of the symbols you actually track is the single most effective fix
   for OCR error. Snapping "USIOO" onto a known "US100" is reliable; guessing
   it from the glyphs alone is not. */
const SYMBOL_FILE = flag('symbols', 'watchlist-symbols.txt');
let known = [];
try {
  known = (await readFile(SYMBOL_FILE, 'utf8')).split(/\r?\n/)
    .map(s => s.replace(/#.*$/, '').trim()).filter(Boolean);
} catch { /* optional */ }

/* The instrument registry is the other place a symbol is already written down.
   Reading it too means adding an index to what you track is one edit rather
   than two, and every alias a vendor might use is recognised without anyone
   having to remember them. */
const REGISTRY = flag('registry', 'data/instruments.json');
let fromRegistry = 0;
try {
  const reg = JSON.parse(await readFile(REGISTRY, 'utf8'));
  const extra = [];
  for (const i of (reg.instruments || [])) {
    extra.push(i.symbol, ...(i.aliases || []));
  }
  const before = new Set(known.map(s => s.toUpperCase()));
  for (const s of extra) {
    if (s && !before.has(s.toUpperCase())) { known.push(s); before.add(s.toUpperCase()); fromRegistry++; }
  }
} catch { /* optional */ }

const { candidates, skipped } = extractCandidates(rows, known);

let prev = {};
try { prev = JSON.parse(await readFile(baseline, 'utf8')).prices || {}; } catch { /* first run */ }

const today = new Date().toISOString().slice(0, 10);
const reviewed = candidates.map(c => {
  const last = prev[c.symbol]?.close;
  const move = (last != null && last > 0) ? ((c.close - last) / last) * 100 : null;
  let verdict = 'accept', why = '';
  if (c.conflict) { verdict = 'CHECK'; why = c.conflict; }
  else if (c.split) { verdict = 'CHECK'; why = 'a digit group sits just past the price — a decimal point may have been dropped'; }
  else if (c.unknown) { verdict = 'CHECK'; why = `${c.symbol} is not in ${SYMBOL_FILE} — the symbol may be misread`; }
  else if (move == null) { verdict = 'confirm'; why = 'no previous close to check against'; }
  else if (Math.abs(move) > moveLimit) { verdict = 'CHECK'; why = `implies ${move > 0 ? '+' : ''}${move.toFixed(1)}% in a day — likely a misread digit`; }
  return { ...c, prev: last ?? null, movePct: move == null ? null : +move.toFixed(2), verdict, why };
});

const flagged = reviewed.filter(r => r.verdict === 'CHECK');

await mkdir(dirname(outPath), { recursive: true });
/* prices.mjs splits on commas by column index, so the free-text columns are
   kept last AND stripped of commas — a company name with one in it would
   otherwise shift every column to its right. */
const flat = (s) => `"${String(s || '').replace(/[",]/g, ' ').trim()}"`;
const header = 'symbol,date,close,prev,move_pct,verdict,why,ocr_line';
const csv = [header, ...reviewed.map(r => [
  r.symbol, today, r.close, r.prev ?? '', r.movePct ?? '', r.verdict,
  flat(r.why), flat(r.line.slice(0, 120)),
].join(','))].join('\n');
await writeFile(outPath, csv + '\n');

/* The raw text goes alongside it, because when the parser misses a row the
   only way to fix it is to see what OCR actually saw. */
await writeFile(outPath.replace(/\.csv$/, '.txt'),
  rows.map(r => r.parts.map(p => p.text).join(' ')).join('\n') + '\n');

console.log(`image     ${picked}`);
console.log(`read      ${words.length} words`);
console.log(`rows      ${rows.length}`);
console.log(`symbols   ${known.length
  ? `${known.length} known${fromRegistry ? ` (${known.length - fromRegistry} from ${SYMBOL_FILE}, ${fromRegistry} from ${REGISTRY})` : ` from ${SYMBOL_FILE}`}`
  : `none declared — symbols taken from OCR as-is`}`);
console.log(`candidates ${reviewed.length}`);
console.log(`flagged   ${flagged.length}`);
for (const f of flagged) console.log(`          ${f.symbol}: ${f.why}`);
/* Rows the parser could not use are named, never dropped in silence — a
   missing instrument is indistinguishable from one that never existed. */
if (skipped.length) {
  console.log(`skipped   ${skipped.length} row(s) with a number but no usable pair:`);
  for (const s of skipped) console.log(`          ${s.why}: ${s.text.slice(0, 78)}`);
  console.log(`          (a row whose symbol OCR did not read at all cannot be recovered —`);
  console.log(`           add it by hand to ${outPath} if you need it)`);
}
console.log(`\nwrote ${outPath}`);
console.log(`      ${outPath.replace(/\.csv$/, '.txt')}  (raw OCR, for when a row is missed)`);
console.log(`\nReview the CSV, correct anything marked CHECK or confirm, then:`);
console.log(`  node ingest/prices.mjs --in ${outPath} --out ${baseline} --licence "personal research — not for redistribution"`);
console.log(`\nThis writes ${baseline}, not data/prices.json. OCR output is for your own`);
console.log(`research; it carries no right to serve those prices to anyone else.`);
