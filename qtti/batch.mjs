#!/usr/bin/env node
/**
 * QT Trading Index — weekly batch runner
 *
 *   node qtti/batch.mjs                     run qtti/observations.json
 *   node qtti/batch.mjs --check             run only the §14 self-test and exit
 *   node qtti/batch.mjs --file other.json
 *   node qtti/batch.mjs --out qtti/out      where the markdown and CSV go
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ENGINE, NOT TWO
 *
 * The scoring engine is not reimplemented here. This file slices index.html
 * between @qtti-engine-start and @qtti-engine-end and evaluates that region in
 * Node. The region is pure — no DOM, no localStorage — which is why it lifts
 * cleanly.
 *
 * The alternative was to copy the weights, bands and gates into this file. That
 * is the defect this codebase keeps finding in itself: two surfaces describing
 * one fact, drifting apart quietly until a number on the page disagrees with a
 * number in a report and nobody can say which is right. A batch that scored 50
 * assets slightly differently from the page that explains the method would be
 * worse than no batch at all.
 *
 * EVERY RUN SELF-TESTS
 *
 * Extraction by marker can fail silently: a refactor moves a function out of the
 * region and the batch still runs, just wrong. So every run first scores the
 * specification's own worked example and refuses to continue unless it returns
 * 38 / 35 / 77. If the engine this file extracted is not the engine the
 * specification describes, nothing is written.
 *
 * NOT SORTED BY SCORE, DELIBERATELY
 *
 * A weekly table of 50 assets ordered by trend score is a pick list whatever it
 * is titled, and this product does not produce those — its own rules forbid a
 * screen named "Best" or "Top Picks", and Malaysia's SC treats algorithmic
 * ranking as advice for licensing purposes. Rows come out alphabetically, or in
 * the order you wrote them. Sort the CSV yourself if you want to; that is your
 * decision taken knowingly rather than the tool's taken for you.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const OBS_FILE = resolve(ROOT, flag('file', 'qtti/observations.json'));
const OUT_DIR  = resolve(ROOT, flag('out', 'qtti/out'));

/* ---------------------------------------------------------------- engine -- */

function extractEngine(html) {
  const a = html.indexOf('@qtti-engine-start');
  const b = html.indexOf('@qtti-engine-end');
  if (a < 0 || b < 0)
    throw new Error('engine markers not found in index.html — @qtti-engine-start / @qtti-engine-end');
  if (b < a) throw new Error('engine markers are the wrong way round in index.html');
  /* From the end of the opening comment to the start of the closing one. */
  const from = html.indexOf('*/', a) + 2;
  const to = html.lastIndexOf('/*', b);
  return html.slice(from, to);
}

/* The handful of helpers the engine borrows from the rest of the file. Kept
   deliberately tiny and identical in behaviour — if this list grows, the engine
   region has stopped being self-contained and should be fixed there rather than
   propped up here. */
const PRELUDE = `
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
`;

async function loadEngine() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const src = extractEngine(html);
  const factory = new Function(`
    ${PRELUDE}
    ${src}
    return { qttiRun, qttiWorkedExample, qttiDefaultPlan, qttiBlankPanel,
             QTTI_GROUPS, QTTI_TIMEFRAMES, QTTI_STATES, QTTI_TEMPLATES,
             QTTI_INSTRUMENTS, QTTI_LIMITS, QTTI_VERSION };
  `);
  return factory();
}

/* ------------------------------------------------------------- self-test -- */

function selfTest(E) {
  const r = E.qttiRun(E.qttiWorkedExample());
  const want = { regime: 38, tranche: 35, confidence: 77 };
  const got = { regime: r.regime, tranche: r.tranche, confidence: r.confidence };
  const ok = want.regime === got.regime && want.tranche === got.tranche
          && want.confidence === got.confidence && r.trancheState.id === 'blocked';
  return { ok, want, got, state: r.trancheState.id, gates: r.gates.length };
}

/* ------------------------------------------------------------ input load -- */

/* An observation file is a list of assets. Each carries the same evidence the
   page asks for, and anything omitted stays at the blank plan's value — which
   for the six evidence groups means "unknown", contributing a neutral 50 and
   reducing coverage rather than being quietly dropped. */
