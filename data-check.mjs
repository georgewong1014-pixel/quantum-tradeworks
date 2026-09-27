#!/usr/bin/env node
/**
 * The shipped SEC dataset, checked offline against the rules the ingest now
 * enforces.
 *
 *   node data-check.mjs                   data/us.json
 *   node data-check.mjs path/to/file.json another file of the same shape
 *   node data-check.mjs --verbose         every warning, company by company
 *
 * WHY A CHECK OVER THE FILE AND NOT ONLY OVER THE RULES
 *
 * ingest-test proves the rules on fixtures. Nothing ever looked at the file
 * that ships: every plausibility check lived in the browser, so data/us.json
 * could carry a share count of nought, a dividend in the wrong unit or a
 * completeness figure that disagrees with its own cells, and a reader of the
 * file outside the app would see clean-looking numbers. This runs the
 * ingest's own validateCompany over every record — the rule the ingest
 * enforces and the rule CI checks are one function — plus the checks that
 * only make sense across a whole file: duplicate tickers, the header, the
 * failures the file admits to.
 *
 * It also lists the cells the page's loader withholds (withholdMisassembled
 * in src/js/25-universe.js), by running that exact function rather than a
 * copy of its rules, so the list here and the cells the page empties cannot
 * disagree.
 *
 * THE FILE CANNOT BE REGENERATED HERE (the SEC requires a contact address
 * this build has not been given), so what it already breaks is recorded
 * rather than patched — KNOWN below. A finding not in KNOWN fails the check;
 * a KNOWN finding that no longer occurs fails it too, so the list is removed
 * when a regeneration fixes it rather than left to rot.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompany, INGEST_VERSION } from './ingest/sec.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const FILE = args.find(a => !a.startsWith('--')) || join(ROOT, 'data', 'us.json');

/* Hard findings in the shipped file, each with why it is there and what
   happens to it on the page. `${ticker}:${rule}`. */
const KNOWN = {
  'EMR:unit': 'Emerson\'s dividend per share was filed under unit "pure". The corrected ingest refuses it; the shipped file predates that, and the page computes payout and yield from it as USD/share.',
  'CI:shares-positive': 'Cigna\'s FY2016 and FY2017 share counts were tagged as nought. The corrected ingest stores no count; the engine already reads a non-positive count as absent.',
};

