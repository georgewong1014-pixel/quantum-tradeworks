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

let inPath = flag('in', null);
let picked = 'named on the command line';
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
  const parsed = JSON.parse(stdout.trim() || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

/* --------------------------------------------------------------- parsing */
/* A watchlist is a table, so the symbol and its price share a row. Group words
   by vertical overlap rather than a fixed pixel gap, so the tolerance scales
   with the font size instead of assuming a zoom level. */
function groupRows(words) {
  const rows = [];
  for (const w of [...words].sort((a, b) => a.top - b.top)) {
    const tol = Math.max(6, (w.h || 14) * 0.6);
    const row = rows.find(r => Math.abs(r.top - w.top) <= tol);
    if (row) { row.parts.push(w); row.top = (row.top * (row.parts.length - 1) + w.top) / row.parts.length; }
    else rows.push({ top: w.top, parts: [w] });
  }
  return rows.map(r => r.parts.sort((a, b) => a.left - b.left).map(p => p.text).join(' '));
}

const SYMBOL = /^(?:[A-Z]{1,6}|\d{4}[A-Z]{0,2})$/;    /* US tickers and Bursa codes */
const NUMBER = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

function extractCandidates(rowText) {
  const out = [];
  for (const line of rowText) {
    const tokens = line.split(/\s+/).filter(Boolean);
    const si = tokens.findIndex(t => SYMBOL.test(t));
    if (si === -1) continue;
    /* The first plausible number to the right of the symbol is the last price.
       Percentages and signed change columns are skipped. */
    for (let i = si + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.includes('%') || t.startsWith('+')) continue;
      if (!NUMBER.test(t)) continue;
      const v = Number(t.replace(/,/g, ''));
      if (!Number.isFinite(v) || v <= 0) continue;
      out.push({ symbol: tokens[si], close: v, line });
      break;
    }
  }
  /* One row per symbol: the first occurrence wins. */
  const seen = new Set();
  return out.filter(c => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)));
}

/* ---------------------------------------------------------------- review */
const words = await ocrWords(inPath);
const rows = groupRows(words);
const candidates = extractCandidates(rows);

let prev = {};
try { prev = JSON.parse(await readFile(baseline, 'utf8')).prices || {}; } catch { /* first run */ }

const today = new Date().toISOString().slice(0, 10);
const reviewed = candidates.map(c => {
  const last = prev[c.symbol]?.close;
  const move = (last != null && last > 0) ? ((c.close - last) / last) * 100 : null;
  let verdict = 'accept', why = '';
  if (move == null) { verdict = 'confirm'; why = 'no previous close to check against'; }
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
await writeFile(outPath.replace(/\.csv$/, '.txt'), rows.join('\n') + '\n');

console.log(`image     ${inPath}  (${picked})`);
console.log(`read      ${words.length} words`);
console.log(`rows      ${rows.length}`);
console.log(`candidates ${reviewed.length}`);
console.log(`flagged   ${flagged.length}${flagged.length ? ' — ' + flagged.map(f => `${f.symbol} (${f.why})`).join('; ') : ''}`);
console.log(`\nwrote ${outPath}`);
console.log(`      ${outPath.replace(/\.csv$/, '.txt')}  (raw OCR, for when a row is missed)`);
console.log(`\nReview the CSV, correct anything marked CHECK or confirm, then:`);
console.log(`  node ingest/prices.mjs --in ${outPath} --out ${baseline} --licence "personal research — not for redistribution"`);
console.log(`\nThis writes ${baseline}, not data/prices.json. OCR output is for your own`);
console.log(`research; it carries no right to serve those prices to anyone else.`);