function buildPlan(E, asset) {
  const plan = E.qttiDefaultPlan();
  const panelFrom = (spec) => {
    const p = E.qttiBlankPanel();
    if (!spec) return p;
    p.present = spec.present !== false;
    E.QTTI_GROUPS.forEach(g => {
      const v = spec[g.k];
      if (v == null) return;                                  /* stays unknown */
      if (typeof v === 'number') p[g.k] = { state:'analyst', value: v };
      else p[g.k] = { state: String(v), value: null };
    });
    return p;
  };

  Object.assign(plan, {
    symbol: asset.symbol || '',
    instrumentType: asset.instrumentType || 'etf',
    venue: asset.venue || '',
    quoteCurrency: asset.quoteCurrency || 'USD',
    priceBasis: asset.priceBasis || 'unknown',
    capturedAt: asset.capturedAt || '',
    screenshotName: asset.screenshot || '',
    screenshotHash: asset.screenshotHash || '',
    identityConsistent: !!asset.identityConsistent,
    panelsCropped: !!asset.panelsCropped,
    unknownIndicators: asset.unknownIndicators || '',
    tradingStatusClear: !!asset.tradingStatusClear,
    equityThesisStatus: asset.equityThesisStatus || 'unknown',
    template: asset.template || 'trend_continuation',
    reversalOptIn: !!asset.reversalOptIn,
    triggerComplete: !!asset.triggerComplete,
    entryLocation: asset.entryLocation || 'unknown',
  });
  if (asset.assetThesis) Object.assign(plan.assetThesis, asset.assetThesis);
  if (asset.confidence) Object.assign(plan.confidence, asset.confidence);
  if (asset.plan) Object.assign(plan.plan, asset.plan);
  if (asset.perp) Object.assign(plan.perp, asset.perp);
  if (asset.extension) Object.assign(plan.extension, asset.extension);
  plan.timeframes = {
    daily:   panelFrom(asset.daily),
    weekly:  panelFrom(asset.weekly),
    monthly: panelFrom(asset.monthly),
  };
  return plan;
}

/* ---------------------------------------------------------------- output -- */

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padL = (s, n) => String(s ?? '').padStart(n);

/* Widths come from the content. A fixed width silently truncated the two
   columns that identify the row — "BTC / USDC Perpetual Contr" and "Bearish /
   counter-tren" — which on a table whose whole job is to say which asset is in
   which regime is the wrong thing to cut. */