let failures = 0, passes = 0;
const fail = (msg, detail) => { failures++; console.error(`FAIL  ${msg}`); if (detail !== undefined) console.error(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
const ok = (msg) => { passes++; console.log(`ok    ${msg}`); };
const note = (msg) => console.log(`      ${msg}`);

let data;
try { data = JSON.parse(readFileSync(FILE, 'utf8')); }
catch (e) { console.error(`FAIL  ${FILE} does not parse: ${e.message}`); process.exit(1); }

/* ---------------------------------------------------------------- header */
{
  const p = [];
  if (!Array.isArray(data.results)) p.push('results is not an array');
  if (!Array.isArray(data.failures)) p.push('failures is not an array');
  if (typeof data.generated !== 'string' || Number.isNaN(Date.parse(data.generated))) p.push(`generated is ${JSON.stringify(data.generated)}`);
  if (p.length) { fail('the file header', p); process.exit(1); }
  ok(`${data.results.length} companies, generated ${data.generated.slice(0, 10)}, ${data.failures.length} failure(s) recorded in the file`);
  if (data.failures.length) data.failures.forEach(f => note(`recorded failure: ${f.ticker} — ${f.error}`));
  note(`ingest version: ${data.ingestVersion || 'not recorded — the file predates versioning'}; the current ingest is ${INGEST_VERSION}`);
}

/* ------------------------------------------------------------ duplicates */
{
  const ids = data.results.map(r => r?.id);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length) fail('duplicate tickers — the loader keeps the first and drops the rest silently', dup);
  else ok('no ticker appears twice');
}

/* -------------------------------------------------- the ingest's own rules */
const found = {};                      /* `${id}:${rule}` -> detail */
const warned = {};                     /* rule -> [id: detail] */
{
  for (const r of data.results) {
    const v = validateCompany(r);
    for (const e of v.errors) found[`${r?.id}:${e.rule}`] = e.detail;
    for (const w of v.warnings) (warned[w.rule] = warned[w.rule] || []).push(`${r?.id}: ${w.detail}`);
  }
  const unexpected = Object.entries(found).filter(([k]) => !KNOWN[k]);
  const stale = Object.keys(KNOWN).filter(k => !found[k]);
  if (unexpected.length) fail(`${unexpected.length} record(s) break a hard rule the shipped file is not known to break`, unexpected.map(([k, d]) => `${k} — ${d}`));
  else ok(`every record has its years and rows in agreement, ten columns, finite values, expected units, provenance inside its window, USD, and a completeness equal to its own cells${Object.keys(found).length ? ` — apart from ${Object.keys(found).length} known finding(s):` : ''}`);
  for (const [k, d] of Object.entries(found).filter(([k]) => KNOWN[k])) note(`known  ${k.padEnd(22)} ${d}\n             ${KNOWN[k]}`);
  if (stale.length) fail('a known finding no longer occurs — the file changed; remove it from KNOWN in data-check.mjs', stale);

  const order = ['ebit-exceeds-revenue', 'equity-sign-flip', 'capex-negative', 'restated', 'provenance-line'];
  const rules = Object.keys(warned).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (rules.length) {
    console.log(`\nsuspect — printed, not failed (the page withholds or flags these at render time):`);
    for (const rule of rules) {
      console.log(`  ${rule.padEnd(22)} ${warned[rule].length} compan${warned[rule].length === 1 ? 'y' : 'ies'}`);
      for (const x of VERBOSE ? warned[rule] : warned[rule].slice(0, 6)) console.log(`      ${x}`);
      if (!VERBOSE && warned[rule].length > 6) console.log(`      … and ${warned[rule].length - 6} more (--verbose)`);
    }
    console.log('');
  }
}

/* ---------------------------------------- what the page's loader withholds */
/* The function itself, lifted out of the page source and run here. F is the
   engine's tuple map, lifted the same way. */
{
  const uni = readFileSync(join(ROOT, 'src', 'js', '25-universe.js'), 'utf8');
  const der = readFileSync(join(ROOT, 'src', 'js', '15-derivation.js'), 'utf8');
  const fLine = der.match(/^const F = \{[^}]*\};/m);
  const start = uni.indexOf('function withholdMisassembled(');
  let withhold = null;
  if (fLine && start >= 0) {
    let depth = 0, i = uni.indexOf('{', start), end = -1;
    for (; i < uni.length; i++) { if (uni[i] === '{') depth++; else if (uni[i] === '}' && --depth === 0) { end = i + 1; break; } }
    if (end > 0) withhold = new Function(`${fLine[0]}\n${uni.slice(start, end)}\nreturn withholdMisassembled;`)();
  }
  if (!withhold) fail('withholdMisassembled could not be read out of src/js/25-universe.js — renamed or moved?');
  else {
    const rows = [];
    for (const r of data.results) {
      const fin = r.fin.map(row => row.slice());
      const w = withhold(r, fin);
      for (const [line, x] of Object.entries(w)) rows.push({ id: r.id, line, years: x.years, why: x.why });
    }
    const byLine = rows.reduce((a, x) => ((a[x.line] = (a[x.line] || 0) + x.years.length), a), {});
    ok(`the loader withholds ${rows.reduce((n, x) => n + x.years.length, 0)} misassembled cell(s) across ${new Set(rows.map(x => x.id)).size} companies — ${Object.entries(byLine).map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}`);
    for (const x of VERBOSE ? rows : rows.slice(0, 8)) note(`${x.id.padEnd(6)} ${x.line.padEnd(5)} FY${x.years.join(', FY')} — ${x.why}`);
    if (!VERBOSE && rows.length > 8) note(`… and ${rows.length - 8} more (--verbose)`);
  }
}

/* -------------------------------------------------------- period agreement */
{
  const withEnds = data.results.filter(r => r.periodEnds && Object.keys(r.periodEnds).length);
  const withLineEnds = data.results.filter(r => Object.values(r.provenance || {}).some(p => p.endByYear && Object.keys(p.endByYear).length));
  const bad = Object.keys(found).filter(k => k.endsWith(':period-agreement'));
  if (!withEnds.length || !withLineEnds.length) {
    ok(`period agreement: not in this dataset yet — ${withEnds.length} of ${data.results.length} records carry fiscal year-ends and ${withLineEnds.length} carry per-line period ends; the check runs (inside validateCompany) once the file is regenerated`);
  } else if (!bad.length) ok(`period agreement: every line of the ${withEnds.length} records with year-ends describes the income statement's year`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