function table(rows) {
  const cells = rows.map(r => r.assessable
    ? [r.symbol, String(r.regime), r.band, String(r.tranche), r.state, String(r.confidence ?? '—'), String(r.gateCount)]
    : [r.symbol, '—', 'not assessable', '—', '—', String(r.confidence ?? '—'), '—']);
  const head = ['Asset', 'Regime', 'Band', 'Tranche', 'State', 'Conf', 'Gates'];
  const right = [false, true, false, true, false, true, true];
  const w = head.map((h, i) => Math.max(h.length, ...cells.map(c => c[i].length)));
  const fmt = (c) => c.map((v, i) => (right[i] ? padL(v, w[i]) : pad(v, w[i]))).join('  ').trimEnd();
  return [fmt(head), '-'.repeat(w.reduce((a, x) => a + x + 2, -2)), ...cells.map(fmt)].join('\n');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(rows) {
  const cols = ['symbol', 'instrument', 'assessable', 'regime', 'band', 'tranche', 'state',
                'confidence', 'gateCount', 'coverageDaily', 'coverageWeekly', 'coverageMonthly',
                'firstBlocker'];
  return [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n');
}

function toMarkdown(rows, meta) {
  const out = [];
  out.push(`# QT Trading Index — weekly batch`);
  out.push('');
  out.push(`Model \`${meta.version}\` · ${rows.length} assets · generated ${meta.generatedAt}`);
  out.push('');
  out.push('Rows are in **input order, not score order**. A weekly table sorted by trend score is a');
  out.push('pick list whatever it is titled; sorting is left to whoever reads it.');
  out.push('');
  out.push('Every state here is one a person recorded from their own chart. Nothing was extracted');
  out.push('from an image, no indicator has been validated on point-in-time data, and none of this');
  out.push('is a recommendation.');
  out.push('');
  out.push('| Asset | Instrument | Regime | Band | Tranche | State | Conf | Gates | First blocker |');
  out.push('|---|---|---:|---|---:|---|---:|---:|---|');
  rows.forEach(r => out.push(
    `| ${r.symbol} | ${r.instrument} | ${r.assessable ? r.regime : '—'} | ${r.assessable ? r.band : 'not assessable'} `
    + `| ${r.assessable ? r.tranche : '—'} | ${r.assessable ? r.state : '—'} | ${r.confidence ?? '—'} `
    + `| ${r.assessable ? r.gateCount : '—'} | ${(r.firstBlocker || '').replace(/\|/g, '\\|')} |`));
  out.push('');
  out.push(`## Not assessable (${meta.notAssessable})`);
  out.push('');
  if (!meta.notAssessable) out.push('None — every asset carried enough evidence to score.');
  rows.filter(r => !r.assessable).forEach(r => {
    out.push(`**${r.symbol}**`);
    r.reject.forEach(x => out.push(`- ${x}`));
    out.push('');
  });
  return out.join('\n');
}

/* ------------------------------------------------------------------ main -- */

let E;
try {
  E = await loadEngine();
} catch (err) {
  console.error('Could not load the scoring engine out of index.html.');
  console.error(`  ${err.message}`);
  console.error('\nThis file does not carry its own copy of the engine, by design — two copies of a');
  console.error('scoring model drift apart and then disagree about which number is right. Restore the');
  console.error('@qtti-engine-start / @qtti-engine-end markers around the engine region and re-run.');
  process.exit(1);
}

const st = selfTest(E);
if (!st.ok) {
  console.error('SELF-TEST FAILED — the engine extracted from index.html does not reproduce §14.');
  console.error(`  expected regime/tranche/confidence 38/35/77 blocked`);
  console.error(`  got      ${st.got.regime}/${st.got.tranche}/${st.got.confidence} ${st.state}`);
  console.error('\nNothing was written. Either the engine changed, or the @qtti-engine markers no');
  console.error('longer enclose all of it. Fix that before trusting any batch output.');
  process.exit(1);
}
console.log(`self-test ok — §14 worked example returns 38/35/77, blocked on ${st.gates} gates`);
console.log(`engine     ${E.QTTI_VERSION} (extracted from index.html)`);

if (has('check')) process.exit(0);

if (!existsSync(OBS_FILE)) {
  console.error(`\nNo observations file at ${OBS_FILE}`);
  console.error('Copy qtti/observations.example.json to qtti/observations.json and edit it.');
  console.error('That path is git-ignored, so your own reading of the charts stays local.');
  process.exit(1);
}

const doc = JSON.parse(await readFile(OBS_FILE, 'utf8'));
const assets = Array.isArray(doc) ? doc : (doc.assets || []);
if (!assets.length) { console.error('\nThe observations file holds no assets.'); process.exit(1); }
if (doc._draft) console.log(`\nnote: ${OBS_FILE} is an extraction draft.`);

/* An asset extracted by qtti/extract.mjs arrives confirmed:false, and stays
   unscored until a person has read it against the image. This refusal is the
   only thing separating "a model looked at a picture" from "this is the trend
   regime", and the tranche gate reads the trend regime. A pipeline that scored
   drafts would make the confirmation step decorative.

   Assets written by hand carry no confirmed flag at all and are scored — the
   check is for drafts specifically, not a new ceremony for everyone. */
const unconfirmed = assets.filter(a => a.confirmed === false);
const scorable = assets.filter(a => a.confirmed !== false);

const rows = scorable.map(a => {
  const r = E.qttiRun(buildPlan(E, a));
  const inst = (E.QTTI_INSTRUMENTS.find(x => x.id === (a.instrumentType || 'etf')) || {}).label || '—';
  return {
    symbol: a.symbol || '(unnamed)',
    instrument: inst,
    assessable: r.assessable,
    regime: r.regime, band: r.assessable ? r.band.label : '',
    tranche: r.tranche, state: r.trancheState.label,
    confidence: r.confidence,
    gateCount: r.gates.length,
    coverageDaily:   Math.round(r.tfs.daily.coverage * 100),
    coverageWeekly:  Math.round(r.tfs.weekly.coverage * 100),
    coverageMonthly: Math.round(r.tfs.monthly.coverage * 100),
    firstBlocker: r.assessable ? (r.gates[0] || '') : (r.reject[0] || ''),
    reject: r.reject,
  };
});

/* Input order by default. --alpha sorts by name — still not by score. */
if (has('alpha')) rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

console.log('');
if (rows.length) console.log(table(rows));
if (unconfirmed.length) {
  console.log(`\n${unconfirmed.length} asset${unconfirmed.length === 1 ? '' : 's'} NOT SCORED — extracted but not confirmed by a person:`);
  unconfirmed.forEach(a => console.log(`  · ${a.symbol || '(unnamed)'}${a.screenshot ? `  [${a.screenshot}]` : ''}`));
  console.log('\nRead each against its screenshot, correct the states, complete the gate fields,');
  console.log('then set confirmed: true. A model reading a chart and a person having checked it');
  console.log('produce equally confident JSON; only one of them is evidence.');
}
console.log('');

const assessable = rows.filter(r => r.assessable);
const met = assessable.filter(r => /met|confirmed/i.test(r.state)).length;
const notMet = assessable.length - met;
console.log(`${assets.length} asset${assets.length === 1 ? '' : 's'} · ${rows.length} scored · `
  + `${unconfirmed.length} unconfirmed · ${rows.length - assessable.length} refused on evidence`);
if (rows.length) console.log(`${met} ${met === 1 ? 'meets' : 'meet'} the first-tranche criteria you declared; `
  + `${notMet} ${notMet === 1 ? 'does' : 'do'} not.`);
console.log('Rows are in input order. Nothing here is ranked, and nothing here is a recommendation.');

const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
const stamp = generatedAt.slice(0, 10);
await mkdir(OUT_DIR, { recursive: true });
const mdPath = join(OUT_DIR, `qtti-${stamp}.md`);
const csvPath = join(OUT_DIR, `qtti-${stamp}.csv`);
await writeFile(mdPath, toMarkdown(rows, {
  version: E.QTTI_VERSION, generatedAt, notAssessable: rows.length - assessable.length }), 'utf8');
await writeFile(csvPath, toCsv(rows), 'utf8');
console.log(`\nwrote ${mdPath}`);
console.log(`wrote ${csvPath}`);

/* Non-zero when anything was left unscored, so a scheduled run cannot report
   success while half the week's assets sat unconfirmed. */
if (unconfirmed.length) process.exit(2);
