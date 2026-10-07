#!/usr/bin/env node
/**
 * Assembles index.html from src/. index.html is still exactly one
 * self-contained file — that has not changed, and must not: every tool that
 * reads the engine reads it out of index.html.
 *
 *   node build.mjs            write index.html, 404.html, pages/, assets/ and vercel.json
 *   node build.mjs --check    build to memory, fail if any committed file differs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * index.html reached 21,957 lines in two blocks — 1,257 of CSS and 20,462 of JS.
 * Nothing was wrong with shipping one file; the problem was *editing* one file.
 * Every change rewrote 1.3MB, so `git diff` was unreadable, two edits in
 * different features collided in the same blob, and no reviewer could tell the
 * property calculator from the options wheel.
 *
 * So the split is in the source, not the output. There is no bundler, no
 * dependency graph, no module system: the JS files are concatenated in filename
 * order into the same single <script> that was always there, and the CSS into
 * the same <style>. The boundaries are the section banners that were already
 * written in the file, so every module maps back to a comment a human wrote.
 *
 * The build is therefore a pure text splice, and its correctness is checkable:
 * when this was first run it reproduced the previous index.html byte for byte.
 *
 * index.html STAYS COMMITTED. Vercel serves it statically with no build step,
 * exactly as before, and `deploy-check.mjs` still hashes it whole. `--check`
 * runs in CI so the committed output can never drift from the source that
 * claims to produce it — the one failure mode this arrangement introduces.
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE HEAD PER ADDRESS (the launch audit, 2026-09-29)
 *
 * Every address was served index.html, and index.html's <head> is the
 * homepage's. The client corrected the title, the description and the
 * canonical link once its script ran (setDocumentMeta, 35-ui.js) — but a
 * WhatsApp, Slack, Facebook or LinkedIn preview, and any crawler that reads
 * the HTML without running it, never runs it. /pricing, /status and
 * /company/1155-malayan-banking all previewed as the homepage, each naming
 * https://quantum-tradeworks.vercel.app/ as its canonical address. And an
 * address that exists nowhere answered 200 with the same page, so a dead link
 * was a soft 404 to every crawler although the app drew its not-found card.
 *
 * So the build now also writes:
 *
 *   pages/<route>.html  one copy of the page per route in ROUTES without a
 *                       parameter, whose <head> is that route's own: its
 *                       title, description and canonical exactly as the
 *                       client's setDocumentMeta sets them — computed BY
 *                       setDocumentMeta, evaluated here out of src/js, not
 *                       restated — and og:/twitter: tags that repeat them.
 *                       Nothing else differs from index.html, so the inline
 *                       script, and the CSP hash that names it, are the same.
 *                       Routes whose heads are identical (the wheel's five
 *                       aliases) share one file.
 *   index.html          the site root's page — the '/' route's head, now
 *                       read from ROUTES and META like every other page.
 *                       Since 2026-10-06 (plan item 1.2) it is not what /
 *                       serves: / is pages/home.app.html, index.html
 *                       linked like every other page (HOME, below), and
 *                       index.html is kept off the host.
 *   404.html            the shell with the not-found head and noindex. Vercel
 *                       serves it with status 404 for any address nothing
 *                       else answers, and the app draws its not-found card.
 *   vercel.json         one rewrite per route, generated from ROUTES in place
 *                       of the catch-all: a static route to its page, a
 *                       parameter route (/company/:id …) to the generic
 *                       page (pages/generic.app.html since 2026-10-03:
 *                       index.html carries the homepage itself now).
 *
 * Parameter routes keep the generic page: which company an :id names is the
 * router's to resolve, after the filings load — except each company's own
 * address, which has a page of its own (ONE HEAD PER COMPANY, below).
 * ─────────────────────────────────────────────────────────────────────────────
 * THE APP ONCE, NOT FIFTY-SIX TIMES (2026-09-30)
 *
 * Each page above began as a whole copy of index.html — 3.3MB, nearly all of
 * it the inline script — so the deployed tree went from 13.5MB to 202MB, a
 * rebuild rewrote 177MB into git, and every bot probing an address that does
 * not exist (/wp-login.php, /.env) was sent the whole app as 404.html.
 *
 * So the script and the stylesheet are written once each, as files named by
 * their own content:
 *
 *   assets/app.<12 hex>.js   index.html's inline script, byte for byte
 *   assets/app.<12 hex>.css  index.html's inline stylesheet, byte for byte
 *
 * and every page under pages/, and 404.html, loads them where index.html
 * carries them inline: <link rel="stylesheet"> where the <style> was, and a
 * plain <script src> — no defer, no async — where the <script> was, the last
 * thing in <body>, so the script runs at the same point of the parse, after
 * the same markup and the same stylesheet, as the inline one does. Nothing in
 * it reads its own element (document.currentScript) or the page's source.
 * (Since plan item 1.2 the script is loaded deferred from the head, which
 * runs it at the same point, after the whole parse: linked(), below.)
 * A page is then its head and the shell's markup — tens of kB, and
 * PAGE_LIMIT fails the build past that. The name is the first 12 hex of the
 * file's SHA-256, so a changed file is a new address and vercel.json can let
 * a browser keep one for a year (immutable); the build deletes the names it
 * no longer writes, and --check fails on a stale one or a missing one.
 *
 * index.html keeps both inline and does not change: scanner/scan.mjs,
 * ingest/history-store.mjs, tv-verify, bot-verify, qtti/batch.mjs, syntax.mjs
 * and the harnesses read the engine, and the CSP hash, out of it.
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE HEAD PER COMPANY (Release B, 2026-09-30)
 *
 * /company/:id is a parameter route, so every company's address was served
 * index.html, whose head is the homepage's: a link to Apple's page previewed
 * in WhatsApp, Slack or LinkedIn as "Quantum Tradeworks — your financial
 * decision workspace" over the homepage's description, and a crawler reading
 * the HTML was told the page's canonical address was the site root. Which
 * company an :id names is the router's to resolve once the filings load; but
 * the address each company is LINKED at — companyPath's /company/<ticker, or
 * a Bursa listing code>-<two words of its name> — can be known here, because
 * the universe the page assembles can be read here.
 *
 * So each company in it gets a page of its own at that address, written as
 * a route page is (the shell and the two app files, only the head its own):
 *
 *   pages/company/<slug>.html  the title and canonical the page's
 *                       setDocumentMeta writes for that company on a cold
 *                       load, and a description that says what the company
 *                       is — its name, its ticker (and on Bursa its listing
 *                       code), where it is listed, and whether its figures
 *                       are filed with the SEC or illustrative — ahead of
 *                       the line the company page gives itself.
 *
 * The universe is the page's own, read and not restated: the illustrative
 * set (RAW) and the naming addCompany gives it, then each filer in
 * data/us.json through the loader's realToCompany and retireIllustrativeTwin,
 * in the order loadRealData runs them — the Bursa companies and any US
 * listing no filer replaces, whose figures are illustrative, and every SEC
 * filer. Nothing from the owner's machine: the personal lane is never
 * deployed.
 *
 * Each page has an exact rewrite, generated from that list, after the static
 * routes' and before the parameter routes'. Every other form of a company
 * address — a code (/company/1155), an id (/company/AAPL-SEC), a registry
 * alias (/company/1155.KL), a longer or differently-cased tail, the report,
 * /app/equities/… — is still answered by its parameter route with the
 * generic page, and an unknown company is still the generic page on which
 * the router draws the not-found card with noindex.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { journeysServed, ISLAND_PAGES, RECORD_FILE, ROOT_PAGES, JOURNEY_NAMES } from './journeys.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(ROOT, 'src', ...p);
const OUT = join(ROOT, 'index.html');
const NOT_FOUND = '404.html';
/* The route pages' folder. No route starts with /pages, and nothing links to
   a file in it: each page is reached through its route's rewrite. */
const PAGES = 'pages';
/* The app's script and stylesheet, once each, named by their content (see
   THE APP ONCE above). No route starts with /assets (routePlan refuses one),
   and the build owns every file in the folder: one it did not write is stale. */
const ASSETS = 'assets';
/* The most a page or 404.html may weigh. A page is its head plus the shell's
   markup, about 25kB; the app inline again would be 3.3MB. 200kB leaves room
   for the shell to grow and none for the script or the stylesheet to creep
   back in. */
export const PAGE_LIMIT = 200 * 1024;

const STYLE_MARKER = '/*@INJECT:styles*/\n';
const SCRIPT_MARKER = '//@INJECT:scripts\n';
const VERSIONS_MARKER = '/*@INJECT:dataversions*/';
/* Where the journeys' one renderer goes into the app (91-health.js). */
const JOURNEYS_MARKER = '/*@INJECT:journeysServed*/ null';
/* And the journeys' names, by id (91-health.js; JOURNEY_NAMES in
   journeys.mjs): /status names the journey that proves each Live badge. */
const JOURNEY_NAMES_MARKER = '/*@INJECT:journeyNames*/ null';
/* Where the homepage's filed example goes into the app (55-views-public.js;
   homeFiled, below). */
const HOME_FILED_MARKER = '/*@INJECT:homeFiled*/ null';
const CSP_MARKER = '@CSP_HASH';
/* The first-paint script's hash (BEFORE THE FIRST PAINT, below). */
const CSP_FIRST_MARKER = '@CSP_FIRST_HASH';
const REWRITES_MARKER = '@ROUTE_REWRITES';
/* vercel.json's header sources for the two app files, filled in with their
   current names: each file's own rule, and the pages' rule, which must not
   reach them (one header, one rule, whatever order the host applies them in). */
const APP_SCRIPT_MARKER = '@APP_SCRIPT';
const APP_STYLES_MARKER = '@APP_STYLES';
const APP_FILES_MARKER = '@APP_FILES';

/* Data files that ship WITH the repo, and may therefore be cached forever under
   a content-addressed URL. The licensed lane is deliberately absent: those files
   are git-ignored, exist only on the reader's own machine, and publishing a hash
   of them in a public repo would leak a fingerprint of licensed data. They keep
   plain URLs and no-store, which is what fetchJson falls back to. */
const VERSIONED = ['us.json', 'instruments.json', 'sarawak-geo.json'];

/* The committed files, and then each NAPIC division file the build writes
   (napicSlices), hashed as written: the page asks for those by the same
   content-addressed URL. */
function dataVersions(written = new Map()) {
  const out = {};
  for (const f of VERSIONED) {
    const path = join(ROOT, 'data', f);
    if (!existsSync(path)) throw new Error(`data/${f} is missing — it is committed, so this is a broken checkout`);
    out[f] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  }
  for (const [label, body] of written) out[label.slice('data/'.length)] = createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 12);
  return out;
}

/* ─── NAPIC, SERVED ONE DIVISION AT A TIME (plan item 1.6; the owner's D7) ──
   data/napic-h1-2025.json is what napic-ingest.mjs extracts: 1,583 benchmark
   rows across twelve divisions, with every field the extraction took. Its own
   licence note says "Record-level republication, bulk export and raw-file
   download stay disabled until JPPH confirms commercial redistribution
   rights", and it was served whole at /data/napic-h1-2025.json, a 1MB
   download of every row, 165 single-observation Kuching rows among them.
   It stays in the repository as the source. .vercelignore keeps it off the
   host (servingProblems holds it there), and the build writes one file per
   division under data/napic-h1-2025/. Each holds only what the area screen's
   panel (officialBenchmarkPanel, 81-napic.js) shows: the division's H1 2025
   activity rows, its benchmark rows with the columns the table shows, and
   the period, attribution, licence and caveats every panel carries. The page
   asks for the one division its locality lies in (loadNapic). No file holds
   a second division's rows: napicProblems fails the build if one would, and
   served-check fails a served file that does. */
export const NAPIC_SOURCE = 'data/napic-h1-2025.json';
export const NAPIC_DIR = 'data/napic-h1-2025';
export const napicSlug = (division) => String(division).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/* What officialBenchmarkPanel reads of a row, and nothing else: no land or
   floor area, no previous range, no table or evidence labels. A column the
   panel gains is added here, or it reads blank. */
const NAPIC_ROW_FIELDS = ['scheme', 'propertyType', 'floorLevel', 'roadPosition', 'sampleSize', 'min', 'max', 'rangeLabel',
  'basisUnit', 'perMonth', 'changeStated', 'changePct', 'grossYieldPct'];
const NAPIC_ACTIVITY_FIELDS = ['periodCode', 'subsector', 'count', 'valueRm', 'impliedAverageValueRm', 'impliedAverageLabel'];
/* One row a line, so a diff of a regenerated extract reads row by row. */
const napicJson = (doc) => '{\n' + Object.entries(doc).map(([k, v]) => `  ${JSON.stringify(k)}: ${
  Array.isArray(v) && v.some(r => r && typeof r === 'object')
    ? (v.length ? `[\n${v.map(r => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]` : '[]')
    : JSON.stringify(v)}`).join(',\n') + '\n}\n';
/* label (data/napic-h1-2025/<division>.json) → the file's text. */
export function napicSlices(text) {
  const src = JSON.parse(text);
  const period = src.period.code;
  const pick = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k] === undefined ? null : r[k]]));
  const divisions = [...new Set([...src.benchmarks, ...src.summary].map(r => r.division))].sort();
  const out = new Map();
  for (const division of divisions) {
    out.set(`${NAPIC_DIR}/${napicSlug(division)}.json`, napicJson({
      format: 'quantum-tradeworks/napic-division', version: 1, division,
      period: src.period, licence: src.licence, cannotAnswer: src.cannotAnswer,
      reconciliation: { target: { count: src.reconciliation.target.count } },
      summary: src.summary.filter(r => r.division === division && r.periodCode === period).map(r => pick(r, NAPIC_ACTIVITY_FIELDS)),
      benchmarks: src.benchmarks.filter(r => r.division === division).map(r => pick(r, NAPIC_ROW_FIELDS)),
    }));
  }
  return out;
}
/* Every source row in exactly one file, each file one division's, under one
   name each, and the licence carried whole. */
export function napicProblems(slices, text) {
  const src = JSON.parse(text);
  const out = [];
  let rows = 0;
  const seen = new Set();
  for (const [label, body] of slices) {
    const doc = JSON.parse(body);
    const divisions = new Set([doc.division, ...doc.benchmarks.map(r => r.division).filter(Boolean)]);
    if (divisions.size !== 1) out.push(`${label} holds ${divisions.size} divisions' rows`);
    if (label !== `${NAPIC_DIR}/${napicSlug(doc.division)}.json`) out.push(`${label} holds the ${doc.division} Division`);
    if (seen.has(doc.division)) out.push(`two files hold the ${doc.division} Division`);
    seen.add(doc.division);
    if (JSON.stringify(doc.licence) !== JSON.stringify(src.licence)) out.push(`${label} does not carry the source's licence whole`);
    rows += doc.benchmarks.length;
  }
  if (rows !== src.benchmarks.length) out.push(`the division files hold ${rows} benchmark rows, where ${NAPIC_SOURCE} holds ${src.benchmarks.length}`);
  return out;
}

/* ─── THE CLIENT'S ROUTER, EVALUATED HERE ────────────────────────────────────
   The route table, META, and the three functions that turn an address into a
   head — matchRoute, setDocumentMeta, canonicalPath — cut out of src/js and
   run in a sandbox, the way register-check.mjs already reads the route table.
   The head a page is SERVED with is therefore the head its router SETS: a new
   route gets its page on the next build, a changed title or description moves
   with it, and there is no second list anywhere to fall out of step.

   setDocumentMeta writes to `document`, which here is a stub that records
   what it was given; location is the address being built, with no query. */
const js = (f) => lf(readFileSync(src('js', f), 'utf8'));
/* From the first `start` that begins a line to the first `close` after it —
   a top-level declaration, which is what every one of these is, and never a
   comment that happens to name one mid-line. If one stops being, this throws
   with its name rather than evaluating half a file. */
const cut = (text, file, start, close) => {
  let i = text.indexOf(start);
  while (i > 0 && text[i - 1] !== '\n') i = text.indexOf(start, i + 1);
  if (i < 0) throw new Error(`${file}: "${start.trim()}" not found at the start of a line — the build reads the router and the universe out of it`);
  const j = text.indexOf(close, i);
  if (j < 0) throw new Error(`${file}: no ${JSON.stringify(close)} closes "${start.trim()}"`);
  return text.slice(i, j + close.length);
};
export function clientRouter(origin) {
  const UI = js('35-ui.js'), DISCOVER = js('40-views-discover.js'), LEARN = js('65-learn.js');
  /* META is added to from other modules — 86-scanner.js registers its pages'
     lines with Object.assign(META, {…}) so that it does not edit 35-ui.js —
     and the page runs every module before it routes. Each such statement is
     applied here, in load order. Any other way of changing these tables
     (an assignment, a push) is refused by name: evaluated partially, the
     table would give a page the fallback line while the browser shows its
     own, which is exactly what the sweep's cross-check first caught. */
  const additions = [];
  for (const f of readdirSync(src('js')).filter(x => x.endsWith('.js')).sort()) {
    const t = js(f);
    for (let i = t.indexOf('Object.assign(META, {'); i > -1; i = t.indexOf('Object.assign(META, {', i + 1)) {
      additions.push(cut(t.slice(i), f, 'Object.assign(META, {', '\n});'));
    }
    if (/\bMETA(\.[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)/.test(t))
      throw new Error(`${f} assigns to META; the build reads additions to it only as Object.assign(META, {…}) statements`);
    if (/\b(ROUTES|DISCOVER_TABS|LEARN_TABS)\.(push|unshift|splice)\(|Object\.assign\((ROUTES|LEARN_TAB_ALIAS|DISCOVER_TABS|LEARN_TABS)\b/.test(t))
      throw new Error(`${f} changes the route table or a tab table at run time, which the build cannot read`);
  }
  const tags = new Map();
  const tag = () => {
    const attrs = {};
    /* remove(): setDocumentMeta takes the not-found card's robots tag off a
       page that is found. The head written here carries its own (withHead). */
    return { attrs, setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), remove() {} };
  };
  const document = {
    title: '',
    head: { append() {} },
    createElement: tag,
    querySelector: (sel) => { if (!tags.has(sel)) tags.set(sel, tag()); return tags.get(sel); },
  };
  /* State and BY_ID are what setDocumentMeta and canonicalPath read to name
     a company page. Empty, as on every route page; companyHeadAt below fills
     them for one company at a time, as the router does on its address. */
  const ctx = vm.createContext({ URLSearchParams, document, location: null, State: {}, BY_ID: new Map() });
  const api = vm.runInContext([
    "const BASE = '';",
    cut(UI, '35-ui.js', 'const href = ', ';\n'),
    /* A company's address, and the one word that labels synthetic figures,
       as the page writes them. */
    cut(UI, '35-ui.js', 'const slug = ', ';\n'),
    cut(UI, '35-ui.js', 'function companyPath(', '\n}\n'),
    cut(UI, '35-ui.js', 'const ILLUS_TITLE = ', ';\n'),
    cut(UI, '35-ui.js', 'const COMPANY_LISTED = ', ';\n'),
    cut(UI, '35-ui.js', 'function companyMetaDescription(', '\n}\n'),
    cut(UI, '35-ui.js', 'const POSITIONING = {', '\n};'),
    cut(UI, '35-ui.js', 'const ROUTES = [', '\n];'),
    cut(UI, '35-ui.js', 'const META = {', '\n};'),
    ...additions,
    cut(DISCOVER, '40-views-discover.js', 'const DISCOVER_TABS = [', '\n];'),
    cut(LEARN, '65-learn.js', 'const LEARN_TAB_ALIAS = ', ';\n'),
    cut(LEARN, '65-learn.js', 'const LEARN_TABS = [', '\n];'),
    cut(UI, '35-ui.js', 'function matchRoute(', '\n}\n'),
    cut(UI, '35-ui.js', 'function setDocumentMeta(', '\n}\n'),
    cut(UI, '35-ui.js', 'function canonicalPath(', '\n}\n'),
    '({ POSITIONING, ROUTES, META, ILLUS_TITLE, matchRoute, setDocumentMeta, companyPath })',
  ].join('\n'), ctx, { filename: 'src/js (router)' });

  /* What setDocumentMeta writes on a first load of `path`: the route's title,
     META line and canonical address, or — for an address no route matches —
     the not-found card's. */
  const run = (path) => {
    ctx.location = { origin, pathname: path, search: '', hash: '' };
    tags.clear();
    document.title = '';
    api.setDocumentMeta(api.matchRoute(path));
    const description = tags.get('meta[name="description"]')?.attrs.content;
    const canonical = tags.get('link[rel="canonical"]')?.attrs.href;
    if (!document.title || !description || !canonical) throw new Error(`setDocumentMeta set no title, description or canonical for ${path}`);
    /* And whether the page asks not to be indexed — a company whose figures
       are illustrative does, from the same function. */
    const noindex = tags.get('meta[name="robots"]')?.attrs.content === 'noindex';
    return { title: document.title, description, canonical, ...(noindex ? { noindex: true } : {}) };
  };
  const headAt = (path) => { ctx.State = {}; ctx.BY_ID = new Map(); return run(path); };
  /* A company's own address, as a cold load of it ends once the filings are
     in: applyRoute resolves the address to the company (State.ticker), finds
     no tab in it (the snapshot), and calls setDocumentMeta — whose title
     names the company and whose canonical is companyPath's. The resolver is
     the page's, and the sweep holds it to reading each address back to its
     own company in a browser; here the company is the one given. */
  const companyHeadAt = (c) => {
    const path = api.companyPath(c);
    ctx.State = { ticker: c.id, researchTab: 'snapshot' };
    ctx.BY_ID = new Map([[c.id, { c }]]);
    try { return { path, ...run(path) }; }
    finally { ctx.State = {}; ctx.BY_ID = new Map(); }
  };
  return { POSITIONING: api.POSITIONING, ROUTES: api.ROUTES, META: api.META, ILLUS_TITLE: api.ILLUS_TITLE, matchRoute: api.matchRoute, headAt, companyHeadAt };
}

/* The site's own address, read from the canonical link the template gives the
   site root — the one place it is written. */
export function siteOrigin(template) {
  const m = template.match(/<link rel="canonical" href="(https?:\/\/[^/"]+)\/">/);
  if (!m) throw new Error("the template's canonical link no longer names the site root, so the site's address cannot be read");
  return m[1];
}

/* ─── THE COMPANIES, AS THE PAGE ASSEMBLES THEM ──────────────────────────────
   The universe a visitor's page holds once its filings have loaded, and
   nothing only the owner's machine adds (the personal lane is never
   deployed): the illustrative set, RAW, each row named as addCompany names
   it; then each filer in data/us.json as loadRealData adds it — through
   realToCompany, retiring the illustrative stand-in it replaces
   (retireIllustrativeTwin), and added the same way. Each of those is the
   page's own code, cut out of src/js and run here, with what it reads beside
   it (a first visit's empty storage, so no price the reader typed); only
   loadRealData's loop is restated — it fetches, and this reads the file —
   and the sweep holds the result to the page's own universe in a browser.
   A filer realToCompany refuses is skipped and named, as the page skips it. */
export function companyUniverse() {
  const CORE = js('00-core.js'), DATASET = js('10-dataset.js'), DERIVATION = js('15-derivation.js'), UNIVERSE = js('25-universe.js');
  /* addCompany derives a company's figures, which a head does not need. Its
     one statement that NAMES a company — an illustrative one's listing code
     into c.code, its short name into c.tk; a filer already has both — is run
     on its own. Written another way, the build stops and says so, rather
     than name companies another way than the page does. */
  const add = cut(UNIVERSE, '25-universe.js', 'function addCompany(c) {', '\n}\n');
  const naming = add.match(/^[ \t]*(if \(!c\.real\) \{ c\.code = c\.tk; c\.tk = c\.id; \})/m);
  if (!naming) throw new Error('25-universe.js: addCompany no longer names an illustrative company with `if (!c.real) { c.code = c.tk; c.tk = c.id; }` — the build runs that statement to give each company the address and the title its page gives it');
  const ctx = vm.createContext({ store: { read: (key, fallback) => fallback } });
  const api = vm.runInContext([
    cut(CORE, '00-core.js', 'const isNum = ', ';\n'),
    cut(DERIVATION, '15-derivation.js', 'const F = {', '};'),
    cut(DATASET, '10-dataset.js', 'const RAW = [', '\n];'),
    'const U = [], BY_ID = new Map();',
    cut(UNIVERSE, '25-universe.js', 'const manualPrices = ', ';\n'),
    cut(UNIVERSE, '25-universe.js', 'const REAL_TYPES = {', '};'),
    cut(UNIVERSE, '25-universe.js', 'const REAL_SECTORS = {', '\n};'),
    cut(UNIVERSE, '25-universe.js', 'const SHIPPED_MISFILED_SECTOR = ', '));\n'),
    cut(UNIVERSE, '25-universe.js', 'function withholdMisassembled(', '\n}\n'),
    cut(UNIVERSE, '25-universe.js', 'function realToCompany(', '\n}\n'),
    cut(UNIVERSE, '25-universe.js', 'function retireIllustrativeTwin(', '\n}\n'),
    `const named = (c) => { ${naming[1]} return c; };`,
    /* And addCompany's bookkeeping: one row, in U and under its id. */
    'const add = (c) => { const row = { c: named(c) }; U.push(row); BY_ID.set(c.id, row); };',
    '({ RAW, U, BY_ID, add, realToCompany, retireIllustrativeTwin })',
  ].join('\n'), ctx, { filename: 'src/js (universe)' });
  api.RAW.forEach(api.add);
  const filings = JSON.parse(readFileSync(join(ROOT, 'data', 'us.json'), 'utf8'));
  const skipped = [];
  for (const r of filings.results || []) {
    let c;
    try { c = api.realToCompany(r); }
    catch (e) { skipped.push(`${r?.id}: ${e.message}`); continue; }
    if (api.BY_ID.has(c.id)) continue;            /* already loaded */
    api.retireIllustrativeTwin(c);
    api.add(c);
  }
  return { companies: api.U.map(r => r.c), skipped };
}

/* THE HOMEPAGE'S FILED EXAMPLE (plan item 3.8; the owner's decision D5(e)).
   The Equities card draws Apple's filed revenue and net income, by fiscal
   year, in US$ — its filing currency, whatever the reader's base currency —
   in the page's first draw, so it is served by the render and the page
   waits for nothing (a page that waited for the filings would be kept out
   of a reader's sight on localhost, and its draw would read their
   currency). So the figures are written into the app here, from the file
   the site serves: the statement tuple's revenue and net income columns
   (F, 15-derivation.js — the page's own reading of the tuple) of the
   filer's record in data/us.json, with the address the page gives it.
   served-check holds the drawn columns to the served file. */
export const HOME_FILED_ID = 'AAPL';
export function homeFiled(plan, root = ROOT) {
  const F = vm.runInContext(`${cut(js('15-derivation.js'), '15-derivation.js', 'const F = {', '};')}\nF`, vm.createContext({}));
  const file = JSON.parse(readFileSync(join(root, 'data', 'us.json'), 'utf8'));
  const r = (file.results || []).find(x => x.id === HOME_FILED_ID);
  if (!r) throw new Error(`data/us.json has no ${HOME_FILED_ID}, the homepage's filed example (homeFiled)`);
  const co = plan.companies.find(x => x.id === `${HOME_FILED_ID}-SEC`);
  if (!co || !co.company.real) throw new Error(`${HOME_FILED_ID}-SEC has no page of a filed company, which the homepage's example links`);
  if (r.ccy !== 'USD') throw new Error(`${HOME_FILED_ID}'s filed currency is ${r.ccy}, where the homepage's example is labelled US$`);
  if (!Array.isArray(r.years) || r.years.length < 2 || r.fin.length !== r.years.length) throw new Error(`${HOME_FILED_ID}: its years and statement rows do not pair`);
  const rev = r.fin.map(x => x[F.REV]), ni = r.fin.map(x => x[F.NI]);
  if (rev.some(v => typeof v !== 'number') || ni.some(v => typeof v !== 'number')) throw new Error(`${HOME_FILED_ID}: a filed year has no revenue or net income, which the homepage's columns would leave blank`);
  return { id: co.id, tk: r.id, name: r.name, path: co.path, ccy: r.ccy, cik: r.cik, years: r.years, rev, ni };
}

/* What a company's page is, in the line a link preview shows under its
   title: the company's name, its ticker (and on Bursa the listing code its
   address leads with), where it is listed, and where its figures come from —
   each read off the company as the page holds it — then the line the page
   gives itself (META.research, as setDocumentMeta writes it there), so the
   served description is the page's own with the company put first. An
   illustrative company says so in the page's own words, ILLUS_TITLE, the
   hover text of every "illustrative" chip; a filer names the SEC and its
   CIK, as the page's Source line does. A market, or a source, this cannot
   name truthfully stops the build rather than being guessed at. */
const LISTED = { US: 'listed in the US', MY: 'listed on Bursa Malaysia' };
export function companyDescription(c, pageLine, ILLUS_TITLE) {
  const where = LISTED[c.mkt];
  if (!where) throw new Error(`${c.id}: market ${JSON.stringify(c.mkt)} — the build cannot say where it is listed`);
  const tickers = c.mkt === 'MY' && c.code && c.code !== c.tk ? `${c.tk}, ${c.code}` : c.tk;
  let source;
  if (!c.real) source = ILLUS_TITLE;
  else if (!c.personal && c.cik) source = `Figures from its audited annual statements filed with the SEC (CIK ${Number(c.cik)}).`;
  else throw new Error(`${c.id}: real figures that are not an SEC filing, which a deployed page never holds`);
  return `${c.name} (${tickers}), ${where}. ${source} ${pageLine}`;
}

/* Every company's own address, and the head its page is served with. Pure:
   the router's answers and the universe's, nothing else. Each address must
   be literal segments (a rewrite's source is path-to-regexp), must be where
   the router opens the company page, must be the canonical address that page
   names, and must belong to one company. */
export function companyPlan(origin, router = clientRouter(origin)) {
  const { companies, skipped } = companyUniverse();
  const owner = new Map();
  const plan = companies.map((c) => {
    const { path, title, description, canonical, noindex = false } = router.companyHeadAt(c);
    /* Illustrative figures are not for a search index (the owner, 2026-10-03):
       the page says noindex for exactly those, and a filed company's does not. */
    if (noindex !== !c.real) throw new Error(`${c.id}: its page ${noindex ? 'asks not to be indexed' : 'may be indexed'}, but its figures are ${c.real ? 'filed' : 'illustrative'}`);
    /* The page writes the company's own description (companyMetaDescription,
       35-ui.js); the build composes it independently, and the two must agree,
       or a link preview and the page would say different things. */
    const composed = companyDescription(c, router.META.research, router.ILLUS_TITLE);
    if (description !== composed) throw new Error(`${c.id}: the page describes itself as ${JSON.stringify(description)}, the build as ${JSON.stringify(composed)}`);
    if (!/^(\/[A-Za-z0-9-]+)+$/.test(path)) throw new Error(`${c.id}: its address ${path} is not literal segments`);
    const route = router.matchRoute(path);
    if (!route || route.view !== 'research' || !route.path.includes(':'))
      throw new Error(`${c.id}: the router answers ${path}, the address companyPath gives it, with ${route ? `the route ${route.path} (view ${route.view})` : 'no route'}, not the company page's parameter route`);
    if (canonical !== origin + path) throw new Error(`${c.id}: its page names ${canonical} as its canonical address, not ${origin}${path}`);
    if (owner.has(path)) throw new Error(`${path} is the address of both ${owner.get(path)} and ${c.id}`);
    owner.set(path, c.id);
    return {
      path, id: c.id,
      company: { name: c.name, tk: c.tk, code: c.code || null, mkt: c.mkt, real: !!c.real, cik: c.cik || null },
      head: { title, description, canonical, ...(noindex ? { noindex: true } : {}) },
    };
  });
  return { companies: plan, skipped };
}

/* Which addresses get which page. Pure: the router's answers, nothing else. */
export function routePlan(template) {
  const origin = siteOrigin(template);
  const router = clientRouter(origin);
  /* Every module, read from the directory, as register-check reads them: a
     view added in a new file is found without this script being told. */
  const sources = readdirSync(src('js')).filter(f => f.endsWith('.js')).map(f => readFileSync(src('js', f), 'utf8')).join('\n');
  const defined = new Set([...sources.matchAll(/\bVIEWS\.([A-Za-z]+)\s*=/g)].map(m => m[1]));
  const pages = [], params = [], seen = new Set();
  for (const r of router.ROUTES) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    /* A rewrite's source is path-to-regexp. A route path is literal segments
       and whole-segment :params, so it means the same thing there as it does
       to matchRoute; anything else (a dot, a *, a (group)) would not, and is
       refused here rather than deployed with a second meaning. */
    if (!/^\/$|^(\/([A-Za-z0-9-]+|:[A-Za-z][A-Za-z0-9]*))+$/.test(r.path))
      throw new Error(`route ${r.path}: a path must be literal segments and whole-segment :params`);
    /* data/, assets/ and _vercel/ are the host's and the files', never a page's. */
    if (/^\/(data|assets|_vercel)(\/|$)/.test(r.path)) throw new Error(`route ${r.path} is under /data, /assets or /_vercel`);
    if (r.path.includes(':')) { params.push(r.path); continue; }
    const route = router.matchRoute(r.path);
    /* A parameter route above it answers this address in the router, so its
       rewrite (to the generic page) answers it here too. */
    if (route.path !== r.path) continue;
    if (!defined.has(route.view))
      throw new Error(`route ${r.path} opens the view "${route.view}", which no module in src/js defines — the router would draw the not-found card there`);
    pages.push({ path: r.path, view: route.view, head: router.headAt(r.path) });
  }
  if (!pages.some(p => p.path === '/')) throw new Error("ROUTES has no '/' row");
  /* Each company's own address (ONE HEAD PER COMPANY). None may be a static
     route's: companyPlan already refuses an address the router does not open
     as the company page, and a static row there would be one. */
  const { companies, skipped } = companyPlan(origin, router);
  const statics = new Set(pages.map(p => p.path));
  for (const co of companies) if (statics.has(co.path)) throw new Error(`${co.path} is both a route and ${co.id}'s address`);
  /* An address no route matches: setDocumentMeta(null)'s title and description. */
  return { origin, pages, params, companies, skippedFilers: skipped, notFound: router.headAt('/404.html'), ROUTES: router.ROUTES, POSITIONING: router.POSITIONING };
}

/* ─── THE NAVIGATION, IN EVERY PAGE (2026-10-03) ─────────────────────────────
   The public header's links, the sidebar's and the footer's Products and
   Resources were drawn only by the script, into elements every page was
   served empty: a reader, a crawler or a link preview that runs no script
   saw "Products" and "Resources" with no link under either. The markup is
   now made by the app's own NAV_MARKUP (35-ui.js) — the functions buildShell
   draws with, over PRODUCTS, RESOURCES and the sidebar's tables — cut out of
   src/js and run here against a document that records what is made, the way
   the router is run above. So the links a page is served are the links its
   script draws in their place, from the same tables, with no second list to
   fall out of step; Business Intelligence, which has no path, is text in
   both. The phone's sheet is not served (NAV_MARKUP says why).

   The page's own current item — the header link, the Resources menu, the
   sidebar item buildNav marks once the page is drawn — is marked as the
   page's render marked it (prerender/manifest.json), so the served header is
   the drawn one; a page with no render committed is served unmarked. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/* As a browser serialises: an attribute escapes &, " and the no-break space;
   text escapes &, <, > and the no-break space. */
const serialAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
const serialText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
/* Just enough of a document for el() (00-core.js): elements with ordered
   attributes, dataset, className, hidden, innerHTML (kept as the markup it
   was given — an icon's SVG), text, append, and listeners that are never
   called. Anything else el() or a NAV_MARKUP function reaches for throws,
   so a change that needs more of the DOM stops the build by name. */
function markupDocument() {
  const text = (t) => ({ nodeType: 3, data: String(t), get outerHTML() { return serialText(this.data); } });
  const raw = (h) => ({ nodeType: 1, raw: true, get outerHTML() { return String(h); } });
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const element = (tag) => {
    const attrs = new Map();
    let kids = [];
    const node = {
      nodeType: 1, localName: String(tag).toLowerCase(), attrs,
      get children() { return kids.filter(k => k.nodeType === 1 && !k.raw); },
      setAttribute: (k, v) => { attrs.set(String(k), String(v)); },
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => { attrs.delete(k); },
      toggleAttribute: (k, on) => { if (on ?? !attrs.has(k)) attrs.set(k, ''); else attrs.delete(k); },
      append: (...xs) => { for (const x of xs) kids.push(typeof x === 'string' ? text(x) : x); },
      addEventListener() {},
      set className(v) { attrs.set('class', String(v)); },
      get className() { return attrs.get('class') || ''; },
      set hidden(v) { if (v) attrs.set('hidden', ''); else attrs.delete('hidden'); },
      get hidden() { return attrs.has('hidden'); },
      set innerHTML(h) { kids = h === '' ? [] : [raw(h)]; },
      get innerHTML() { return kids.map(k => k.outerHTML).join(''); },
      set textContent(t) { kids = t === '' ? [] : [text(t)]; },
      get outerHTML() {
        const a = [...attrs].map(([k, v]) => ` ${k}="${serialAttr(v)}"`).join('');
        return VOID.has(node.localName) ? `<${node.localName}${a}>` : `<${node.localName}${a}>${node.innerHTML}</${node.localName}>`;
      },
    };
    node.dataset = new Proxy({}, {
      set: (_, k, v) => { attrs.set(`data-${kebab(String(k))}`, String(v)); return true; },
      get: (_, k) => attrs.get(`data-${kebab(String(k))}`),
    });
    return node;
  };
  return { createElement: element, createTextNode: text };
}
/* Every element of a tree, in document order. */
const walk = (n, out = []) => { if (n?.nodeType === 1 && !n.raw) { out.push(n); n.children.forEach(k => walk(k, out)); } return out; };
/* The four lists the page is served with, each with what the template
   carries empty around it. */
export const NAV_SLOTS = {
  pubnav:        ['<nav class="pubnav" id="pubnav" aria-label="Primary">', '</nav>'],
  appnav:        ['<nav class="sb-nav" id="appnav" aria-label="Primary">', '</nav>'],
  footProducts:  ['<ul id="footProducts">', '</ul>'],
  footResources: ['<ul id="footResources">', '</ul>'],
};
export function navMarkup() {
  const CORE = js('00-core.js'), UI = js('35-ui.js');
  const ctx = vm.createContext({ document: markupDocument() });
  const api = vm.runInContext([
    "const BASE = '';",
    cut(CORE, '00-core.js', 'const el = ', '\n};\n'),
    cut(UI, '35-ui.js', 'const ICON = {', '\n};'),
    cut(UI, '35-ui.js', 'const icon = ', ';\n'),
    cut(UI, '35-ui.js', 'const href = ', ';\n'),
    cut(UI, '35-ui.js', 'const PRODUCTS = [', '\n];'),
    cut(UI, '35-ui.js', 'const PRODUCT_STATUS = ', ';\n'),
    cut(UI, '35-ui.js', 'const SHOW_UNBUILT = ', ';\n'),
    cut(UI, '35-ui.js', 'const SHOW_REPORTS = ', ';\n'),
    cut(UI, '35-ui.js', 'const productById = ', ';\n'),
    cut(UI, '35-ui.js', 'function productBadge(', '\n}\n'),
    cut(UI, '35-ui.js', 'const productNote = ', ';\n'),
    cut(UI, '35-ui.js', 'const RESOURCES = [', '\n];'),
    cut(UI, '35-ui.js', 'const APP_NAV_WORKSPACE = [', '\n];'),
    cut(UI, '35-ui.js', 'const APP_NAV_FOOT = [', '\n];'),
    cut(UI, '35-ui.js', 'const PRODUCT_ICON = ', ';\n'),
    cut(UI, '35-ui.js', 'const shellLink = ', ';\n'),
    cut(UI, '35-ui.js', 'const shellIcon = ', ';\n'),
    cut(UI, '35-ui.js', 'function productRows(', '\n}\n'),
    cut(UI, '35-ui.js', 'const productsLegendLink = ', ';\n'),
    cut(UI, '35-ui.js', 'function resourceLists(', '\n}\n'),
    cut(UI, '35-ui.js', 'function pubMenu(', '\n}\n'),
    cut(UI, '35-ui.js', 'function sidebarItem(', '\n}\n'),
    cut(UI, '35-ui.js', 'const NAV_MARKUP = {', '\n};'),
    '({ NAV_MARKUP, PRODUCTS })',
  ].join('\n'), ctx, { filename: 'src/js (navigation)' });
  /* Business Intelligence is never a link, wherever it is drawn: a product
     with no path is text (productRows, NAV_MARKUP). Held here as well, so a
     table that gave it a path, or a list that drew it as a link anyway,
     stops the build rather than serving a link to nothing. */
  const unbuilt = api.PRODUCTS.filter(p => !p.path).map(p => p.name);
  /* marks: what buildNav marked on the page's render — the indices of the
     current links among #pubnav's and #appnav's links, in document order,
     and the Resources menu's mark — or null for none. */
  /* chrome: the chrome the page is served in (servedChrome, below). The
     other chrome's list is served empty — its header is hidden, after the
     page — and the app draws it when the reader enters that chrome
     (buildShell, 35-ui.js; plan item 3.5). */
  return (marks = null, chrome = 'public') => {
    const pubnav = api.NAV_MARKUP.pubnav(), appnav = [...api.NAV_MARKUP.appnav()];
    const footProducts = [...api.NAV_MARKUP.footProducts()], footResources = [...api.NAV_MARKUP.footResources()];
    if (marks) {
      const mark = (roots, at, where) => {
        const links = roots.flatMap(r => walk(r)).filter(n => n.localName === 'a');
        for (const i of at || []) {
          if (!links[i]) throw new Error(`prerender/manifest.json marks link ${i} of ${where}, which has ${links.length} — run node prerender.mjs`);
          links[i].setAttribute('aria-current', 'page');
        }
      };
      if (chrome !== 'app') mark([pubnav], marks.pubnav, '#pubnav');
      if (chrome === 'app') mark(appnav, marks.appnav, '#appnav');
      if (marks.resources && chrome !== 'app') {
        const btn = walk(pubnav).find(n => n.getAttribute('id') === 'menuResourcesBtn');
        if (!btn) throw new Error('the public header has no Resources menu to mark');
        btn.toggleAttribute('data-current', true);
        btn.setAttribute('aria-description', marks.resources);
      }
    }
    const out = {
      pubnav: chrome === 'app' ? '' : pubnav.outerHTML,
      appnav: chrome === 'app' ? appnav.map(n => n.outerHTML).join('') : '',
      footProducts: footProducts.map(n => n.outerHTML).join(''),
      footResources: footResources.map(n => n.outerHTML).join(''),
    };
    for (const [slot, html] of Object.entries(out)) {
      if (!html && (slot === 'pubnav' || slot === 'appnav')) continue;
      if (!/<a\b[^>]*\bhref="\/[^"]*"/.test(html)) throw new Error(`the ${slot} the page is served carries no link`);
      for (const name of unbuilt) {
        const asLink = new RegExp(`<a\\b[^>]*>(?:(?!</a>)[\\s\\S])*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        if (asLink.test(html)) throw new Error(`${name} is drawn as a link in the ${slot} — a product that is not built is text`);
      }
    }
    return out;
  };
}
/* ─── PAGE CONTENT FIRST IN THE SERVED TEXT (plan item 3.5, 2026-10-07) ────────
   A fetcher that keeps the start of a page, or reads it as text in source
   order, read every page's two headers, the sidebar's "My Dashboard" and
   "Saved Models", and the template's notes to its maintainers before the
   page: <div id="views"> stood at byte 30,000–34,000 of every page. Each page
   is served
   - without the template's HTML comments (they stay in src/, for whoever
     edits the template; a page carries none);
   - with the chrome it is drawn in first and the rest after its </main>:
     a public page (and a page with no render, which a first frame draws in
     the public header) is served the app's bar and sidebar after the page,
     hidden, its sidebar's list empty; an app page its sidebar after the
     page — fixed beside it from 1024px and a closed drawer below, so
     nothing it shows moves — and the public header after that, hidden, its
     list empty. The app puts each back in the template's order, and draws
     both lists, the moment its script runs (buildShell, 35-ui.js).
   So <div id="views"> is within the first SERVED_VIEWS_BYTES of every page
   (--check and served-check hold it), and a text extraction of / reaches
   its h1 before any of the workspace's navigation. */
export const SERVED_VIEWS_BYTES = 16 * 1024;
export const CHROME_PARTS = {
  pubbar:  ['<header class="topbar pubbar" id="pubbar">', '<div class="pubscrim" id="pubScrim" hidden></div>\n'],
  appbar:  ['<header class="topbar appbar" id="appbar">', '</header>\n'],
  sidebar: ['<aside class="sidebar" id="sidebar" aria-label="Workspace">', '<div class="navscrim" id="navScrim" hidden></div>\n'],
};
const STRIP_AT = '<div class="disclosure" role="region" aria-label="Disclosure">';
const MAIN_END = '\n</main>\n';
/* The parts out of a page, wherever they stand, and the page without them. */
function takeChrome(html) {
  const parts = {};
  for (const [k, [open, close]] of Object.entries(CHROME_PARTS)) {
    const i = html.indexOf(open.slice(0, -1));
    const j = i < 0 ? -1 : html.indexOf(close, i);
    if (i < 0 || j < 0) throw new Error(`the page carries no ${k} (${open}) to place`);
    parts[k] = html.slice(i, j + close.length);
    html = html.slice(0, i) + html.slice(j + close.length);
  }
  return { html, parts };
}
const awayTag = (part, open, how) => part.replace(open, () => `${open.slice(0, -1)}${how === 'hidden' ? ' hidden' : ''} data-served-away="${how}">`);
export function servedChrome(html, chrome) {
  const { html: rest, parts } = takeChrome(html);
  const before = chrome === 'app' ? [parts.appbar] : [parts.pubbar];
  const after = chrome === 'app'
    ? [awayTag(parts.sidebar, CHROME_PARTS.sidebar[0], ''), awayTag(parts.pubbar, CHROME_PARTS.pubbar[0], 'hidden')]
    : [awayTag(parts.appbar, CHROME_PARTS.appbar[0], 'hidden'), awayTag(parts.sidebar, CHROME_PARTS.sidebar[0], 'hidden')];
  const s = rest.indexOf(STRIP_AT), m = rest.indexOf(MAIN_END, s);
  if (s < 0 || m < 0) throw new Error('the page carries no strip, or no </main> after it, to place its chrome around');
  return rest.slice(0, s) + before.join('') + rest.slice(s, m + MAIN_END.length) + after.join('') + rest.slice(m + MAIN_END.length);
}
/* The page as the template orders it: what served-check compares. */
export function unservedChrome(html) {
  const { html: rest, parts } = takeChrome(html);
  const back = (part, open) => part.replace(new RegExp(`${open.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: hidden)? data-served-away="[^"]*">`), () => open);
  const s = rest.indexOf(STRIP_AT);
  if (s < 0) throw new Error('the page carries no strip to put its chrome before');
  return rest.slice(0, s) + Object.entries(CHROME_PARTS).map(([k, [open]]) => back(parts[k], open)).join('') + rest.slice(s);
}
/* The template as every page is made from it: its comments out, and the
   positioning copy written in from the one table (POSITIONING, 35-ui.js). */
export const POSITIONING_SLOTS = { '@POSITIONING_KICKER': 'kicker', '@POSITIONING_ONE_LINER': 'oneLiner' };
export function servedTemplate(template, P) {
  let t = template.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n/gm, '');
  if (/<!--/.test(t)) throw new Error('the template carries an HTML comment that does not stand on lines of its own — the build takes comments out of every page by whole lines');
  for (const [slot, key] of Object.entries(POSITIONING_SLOTS)) {
    if (t.split(slot).length !== 2) throw new Error(`the template carries ${t.split(slot).length - 1} of ${slot}, where the build writes POSITIONING.${key} exactly once`);
    if (!P || typeof P[key] !== 'string' || !P[key]) throw new Error(`POSITIONING.${key} (35-ui.js) is not a string`);
    const v = key === 'kicker'
      ? P.kicker.split(' · ').map((w, i) => (i ? ` <i${i === 2 ? ' class="amber"' : ''}>·</i> ` : '') + escText(w)).join('')
      : escText(P[key]);
    t = t.replace(slot, () => v);
  }
  return t;
}

/* The served lists, put where the template carries each empty. */
export function withNav(html, nav) {
  for (const [slot, [open, close]] of Object.entries(NAV_SLOTS)) {
    const at = html.split(open + close).length - 1;
    if (at !== 1) throw new Error(`the page carries ${at} of ${open}${close}, where the build fills exactly one`);
    html = html.replace(open + close, () => open + nav[slot] + close);
  }
  return html;
}

/* ─── THE PAGE ITSELF, IN THE PAGE (2026-10-03) ──────────────────────────────
   Every page above was its head and an empty <main>: a fetch that runs no
   script — a crawler that does not render, a link preview, an assistant, an
   auditor's curl — read the same header, strapline and footer disclosure at
   every address, and nothing of the page. The app drew each page into
   <div id="views"> only once its script ran.

   prerender.mjs renders each page in Chrome against a clean copy of the site
   — the app's own render, the personal lane blocked — and commits what it
   drew into #views, and the product's tab row above it, under prerender/,
   with a manifest of how each was drawn. Here, with no browser, each is put
   into its page:

     <html data-chrome>   the chrome the page wears (chromeOf), so the frame
                          before the script shows the page in its own header
                          and column, footer and disclosure where they end up
     #productTabs         the tab row, shown, where the page has one
     #views data-served   the page; the script replaces it with the same page
                          drawn live (drawPage, 35-ui.js)

   for every page written for a static route — index.html for / — but My
   Workspace's (pages/my/: one reader's own, robots-disallowed, where a fresh
   visitor sees only sample data). Not the 404 page, the parameter routes'
   page, or a company's: those are served as before. --check fails if a page
   does not carry its committed render exactly, if one is missing, or if one
   is left for a page that no longer has a route; prerender.mjs --check says
   whether a render is still the app's. */
const PRERENDER = 'prerender';
const MANIFEST = `${PRERENDER}/manifest.json`;
/* The page every parameter route is served (/company/:id …): the site root's
   head and the app, with no page in it, because which page it is waits for
   the router. It was index.html, which now carries the homepage. A name no
   route can have (a route's segments are letters, digits and hyphens), so no
   route's page can be written over it. */
export const GENERIC = `${PAGES}/generic.app.html`;
/* THE SITE ROOT, SERVED LIKE EVERY OTHER PAGE (plan item 1.2; the owner's
   decision D2 of 5 Oct 2026). / was index.html: the app's 3.5MB script and
   its stylesheet inline, so its h1 sat at byte 309,867. A fetcher that keeps
   the first 32–256kB (an assistant, an auditor's tool, a link preview) read
   the head and none of the page. And a browser downloaded the whole app again
   on every visit to /, cached for no other page. / is now this page: index.html
   linked (linked(), below), its render and everything else the same, loading
   the two app files every other page loads. A name no route can have, like
   GENERIC.
   index.html stays, whole, for the tools that read the engine and the CSP
   hash out of it (scanner/scan.mjs, ingest/, syntax.mjs, the harnesses).
   It is kept off the host two ways:
   - .vercelignore drops /index.html from the deployment. Vercel serves a
     file before any rewrite ("precedence is given to the filesystem prior
     to rewrites"), so with index.html deployed, / would still be index.html
     and the rewrite of / to this page would never be reached;
   - a redirect sends /index.html to / (308). Redirects come before the
     file system, so this holds whether .vercelignore is honoured or not.
   If a host did not honour .vercelignore, / would be index.html as before:
   the app inline, its hash still in the CSP, so the page still works.
   served-check fails it ("/ is not served the home page").
   serve.mjs honours .vercelignore as Vercel does, so every harness is
   served what Vercel serves. */
export const HOME = `${PAGES}/home.app.html`;
/* Where the site root's page must say what it is: the app's script tag and
   the page's #views within the first 32kB, the page's text with its h1 within
   the first 64kB (plan item 1.2's acceptance). The build fails past either. */
export const HOME_HEAD_BYTES = 32 * 1024;
export const HOME_TEXT_BYTES = 64 * 1024;
/* HTML as a fetcher's text conversion reads it: scripts, styles and tags
   out, the common entities decoded, white space as one space. */
export const pageText = (html) => String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?(<\/\1>|$)/gi, ' ').replace(/<[^>]*>?/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
/* The pages written for the static routes: the site root's index.html, then
   one file per head — routes whose heads are identical (the wheel's five
   aliases) share one, named after the route among them that is its own
   canonical address, else after the first. */
export function routePages(plan) {
  const groups = new Map();
  for (const p of plan.pages) {
    if (p.path === '/') continue;
    /* My Workspace's addresses never share a page with any other (2026-10-04):
       /my/wheel and /my/options had the wheel's head, so they were served
       pages/us-options/wheel.html — and with it the wheel's render, as
       /my/scanner was the Scanner's dashboard's, where no /my/ address is to
       carry one (prerenderScope). A page of their own, the same head. An
       alias of one of My Workspace's pages (/app/watchlists) is its. */
    const key = JSON.stringify(p.head) + (myWorkspace(p) ? ' my' : '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const root = plan.pages.find(p => p.path === '/');
  return [{ file: 'index.html', named: root, routes: [root] },
    ...[...groups.values()].map(group => {
      const named = group.find(p => plan.origin + p.path === p.head.canonical) || group[0];
      return { file: `${PAGES}${named.path}.html`, named, routes: group };
    })];
}
/* My Workspace's: an address under /my/, or one whose canonical address is
   (an alias of such a page). */
export const myWorkspace = (p) => p.path.startsWith('/my/') || new URL(p.head.canonical).pathname.startsWith('/my/');
/* Which pages carry a render, and where each render is committed: none of
   My Workspace's, by every address a page answers, not by its file name. */
export function prerenderScope(plan) {
  return routePages(plan).filter(p => !p.file.startsWith(`${PAGES}/my/`) && !p.routes.some(myWorkspace)).map(({ file, named }) => {
    const stem = file === 'index.html' ? 'index' : file.slice(PAGES.length + 1, -'.html'.length);
    return { file, path: named.path, view: named.view, render: `${PRERENDER}/${stem}.html`, tabs: `${PRERENDER}/${stem}.tabs.html` };
  });
}
/* A RENDER IS WRITTEN ONLY BY prerender.mjs (2026-10-04). A render edited by
   hand — a link pointed elsewhere, a heading's level changed, a figure or a
   symbol written into an attribute or a chart — was put into its page and
   passed --check, and nothing before a commit looked at what a render says.
   prerender.mjs records a digest of each render it writes (the manifest's
   "digest"), and a render whose files are not what it wrote is "edited":
   --check fails on it, as served-check does, and a build says so. */
export const renderDigest = (views, tabs) => createHash('sha256').update(`${views}\u0000${tabs ?? ''}`, 'utf8').digest('hex').slice(0, 16);
/* The committed renders: the manifest, and each page's #views and tab row. */
export function readRenders(scope) {
  const manifest = existsSync(join(ROOT, MANIFEST)) ? JSON.parse(lf(readFileSync(join(ROOT, MANIFEST), 'utf8'))) : null;
  const renders = new Map(), missing = [], edited = [];
  for (const s of scope) {
    const m = manifest?.pages?.[s.file];
    const has = existsSync(join(ROOT, s.render));
    if (!m || !has) { missing.push(`${s.file} (${s.path}): ${!m ? `no entry in ${MANIFEST}` : `no ${s.render}`}`); continue; }
    if (m.path !== s.path) { missing.push(`${s.file}: ${MANIFEST} has it rendered at ${m.path}, not ${s.path}`); continue; }
    /* Each file ends with the one newline prerender.mjs writes, which is
       not part of the render. */
    const read = (f) => lf(readFileSync(join(ROOT, f), 'utf8')).replace(/\n$/, '');
    const views = read(s.render);
    const tabs = m.tabs ? (existsSync(join(ROOT, s.tabs)) ? read(s.tabs) : null) : null;
    if (m.tabs && tabs === null) { missing.push(`${s.file}: ${MANIFEST} says it has a tab row, and ${s.tabs} is not there`); continue; }
    if (m.digest !== renderDigest(views, tabs)) edited.push(`${s.render}${tabs !== null ? ` and ${s.tabs}` : ''} (${s.path}) are not what prerender.mjs wrote (${m.digest ? 'the digest in' : 'no digest in'} ${MANIFEST}) — a render is written only by node prerender.mjs`);
    renders.set(s.file, { ...s, tabsFile: s.tabs, manifest: m, views, tabs, drawn: manifest.drawn || null });
  }
  /* What is under prerender/ that no page in scope reads. */
  const want = new Set([MANIFEST, ...[...renders.values()].flatMap(r => [r.render, ...(r.tabs !== null ? [r.tabsFile] : [])])]);
  const extra = filesUnder(PRERENDER).filter(f => !want.has(f));
  const unknown = Object.keys(manifest?.pages || {}).filter(f => !scope.some(s => s.file === f));
  return { manifest, renders, missing, edited, extra, unknown };
}
/* The render put into its page. Each place is the template's own, exactly
   once; the render may carry no script and no stylesheet of its own. */
export function withRender(html, r) {
  const put = (from, to, what) => {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`the page carries ${n} of ${from}, where the build puts ${what} exactly once`);
    html = html.replace(from, () => to);
  };
  for (const [part, body] of [['#views', r.views], ['#productTabs', r.tabs || '']]) {
    if (/<script[\s>]|<style[\s>]|<link\b/i.test(body)) throw new Error(`${r.render}: its ${part} carries a <script>, <style> or <link>, which a render may not`);
  }
  const chrome = r.manifest.chrome;
  if (chrome !== 'public' && chrome !== 'app') throw new Error(`${r.file}: ${MANIFEST} gives its chrome as ${JSON.stringify(chrome)}`);
  /* data-served: the page before its script has run, which the script takes
     off as it starts (buildShell, 35-ui.js) — the stylesheet lays the page's
     size containers out by the window until then (styles.css, prerender).
     data-served-reads: what the render's draw read, for the head's script
     (BEFORE THE FIRST PAINT, below). */
  put('<html lang="en">', servedHtmlTag(r), 'the chrome');
  if (r.tabs) put('<div class="ptabs-host" id="productTabs" hidden></div>', `<div class="ptabs-host" id="productTabs">${r.tabs}</div>`, 'the tab row');
  put('<div id="views"></div>', `<div id="views" data-served="${escAttr(r.path)}">${r.views}</div>`, 'the page');
  return html;
}

/* ─── THE RESULT, SERVED (N1c–N1e, the 5 Oct audit; D16) ─────────────────────
   /status said whether the tools work only once its script had fetched
   health/journeys.json: served, its journeys block read "Read from the site
   by this page's script." and listed nothing, so a fetch of the page — a
   crawler, a link preview, an auditor's curl — read no result, no time and
   no commit. A render cannot carry the record (it is drawn ahead of time,
   with every request held), so the build writes it in: the committed
   health/journeys.json, through journeys.mjs's one renderer
   (journeysServed), into /status's #health-journeys-sum and
   #health-journeys, and into the one line beside the product's badge on
   /property, /research and /app/scanner (ISLAND_PAGES) — the page's own
   slots, drawn empty by the app with data-now and so served by the render
   as placeholders. The renders are untouched (prerender --check compares
   them, and the app's drawing, as they were); --check reproduces the pages
   from the committed record; served-check and coverage-frames read what a
   page serves through this same function. The journeys workflow commits the
   record and these pages together, rebuilt (journeys.yml). */
export function readRecord(root = ROOT) {
  const f = join(root, RECORD_FILE);
  if (!existsSync(f)) return null;
  try { return JSON.parse(lf(readFileSync(f, 'utf8'))); }
  catch { throw new Error(`${RECORD_FILE} is not JSON — the served /status and product pages cannot carry it`); }
}
/* A Live badge's result slot on /status, as the render serves it, and the
   journey and step its attributes name (unescaped as the serializer escaped
   them). */
const PROOF_SLOT_G = /(<span class="proof-result"[^>]*\bdata-now=""[^>]*>)(<\/span>)/g;
export function proofSlotOf(open) {
  const attr = (n) => { const m = new RegExp(`\\b${n}="([^"]*)"`).exec(open); return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') : null; };
  const journey = attr('data-proof-journey'), step = attr('data-proof-step');
  return journey && step ? { journey, step } : null;
}
/* A render's #views as its page serves it: the record in its slots. Only an
   island page's render changes; each slot exactly once, or the build fails. */
export function withServedRecord(r, served) {
  if (!ISLAND_PAGES.includes(r.file)) return r.views;
  let views = r.views;
  const put = (re, inner, what) => {
    const n = (views.match(new RegExp(re.source, 'g')) || []).length;
    if (n !== 1) throw new Error(`${r.render} (${r.path}) carries ${n} of ${what}, where the build writes the recorded journeys exactly once — run node prerender.mjs, then node build.mjs`);
    views = views.replace(re, (all, open, close) => open + inner + close);
  };
  if (r.path === '/status') {
    put(/(<p class="metaline" id="health-journeys-sum"[^>]*>)[^<]*(<\/p>)/, served.sum, '#health-journeys-sum');
    put(/(<ul id="health-journeys" [^>]*\bdata-now=""[^>]*>)(<\/ul>)/, served.list, 'an empty #health-journeys marked data-now');
    /* Each Live badge's last result (D15, plan item 2.6; proofSection,
       91-health.js): every .proof-result slot, drawn empty and marked
       data-now, gets journeysServed's proof for the journey and the step
       its attributes name. One slot a proven badge, at least one. */
    const slots = views.match(PROOF_SLOT_G) || [];
    if (!slots.length) throw new Error(`${r.render} (${r.path}) carries no empty .proof-result slot marked data-now, where the build writes each Live badge's result — run node prerender.mjs, then node build.mjs`);
    views = views.replace(PROOF_SLOT_G, (all, open, close) => {
      const a = proofSlotOf(open);
      if (!a) throw new Error(`${r.render} (${r.path}): a .proof-result slot names no journey and step: ${open}`);
      return open + served.proof(a.journey, a.step) + close;
    });
  } else {
    if (!Object.hasOwn(served.lines, r.path)) throw new Error(`${r.file} is an island page, and journeysServed draws no line for ${r.path}`);
    put(new RegExp(`(<p class="journey-line"[^>]*\\bdata-journey="${r.path.replace(/[/.]/g, '\\$&')}"[^>]*>)(</p>)`), served.lines[r.path], `the journey line for ${r.path}`);
  }
  return views;
}

/* ─── BEFORE THE FIRST PAINT ──────────────────────────────────────────────────
   (2026-10-04, the integration's final verification.) A served page is a
   fresh visitor's, drawn in Kuala Lumpur, and it stood for every reader until
   the app's script came down — after a deploy, seconds even for a returning
   reader: "No properties saved yet" over their saved property, the sample
   deal's figures on the calculator, "0 of 4 done" on their own dashboard,
   totals in ringgit to a reader whose page is in dollars, and every page in
   the light theme for one who chose the dark. Every page build.mjs writes
   carries one small script in its head (FIRST_SCRIPT), which runs before the
   first paint, the same bytes on every page so the CSP names it by one hash:
   - it applies the theme this browser keeps, as applyTheme (95-boot.js)
     does, so a dark choice never paints light;
   - on a page with a render, where the render's draw read something this
     reader holds otherwise, it marks the page data-served-hidden, and the
     served #views is out of sight, out of the tab order and out of the
     accessibility tree (styles.css, integration-final) — the page as it was
     before pages were served — until the app draws the reader's own.
   What the render read is on <html> as data-served-reads (servedReadsOf),
   taken from its data-drawn-from (SERVED_READS, 35-ui.js — the one table,
   for the pages that wait and those that do not): a name this browser keeps
   with the render's digest of it, which the script holds to the app's own
   digest of the reader's (servedReads, keepServedReads); the base currency
   with the render's (defaultCcy, from the manifest's time zone and locale),
   which the script holds to the reader's kept one or their own default; the
   product whose Start here panel the render shows; and, on a page that waits
   for the filings, the owner's machine. What the address says is left to the
   app. A reader with no script, and a fresh visitor in Malaysia, get the
   whole page as served. */
/* The base currency of a browser that keeps none: ringgit where its time
   zone or language is Malaysia's, dollars otherwise — State.baseCcy's rule
   (05-plans.js), for the render's (servedReadsOf, which holds it to the
   render's own digest) and for the head's script.
   THE TWO RULES PARTED (2026-10-04, the integration's re-verification). The
   app's held a backspace (U+0008) where \b was typed — a shell had eaten the
   backslash — so its language branch never matched, while this one read
   /-MY/: a reader in Singapore or London whose language is en-MY or ms-MY was
   shown the ringgit page by the head's script, then the skeleton, then the
   app's dollar page. The same rule here and there, /-MY\b/; no source file
   may carry a control character (sourceControls, below); and coverage-frames
   holds State.baseCcy to this script's choice for readers in five zones and
   languages (integration-reverify). */
export function defaultCcy(tz, langs) {
  return tz === 'Asia/Kuala_Lumpur' || tz === 'Asia/Kuching' || /-MY\b/i.test(langs) ? 'MYR' : 'USD';
}
/* servedHash (35-ui.js): FNV-1a, 32 bits — a digest that names a value. */
export const servedHash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
/* IF THE APP NEVER COMES (2026-10-04, the integration's re-verification). A
   page kept out of sight waits for the app to draw the reader's own — and
   when the app's script failed to load (a dropped connection on a phone, a
   blocker, a page cached from before a deploy whose script is gone) or never
   came, the reader had the header and an empty page for good, where with no
   script at all they have the whole page. So the script, on hiding the
   page, also watches for the app:
   - the app's script fails to load, or stops with an error before it has
     drawn the page: the served page is shown at once;
   - the app has not started (its first act, buildShell, takes data-served
     off <html>) SERVED_WAIT_MS after the head was read: shown then.
   Never over an app that has started: once it runs the page is its to draw,
   and a reader whose app is on time, or slow only for its data (the
   skeleton, then their page), never sees the served one. 8 seconds: the
   script is 0.8MB as served (brotli) and 3.5MB to parse — about 5s on a
   1.6Mbps line and a mid-range phone — so 8s passes for a stalled or blocked
   script, not a slow one, short of a line under 1Mbps, where the served page
   comes first and the app then draws the reader's over it (the skeleton
   between, as before pages were served). */
export const SERVED_WAIT_MS = 8000;
export const FIRST_SCRIPT = `(function () {
var d = document.documentElement, s = null;
try { s = window.localStorage; } catch (e) { s = null; }
function raw(k) { try { return s ? s.getItem('vl.' + k) : null; } catch (e) { return null; } }
function val(k) { try { return JSON.parse(raw(k)); } catch (e) { return null; } }
var theme = val('theme');
if (theme === 'dark' || theme === 'light') d.setAttribute('data-theme', theme);
var reads = d.getAttribute('data-served-reads');
if (!reads) return;
function hash(t) { var h = 0x811c9dc5; for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return ('0000000' + (h >>> 0).toString(16)).slice(-8); }
var kept = val('servedReads'), own = kept && kept.v === 1 && kept.d && typeof kept.d === 'object' ? kept.d : {};
var list = reads.split(' ');
for (var i = 0; i < list.length; i++) {
  var at = list[i].indexOf(':'), name = list[i].slice(0, at), was = list[i].slice(at + 1), mine;
  if (name === 'ownerMachine') mine = !/^(localhost|127\\.0\\.0\\.1|\\[::1\\]|::1)$/.test(location.hostname);
  else if (name === 'baseCcy') {
    var c = val('baseCcy'), tz = '';
    if (typeof c !== 'string') {
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
      c = (${defaultCcy})(tz, [navigator.language].concat(navigator.languages || []).join(' '));
    }
    mine = c === was;
  } else if (name === 'startHere') { var h = val('startHere'); mine = !(h && typeof h === 'object' && h[was]); }
  else { var r = raw(name), e = own[name]; mine = r === null || (!!e && e[0] === hash(r) && e[1] === was); }
  if (!mine) { d.setAttribute('data-served-hidden', ''); break; }
}
if (!d.hasAttribute('data-served-hidden')) return;
function served() { var v = document.getElementById('views'); return !!v && v.hasAttribute('data-served'); }
function app(u) { return /\\/assets\\/app\\.[0-9a-f]+\\.js(?:[?#]|$)/.test(String(u || '')); }
function show() { d.removeAttribute('data-served-hidden'); }
addEventListener('error', function (e) {
  var t = e.target;
  if ((t && t.tagName === 'SCRIPT' ? app(t.src) : app(e.filename)) && served()) show();
}, true);
setTimeout(function () { if (d.hasAttribute('data-served') && served()) show(); }, ${SERVED_WAIT_MS});
})();`;
export const FIRST_TAG = `<script data-first-paint>${FIRST_SCRIPT}</script>`;
export const firstHash = () => 'sha256-' + createHash('sha256').update(FIRST_SCRIPT, 'utf8').digest('base64');
/* Into the head, before anything that loads: straight after the viewport. */
const FIRST_AFTER = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
export function withFirst(html) {
  const n = html.split(FIRST_AFTER).length - 1;
  if (n !== 1) throw new Error(`the page carries ${n} of the viewport tag the first-paint script follows, where the build puts it exactly once`);
  return html.replace(FIRST_AFTER, () => `${FIRST_AFTER}${FIRST_TAG}\n`);
}
/* What a render's draw read, as the head's script reads it: from the render's
   data-drawn-from, the names it keeps with their digests; the base currency
   as the render's (held here to the render's own digest of it, so this rule
   and the app's cannot part); the product whose Start here panel the render
   shows (held likewise); the owner's machine, on a page that waits; and
   nothing of the address (?tab=, ?saved=…), which the app reads. Null where
   the render names nothing. */
export function servedReadsOf(views, { waits, drawn, render = 'the render' }) {
  const m = /^<section\b[^>]*\bdata-drawn-from="([^"]*)"/.exec(views);
  if (!m) return null;
  const panel = /<[a-z]+\b[^>]*\bclass="start-here(?: [^"]*)?"[^>]*\bdata-product="([a-z-]+)"/.exec(views)?.[1] || null;
  const ccy = defaultCcy(drawn?.timeZone, drawn?.locale);
  const out = [];
  for (const pair of m[1].split(' ').filter(Boolean)) {
    const at = pair.indexOf(':'), name = pair.slice(0, at), digest = pair.slice(at + 1);
    if (name === 'discoverTab' || name.startsWith('?')) continue;
    if (name === 'ownerMachine') { if (waits) out.push('ownerMachine:'); continue; }
    if (name === 'baseCcy') {
      if (digest !== servedHash(JSON.stringify(ccy))) throw new Error(`${render}: drawn in ${drawn?.timeZone} (${drawn?.locale}), its base currency is not ${ccy} — defaultCcy (build.mjs) and State.baseCcy (05-plans.js) part`);
      out.push(`baseCcy:${ccy}`); continue;
    }
    if (name === 'startHere') {
      if (digest !== servedHash(JSON.stringify(panel))) throw new Error(`${render}: its Start here panel is ${JSON.stringify(panel)}, where its draw read ${digest}`);
      if (panel) out.push(`startHere:${panel}`);
      continue;
    }
    out.push(pair);
  }
  return out.join(' ') || null;
}
/* The <html> a page with a render is served with. */
export function servedHtmlTag(r) {
  const reads = servedReadsOf(r.views, { waits: r.manifest.state === 'filings in', drawn: r.drawn, render: r.render });
  return `<html lang="en" data-chrome="${r.manifest.chrome}" data-served${reads ? ` data-served-reads="${escAttr(reads)}"` : ''}>`;
}

/* ─── THE HEAD, REWRITTEN ────────────────────────────────────────────────────
   Eight tags, each of which the template carries exactly once in its <head>;
   if one goes missing or appears twice the build fails, rather than shipping
   a page with two titles or none. og:/twitter: repeat the route's title,
   description and canonical: a link preview says what the page says. */
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const TAG = {
  title:        /<title>[^<]*<\/title>/,
  description:  /<meta name="description" content="[^"]*">/,
  canonical:    /<link rel="canonical" href="[^"]*">/,
  ogUrl:        /<meta property="og:url" content="[^"]*">\n?/,
  ogTitle:      /<meta property="og:title" content="[^"]*">/,
  ogDesc:       /<meta property="og:description" content="[^"]*">/,
  twTitle:      /<meta name="twitter:title" content="[^"]*">/,
  twDesc:       /<meta name="twitter:description" content="[^"]*">/,
};
export function withHead(html, head, { notFound = false } = {}) {
  const end = html.indexOf('</head>');
  if (end < 0) throw new Error('the page has no </head>');
  let top = html.slice(0, end);
  const put = (re, text) => {
    const n = (top.match(new RegExp(re.source, 'g')) || []).length;
    if (n !== 1) throw new Error(`the template's <head> carries ${n} of ${re.source}, where the build writes exactly one`);
    top = top.replace(re, () => text);
  };
  put(TAG.title, `<title>${escText(head.title)}</title>`);
  put(TAG.description, `<meta name="description" content="${escAttr(head.description)}">`);
  /* A 404 has no address of its own to name: no canonical link and no og:url,
     and it tells a crawler not to index it. The client still writes its own
     canonical once it runs, as it does on every page. */
  /* A page that names itself but asks not to be indexed (a company whose
     figures are illustrative) keeps its canonical and adds the robots tag. */
  put(TAG.canonical, notFound ? '<meta name="robots" content="noindex">'
    : `<link rel="canonical" href="${escAttr(head.canonical)}">${head.noindex ? '\n<meta name="robots" content="noindex">' : ''}`);
  put(TAG.ogUrl, notFound ? '' : `<meta property="og:url" content="${escAttr(head.canonical)}">\n`);
  put(TAG.ogTitle, `<meta property="og:title" content="${escAttr(head.title)}">`);
  put(TAG.ogDesc, `<meta property="og:description" content="${escAttr(head.description)}">`);
  put(TAG.twTitle, `<meta name="twitter:title" content="${escAttr(head.title)}">`);
  put(TAG.twDesc, `<meta name="twitter:description" content="${escAttr(head.description)}">`);
  return top + html.slice(end);
}

/* The inline script exactly as the browser sees it — what the CSP hash names. */
export const inlineScript = (html) => html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
/* And the inline stylesheet: the one <style>, in the template's <head>. */
export const inlineStyle = (html) => { const i = html.indexOf('<style>'); return html.slice(i + 7, html.indexOf('</style>', i)); };

/* The two files every page but index.html loads: index.html's own inline
   script and stylesheet, byte for byte, each at an address named by the
   first 12 hex of its SHA-256. Read out of an assembled index.html, so that
   served-check.mjs asks what the files must be of the index.html it holds. */
export function appFiles(html) {
  const script = inlineScript(html), styles = inlineStyle(html);
  const name = (body, ext) => `${ASSETS}/app.${createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 12)}.${ext}`;
  return { script: { file: name(script, 'js'), body: script }, styles: { file: name(styles, 'css'), body: styles } };
}

/* A page that loads the two files where the shell carries them inline: the
   <style> becomes a <link rel="stylesheet">, and the inline <script> at the
   end of <body> goes. In its place, the app's script is loaded from the head,
   straight after the stylesheet, deferred.
   DEFERRED, IN THE HEAD (plan item 1.2, 2026-10-06). It was a plain <script
   src> where the inline one was, the last thing in <body>: on the site root
   that is byte 53,000 or so, past what a fetcher that keeps the first 32kB
   reads. A deferred script runs where that one did, once the whole document
   is parsed (all that followed it was </body></html>), and after the
   stylesheet, so the app sees the same document as before. It is fetched
   from the head, so it starts downloading while the page is still being
   parsed, and it still never blocks the served page's first paint. Every
   page loads it the same way. index.html keeps its inline script where it
   always was.
   It refuses a page whose inline blocks are not the files' own bytes. */
export const scriptTag = (files) => `<script src="/${files.script.file}" defer></script>`;
export const styleTag = (files) => `<link rel="stylesheet" href="/${files.styles.file}">`;
export function linked(page, files) {
  const head = page.indexOf('</head>'), body = page.indexOf('<body>');
  const s0 = page.indexOf('<style>'), s1 = page.indexOf('</style>', s0);
  const j0 = page.indexOf('<script>'), j1 = page.lastIndexOf('</script>');
  if (s0 < 0 || s1 < 0 || s1 > head) throw new Error('the page has no <style> in its <head> to link');
  if (j0 < body || j1 < j0) throw new Error('the page has no <script> in its <body> to load');
  if (page.slice(s0 + 7, s1) !== files.styles.body) throw new Error("the page's stylesheet is not the app's");
  if (page.slice(j0 + 8, j1) !== files.script.body) throw new Error("the page's script is not the app's");
  /* The inline script's own line goes whole, so no blank line is left. */
  const from = page[j0 - 1] === '\n' ? j0 - 1 : j0;
  return page.slice(0, s0) + `${styleTag(files)}\n${scriptTag(files)}` + page.slice(s1 + 8, from) + page.slice(j1 + 9);
}

/* bare: every page without its render and its chrome — only prerender.mjs
   asks for this, of the clean copy it renders from, so that what it reads
   back is the app's drawing and never a render committed before it. */
export function build({ bare = false } = {}) {
  const source = lf(readFileSync(src('index.template.html'), 'utf8'));
  /* The route table first: it holds the positioning copy the template is
     written with (servedTemplate). */
  const plan = routePlan(source);
  const template = servedTemplate(source, plan.POSITIONING);
  if (!template.includes(STYLE_MARKER)) throw new Error('template lost its style marker');
  if (!template.includes(SCRIPT_MARKER)) throw new Error('template lost its script marker');

  const css = lf(readFileSync(src('styles.css'), 'utf8'));

  /* Filename order IS load order. The numeric prefixes step by 5 so a module can
     be inserted between two others without renumbering the rest. */
  const modules = readdirSync(src('js')).filter(f => f.endsWith('.js')).sort();
  if (!modules.length) throw new Error('no modules in src/js');

  let js = modules.map(f => {
    const body = lf(readFileSync(src('js', f), 'utf8'));
    /* A module that does not end in a newline would weld its last line onto the
       next module's first — a real hazard when the join is plain concatenation. */
    if (!body.endsWith('\n')) throw new Error(`${f} does not end with a newline`);
    return body;
  }).join('');

  /* Replacer FUNCTIONS, not replacement strings. Passing the source text
     directly makes String.replace interpret $$ and $' inside it: the first
     rewrote `const $$ = ...` to `const $ = ...`, and every currency symbol
     literal in the file expanded to the whole tail of the document. The
     build still succeeded and spliced 15 extra lines of `</html>` into the
     middle of fmtMoney. A function replacer substitutes nothing. */
  const napicText = lf(readFileSync(join(ROOT, NAPIC_SOURCE), 'utf8'));
  const napic = napicSlices(napicText);
  const versions = dataVersions(napic);
  if (!js.includes(VERSIONS_MARKER)) throw new Error('src/js lost its data-version marker');
  js = js.replace(VERSIONS_MARKER, () => JSON.stringify(versions));
  /* The journeys' result is drawn in the page by the function that writes it
     into the served page (journeysServed, journeys.mjs): its source, here,
     so the two cannot part (THE RESULT, SERVED, below). */
  if (js.split(JOURNEYS_MARKER).length !== 2) throw new Error('src/js must carry the journeys renderer marker exactly once (91-health.js)');
  js = js.replace(JOURNEYS_MARKER, () => `(${journeysServed.toString()})`);
  if (js.split(JOURNEY_NAMES_MARKER).length !== 2) throw new Error('src/js must carry the journeys\' names marker exactly once (91-health.js)');
  js = js.replace(JOURNEY_NAMES_MARKER, () => JSON.stringify(JOURNEY_NAMES));
  if (js.split(HOME_FILED_MARKER).length !== 2) throw new Error('src/js must carry the homepage\'s filed-example marker exactly once (55-views-public.js)');
  js = js.replace(HOME_FILED_MARKER, () => JSON.stringify(homeFiled(plan)));

  /* One stylesheet and one script, where linked() looks for them: the page's
     own markup must not carry a second of either, which linked() would take
     for the app's. Counted in the template, before the CSS and the JS (whose
     text may say "<script" in a string) are in it. */
  const count = (re) => (template.match(re) || []).length;
  if (count(/<style[\s>]/g) !== 1 || count(/<script[\s>]/g) !== 1)
    throw new Error(`the template carries ${count(/<style[\s>]/g)} <style> and ${count(/<script[\s>]/g)} <script> elements, where the build links exactly one of each`);

  const shell = template
    .replace(STYLE_MARKER, () => css)
    .replace(SCRIPT_MARKER, () => js);

  /* Every page is the shell with its route's head; the site root's is
     index.html. Pages whose heads are identical share one file, named after
     the route among them that is its own canonical address (the wheel's five
     aliases share pages/us-options/wheel.html), else after the first.
     index.html carries the app inline; every other page loads it from the
     two files (appFiles, linked — THE APP ONCE, above). */
  /* Every page carries the navigation (navMarkup); a page in prerender's
     scope carries its render as well, and its navigation marked as the
     render marked it (withRender, readRenders). */
  const nav = navMarkup();
  const scope = prerenderScope(plan);
  const stems = new Map();
  for (const s of scope) {
    if (stems.has(s.render)) throw new Error(`${s.file} and ${stems.get(s.render)} would both be rendered to ${s.render}`);
    stems.set(s.render, s.file);
  }
  const rendered = bare ? { manifest: null, renders: new Map(), missing: [], edited: [], extra: [], unknown: [] } : readRenders(scope);
  /* Every page carries the first-paint script (BEFORE THE FIRST PAINT); an
     island page's render, the recorded journeys (THE RESULT, SERVED). */
  const served = journeysServed(readRecord());
  /* And each in its own chrome first, the other after its page (PAGE
     CONTENT FIRST): a page with no render is the public header's, as a
     first frame draws it. */
  const page = (head, file, opts) => {
    const r = rendered.renders.get(file);
    const chrome = r ? r.manifest.chrome : 'public';
    const p = withFirst(withNav(withHead(shell, head, opts), nav(r ? r.manifest.nav : null, chrome)));
    return servedChrome(r ? withRender(p, { ...r, views: withServedRecord(r, served) }) : p, chrome);
  };
  const rootHead = plan.pages.find(p => p.path === '/').head;
  const html = page(rootHead, 'index.html');
  const files = appFiles(html);
  const notFound = linked(page(plan.notFound, NOT_FOUND, { notFound: true }), files);
  /* The parameter routes' page: index.html's title and description and the
     app, no page in it (GENERIC) — and no address of its own (2026-10-04).
     It carried index.html's canonical, "/": every company report, scanner
     setup and company id it answers told a crawler that does not run the
     script it was the homepage, and the served renders now link several
     (/company/AAPL-SEC, /company/aapl-apple-inc/report). Like the 404 page it
     names no canonical and asks not to be indexed; the script writes the
     page's own canonical and takes the noindex off as it draws the page
     (setDocumentMeta, 35-ui.js). */
  const pages = new Map([[GENERIC, linked(page(rootHead, GENERIC, { notFound: true }), files)]]);
  /* The site root's page: index.html, render and all, linked (HOME). The
     record goes into the island pages only (withServedRecord), and the
     root's render has none of their slots: were it to grow one, / would
     serve the record without the journeys workflow rebuilding it. */
  const rootRender = rendered.renders.get('index.html');
  if (rootRender && /\bid="health-journeys|\bclass="journey-line"/.test(rootRender.views))
    throw new Error(`${rootRender.render} carries a slot for the recorded journeys — add ${HOME} to ISLAND_PAGES (journeys.mjs), so the journeys workflow rebuilds it with the record`);
  /* journeys.mjs matches the served build by this page (ROOT_PAGES). */
  if (!ROOT_PAGES.includes(HOME)) throw new Error(`journeys.mjs's ROOT_PAGES does not name ${HOME}, so the journeys could not tell which build / serves`);
  pages.set(HOME, linked(html, files));
  const fileOfRoute = new Map();
  for (const g of routePages(plan)) {
    g.routes.forEach(p => fileOfRoute.set(p.path, g.file === 'index.html' ? HOME : g.file));
    if (g.file === 'index.html') continue;
    if (pages.has(g.file)) throw new Error(`${g.file} would be written for ${g.named.path} and is already written`);
    pages.set(g.file, linked(page(g.named.head, g.file), files));
  }
  /* A page per company, at its own address under pages/, made as a route
     page is — so everything below that holds a page (no inline script, the
     two app files, PAGE_LIMIT, --check's drift and stale files) holds it. */
  for (const co of plan.companies) {
    const file = `${PAGES}${co.path}.html`;
    if (pages.has(file)) throw new Error(`${file} would be written both for a route and for ${co.id}`);
    pages.set(file, linked(page(co.head, file), files));
  }
  const rewrites = plan.pages.map(p => ({ source: p.path, destination: `/${fileOfRoute.get(p.path)}` }));
  /* Each company's own address, to its page: exact like the routes above
     (none of which is a company's), and before the parameter routes, where
     /company/:id would answer it with the generic page. */
  for (const co of plan.companies) rewrites.push({ source: co.path, destination: `/${PAGES}${co.path}.html` });
  /* After every exact path, so no :param can answer an address a page is
     written for (matchRoute has already decided each of those). They all go
     to one file, so their order among themselves cannot matter. */
  for (const path of plan.params) rewrites.push({ source: path, destination: `/${GENERIC}` });

  /* The CSP hash covers the inline script EXACTLY as the browser will see it —
     taken back out of the assembled document rather than from the pieces, so a
     templating slip can never produce a header that describes something other
     than what shipped. index.html is the one page that carries it inline; the
     file every other page loads is those same bytes (appFiles), allowed by
     script-src 'self'. So no other page may carry an inline script — one the
     hash does not name is blocked — and each must load exactly the current
     two files, and weigh what a page does, not what the app does. */
  const inline = inlineScript(html);
  const want = [styleTag(files), scriptTag(files)];
  /* Every page, index.html too, carries the first-paint script once, in its
     head before anything it loads, the same bytes (BEFORE THE FIRST PAINT). */
  for (const [file, page] of [['index.html', html], [NOT_FOUND, notFound], ...pages]) {
    const at = page.indexOf(FIRST_TAG), head = page.indexOf('</head>');
    const loads = Math.min(...['<style>', '<link rel="stylesheet"'].map(t => page.indexOf(t)).filter(i => i >= 0));
    if (page.split(FIRST_TAG).length !== 2 || at < 0 || at > head || at > loads) throw new Error(`${file} does not carry the first-paint script once, in its head before what it loads`);
  }
  for (const [file, page] of [[NOT_FOUND, notFound], ...pages]) {
    const inlineLeft = (page.replace(FIRST_TAG, '').match(/<script(?![^>]*\bsrc=)[^>]*>|<style[\s>]/g) || []).length;
    const loads = (page.match(/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/g) || []).length;
    if (inlineLeft) throw new Error(`${file} carries ${inlineLeft} inline <script> or <style>, which only index.html may`);
    if (loads !== 2 || !want.every(tag => page.split(tag).length === 2)) throw new Error(`${file} does not load exactly /${files.script.file} and /${files.styles.file}`);
    const size = Buffer.byteLength(page, 'utf8');
    const rd = rendered.renders.get(file === HOME ? 'index.html' : file);
    if (size > PAGE_LIMIT) throw new Error(`${file} is ${(size / 1024).toFixed(0)}kB, over the ${PAGE_LIMIT / 1024}kB a page may weigh — ${rd
      ? `${(Buffer.byteLength(rd.views) / 1024).toFixed(0)}kB of it is its render (${rd.render}): the page has grown past what may be served whole, and what prerender.mjs serves of it (servedCopy) must shrink`
      : 'is the app inline in it again?'}`);
  }
  /* The site root's page says what it is early (HOME_HEAD_BYTES,
     HOME_TEXT_BYTES): a fetcher that keeps only the start of it still reads
     that it loads the app, the page's #views and its h1. */
  {
    const home = Buffer.from(pages.get(HOME), 'utf8');
    const head = home.subarray(0, HOME_HEAD_BYTES).toString('utf8');
    for (const tag of [`<script src="/${files.script.file}"`, '<div id="views"'])
      if (!head.includes(tag)) throw new Error(`${HOME} (/) does not carry ${tag} within its first ${HOME_HEAD_BYTES / 1024}kB — a fetcher that keeps only that much reads neither the app nor the page`);
    const h1 = rootRender?.manifest.h1;
    if (rootRender && !pageText(home.subarray(0, HOME_TEXT_BYTES).toString('utf8')).includes(h1))
      throw new Error(`${HOME} (/): its first ${HOME_TEXT_BYTES / 1024}kB, as text, do not hold its h1 "${h1}"`);
  }
  const cspHash ='sha256-' + createHash('sha256').update(inline, 'utf8').digest('base64');

  const cfgTemplate = lf(readFileSync(src('vercel.template.json'), 'utf8'));
  if (!cfgTemplate.includes(CSP_MARKER)) throw new Error('vercel template lost its CSP marker');
  /* THE TEMPLATE IS COMMENTED; THE OUTPUT MUST NOT BE.
     vercel.json is validated against a strict schema and an unknown property is
     not ignored — it fails the deployment. The first version of this file
     carried "$comment" keys explaining each header straight through into the
     output, and production sat five days behind HEAD as a result: three commits
     pushed, CI green on all of them, and no build. Comments belong in
     src/vercel.template.json, which nothing but this script ever reads. */
  const stripComments = (v) => Array.isArray(v) ? v.map(stripComments)
    : (v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$comment')).map(([k, x]) => [k, stripComments(x)]))
        : v);
  if (!cfgTemplate.includes(CSP_FIRST_MARKER)) throw new Error('vercel template lost its first-paint CSP marker');
  const parsed = JSON.parse(cfgTemplate.replace(CSP_MARKER, () => cspHash).replace(CSP_FIRST_MARKER, () => firstHash()));
  if (parsed.rewrites !== REWRITES_MARKER) throw new Error(`vercel template's "rewrites" must be "${REWRITES_MARKER}" — the build writes them from ROUTES`);
  parsed.rewrites = rewrites;
  /* The app files' header rules name the current files exactly, not a
     pattern: an address the build no longer writes (/assets/app.<old>.js,
     asked for by a page fetched a moment before a deploy) is a 404, and a
     404 must not be told to stay in a cache for a year. The pages' rule
     names them in a negative lookahead, so each header of each response is
     set by exactly one rule. A literal "." is escaped there: it is a regular
     expression, where elsewhere a source is path-to-regexp's literal text. */
  const used = { [APP_SCRIPT_MARKER]: 0, [APP_STYLES_MARKER]: 0, [APP_FILES_MARKER]: 0 };
  for (const rule of parsed.headers || []) {
    if (rule.source === APP_SCRIPT_MARKER) { rule.source = `/${files.script.file}`; used[APP_SCRIPT_MARKER]++; }
    else if (rule.source === APP_STYLES_MARKER) { rule.source = `/${files.styles.file}`; used[APP_STYLES_MARKER]++; }
    else if (rule.source.includes(APP_FILES_MARKER)) {
      rule.source = rule.source.replace(APP_FILES_MARKER, () => [files.script.file, files.styles.file].map(f => `|${f.replace(/\./g, '\\.')}$`).join(''));
      used[APP_FILES_MARKER]++;
    }
  }
  for (const [marker, n] of Object.entries(used)) if (n !== 1) throw new Error(`vercel template uses ${marker} in ${n} header sources, where the build fills in exactly one`);
  const vercel = JSON.stringify(stripComments(parsed), null, 2) + String.fromCharCode(10);
  if (vercel.includes('"$comment')) throw new Error('a $comment survived into vercel.json');

  return { html, vercel, notFound, pages, files, rewrites, plan, modules, versions, cspHash, scope, rendered, napic, napicText };
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

/* THE BUILD MUST NOT DEPEND ON HOW THE REPO WAS CHECKED OUT.
   vercel.json carries a hash of the shipped script, so a CRLF working copy on
   Windows would produce a hash of text that git then stores — and Vercel then
   serves — as LF. The header would describe a file that exists nowhere, the
   browser would refuse the script, and production would be blank while every
   local check passed. .gitattributes pins the checkout; this makes the point
   moot even if someone overrides it. */
const lf = (t) => t.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

/* Every file under pages/, as a/b.html, whether the build wrote it or not. */
function filesUnder(dir, rel = '') {
  const abs = join(ROOT, dir, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap(d => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? filesUnder(dir, r) : [`${dir}/${r}`];
  });
}

/* NO CONTROL CHARACTER IN A SOURCE FILE (2026-10-04, the integration's
   re-verification). A regex typed through a shell heredoc lost its
   backslash, and \b became a backspace (U+0008) in State.baseCcy's language
   rule (05-plans.js) — invisible in an editor, valid JavaScript, a pattern
   that matches nothing a browser sends — and the app and the head's script
   (defaultCcy, above) gave a reader in Singapore with an en-MY browser two
   currencies for six weeks. No file under src/, and no .mjs, .js, .css or
   .html at the root (the build, the harnesses, the pages it writes), may
   hold a C0 control character other than a tab, a line feed or a carriage
   return. Each is named by file, line and code point. */
export function sourceControls({ root = ROOT } = {}) {
  const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
  const named = (c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  const under = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap(d => (d.isDirectory() ? under(`${dir}/${d.name}`) : [`${dir}/${d.name}`])) : []);
  const files = [...under('src'), ...readdirSync(root, { withFileTypes: true })
    .filter(d => d.isFile() && /\.(mjs|js|css|html)$/.test(d.name)).map(d => d.name)];
  const out = [];
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    for (const m of text.matchAll(BAD)) {
      const line = text.slice(0, m.index).split(String.fromCharCode(10)).length;
      const around = text.slice(Math.max(0, m.index - 24), m.index + 8).replace(BAD, (c) => `<${named(c)}>`).replace(/\s+/g, ' ');
      out.push(`${f}:${line} holds the control character ${named(m[0])} — a backslash lost on the way in? (…${around}…)`);
    }
  }
  return out;
}

/* THE AREA SCREEN'S MAP, ITS ROOM KEPT (2026-10-04, the same). The page is
   served before the locality positions arrive, so its map card is drawn
   round a box the map's size (cityMapHold, 70-property.js) from each town's
   shape in CITY_MAP_SHAPE — which must be the shape the positions give, by
   the map's own reckoning (cityMapSpan), for every town that has them and no
   other: a wrong one moves the page under a reader when the map comes. */
export function mapShapeProblems({ root = ROOT } = {}) {
  const P = lf(readFileSync(join(root, 'src', 'js', '70-property.js'), 'utf8'));
  const { cityMapSpan, CITY_MAP_SHAPE } = vm.runInContext([
    cut(P, '70-property.js', 'function cityMapSpan(', '\n}\n'),
    cut(P, '70-property.js', 'const CITY_MAP_SHAPE = ', ';\n'),
    '({ cityMapSpan, CITY_MAP_SHAPE })'].join('\n'), vm.createContext({}));
  const geo = JSON.parse(readFileSync(join(root, 'data', 'sarawak-geo.json'), 'utf8'));
  const out = [];
  const towns = Object.entries(geo.cities || {}).filter(([, c]) => Object.keys(c.areas || {}).length);
  for (const [id, c] of towns) {
    const { spanX, spanY } = cityMapSpan(Object.entries(c.areas));
    const want = Math.round(spanY / spanX * 10000) / 10000;
    if (!(id in CITY_MAP_SHAPE)) out.push(`CITY_MAP_SHAPE (70-property.js) has no shape for ${id}, which data/sarawak-geo.json maps — give it ${id}: ${want}`);
    else if (Math.abs(CITY_MAP_SHAPE[id] - want) > 0.00005) out.push(`CITY_MAP_SHAPE.${id} (70-property.js) is ${CITY_MAP_SHAPE[id]}, where data/sarawak-geo.json's positions give ${want}`);
  }
  for (const id of Object.keys(CITY_MAP_SHAPE)) if (!towns.some(([t]) => t === id)) out.push(`CITY_MAP_SHAPE (70-property.js) gives ${id} a shape, and data/sarawak-geo.json maps no position for it`);
  return out;
}

/* THE LAYOUT SYSTEM'S TYPE AND MEASURE, IN THE STYLESHEET (the owner's
   decision, 7 Oct 2026; 37-layout-system.js). The pages on the system set
   their type in seven tokens on the brief's scale, and hold text to a
   measure of 70 characters at most. Held here, in src/styles.css:
   - its layout-system section stands, and defines --ls-hero, --ls-title,
     --ls-section, --ls-metric, --ls-body, --ls-support and --ls-meta, each
     inside the brief's range on a phone (the base) and on a desk (from
     1024px and from 1440px, as the media queries leave it);
   - --ls-measure is 70ch or less;
   - every font-size in that section, and in every rule of the families the
     system's pages draw with (.ls-, .lab-, .pc-), is a token (var(--ls-…));
   - no rule of those families lets a block wider than 70ch.
   mobile.mjs holds what is drawn to the same; served-check what is served. */
const LS_SCALE = {
  '--ls-hero': [[36, 42], [52, 64]], '--ls-title': [[28, 32], [36, 44]], '--ls-section': [[21, 24], [24, 28]], '--ls-metric': [[26, 32], [28, 36]],
  '--ls-body': [[16, 16], [16, 16]], '--ls-support': [[14, 14], [14, 14]], '--ls-meta': [[12, 12], [12, 13]],
};
export function layoutSystemProblems({ root = ROOT } = {}) {
  const raw = lf(readFileSync(join(root, 'src', 'styles.css'), 'utf8'));
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  const a = raw.indexOf('/* ---- layout-system ---- */'), b = raw.indexOf('/* ---- end layout-system ---- */');
  if (a < 0 || b < a) out.push('src/styles.css has no layout-system section (/* ---- layout-system ---- */ … /* ---- end layout-system ---- */): the pages on the layout system have no type scale or measure to be held to');
  const sec = a < 0 || b < a ? '' : css.slice(a, b);
  /* The tokens' values: the section's base :root, then each media query's. */
  const at = { base: {}, 640: {}, 1024: {}, 1440: {} };
  for (const m of sec.matchAll(/(?:@media\s*\(min-width:\s*(\d+)px\)\s*\{\s*)?:root\s*\{([^}]*)\}/g)) {
    const into = m[1] ? at[m[1]] : at.base;
    if (!into) continue;
    for (const d of m[2].matchAll(/(--ls-[a-z0-9-]+)\s*:\s*([^;]+);/g)) into[d[1]] = d[2].trim();
  }
  const px = (v) => (/^\d+(\.\d+)?px$/.test(v || '') ? parseFloat(v) : null);
  for (const [t, [phone, desk]] of Object.entries(LS_SCALE)) {
    const base = px(at.base[t]);
    if (base == null) { out.push(`src/styles.css: the layout system's ${t} is ${at.base[t] ? `"${at.base[t]}", not a size in px` : 'not defined'}`); continue; }
    if (base < phone[0] || base > phone[1]) out.push(`src/styles.css: ${t} is ${base}px on a phone, outside the brief's ${phone.join('–')}px`);
    for (const w of [1024, 1440]) {
      const v = px([at[w][t], at[1024][t], at[640][t], at.base[t]].slice(w === 1440 ? 0 : 1).find(x => x != null));
      if (v == null || v < desk[0] || v > desk[1]) out.push(`src/styles.css: ${t} is ${v}px at ${w}px, outside the brief's ${desk.join('–')}px for a desk`);
    }
  }
  const measure = /^(\d+(?:\.\d+)?)ch$/.exec(at.base['--ls-measure'] || '');
  if (!measure || Number(measure[1]) > 70) out.push(`src/styles.css: --ls-measure is ${at.base['--ls-measure'] || 'not defined'}, not a measure of 70ch or less`);
  /* Every rule of the system's families. */
  let n = 0;
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(), body = m[2], inSec = m.index >= a && m.index < b;
    if (!inSec && !/\.(ls|lab|pc)-/.test(sel)) continue;
    const line = css.slice(0, m.index + m[0].indexOf('{')).split('\n').length;
    for (const d of body.matchAll(/font-size\s*:\s*([^;!]+)/g)) {
      n++;
      if (!/^var\(--ls-[a-z0-9-]+\)$/.test(d[1].trim()) && d[1].trim() !== 'inherit') out.push(`src/styles.css:${line} ${sel.split('\n').pop().trim().slice(0, 70)} sets font-size: ${d[1].trim()}, not a token of the layout system's scale`);
    }
    for (const d of body.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)ch/g)) if (Number(d[1]) > 70) out.push(`src/styles.css:${line} ${sel.split('\n').pop().trim().slice(0, 70)} lets a block ${d[1]}ch wide, more than the 70ch measure`);
  }
  if (!n) out.push('src/styles.css: no rule of the layout system\'s families sets a size — the check read nothing');
  return out;
}

/* What would make the committed files serve something other than what they
   say, beyond drift from src/.

   1. A file where a route's address is. Vercel looks at the files BEFORE the
      rewrites, so a file or a folder with an index.html at /pricing would be
      served there and the rewrite never reached. Nothing may rely on that
      order, so nothing may stand there.
   2. The sitemap: every address it lists must be served its own page, name
      itself as its canonical (the sitemap lists canonical addresses only, and
      the page's canonical is what the router sets), sit on the site's own
      origin, not be one robots.txt disallows (read as RFC 9309 reads it,
      robotsAllows below), and not be one vercel.json serves with
      X-Robots-Tag: noindex (plan item 1.1). */
/* ROBOTS.TXT AS A CRAWLER READS IT (RFC 9309; plan item 1.1, 2026-10-06).
   The sitemap's check took each Disallow as a prefix and a trailing "$" as
   "exactly" — near enough for the lines this file had, and not the
   standard: no "*", no Allow, no longest-match. This is the standard's
   reading, small enough to hold here:
   - the groups whose user-agent lines name the crawler's product token
     (case-insensitive) apply, all of them merged; if none does, the "*"
     groups; if none is "*", everything is allowed;
   - a rule's path matches from the start of the address's path; "*" is
     any run of characters and a final "$" ends the match;
   - the matching rule with the longest path wins; an Allow and a Disallow
     of the same length, the Allow (the least restrictive); an empty
     Disallow matches nothing; no matching rule is allowed;
   - /robots.txt itself is always allowed.
   Returns whether the path is allowed, and the rule that decided. */
export function robotsAllows(text, path, agent = '*') {
  if (path === '/robots.txt') return { allowed: true, rule: null };
  const groups = [];
  let group = null, agents = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*([^#]*)/.exec(raw);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') {
      if (!agents) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
      agents = true;
      continue;
    }
    agents = false;
    if (group && (key === 'allow' || key === 'disallow') && value) group.rules.push({ allow: key === 'allow', path: value });
  }
  const token = String(agent).toLowerCase();
  let apply = token === '*' ? [] : groups.filter(g => g.agents.includes(token));
  if (!apply.length) apply = groups.filter(g => g.agents.includes('*'));
  const matches = (rule) => {
    const end = rule.endsWith('$');
    const body = end ? rule.slice(0, -1) : rule;
    const re = body.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${re}${end ? '$' : ''}`).test(path);
  };
  let best = null;
  for (const r of apply.flatMap(g => g.rules)) {
    if (!matches(r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return { allowed: !best || best.allow, rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : null };
}
/* The addresses vercel.json serves with X-Robots-Tag: noindex: a test of a
   path against each header rule that sets it, the source read as the
   regular expression it is here (literals and groups, as served-check reads
   the header sources). */
export function noindexByHeader(vercel) {
  const cfg = typeof vercel === 'string' ? JSON.parse(vercel) : vercel;
  const rules = (cfg.headers || []).filter(g => (g.headers || []).some(h => h.key.toLowerCase() === 'x-robots-tag' && /\bnoindex\b/i.test(h.value)))
    .map(g => new RegExp(`^${g.source}$`));
  return (path) => rules.some(re => re.test(path));
}
/* .vercelignore as this site writes it: comments, blank lines and literal
   paths from the root ("/index.html"). Anything else a .gitignore may say
   (a pattern, a folder, a "!") is refused by name, here and in serve.mjs,
   which reads it the same way, so the file cannot mean one thing locally and
   another on Vercel. */
export function vercelIgnore(text) {
  const paths = new Set(), refused = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(line) && !/(^|\/)\.\.?(\/|$)/.test(line)) paths.add(line);
    else refused.push(line);
  }
  return { paths, refused };
}
function servingProblems({ rewrites, plan, vercel }) {
  const out = [];
  /* 3. The site root (plan item 1.2, HOME): / is rewritten to the home page;
     index.html, the app inline, is kept off the host by .vercelignore (a
     file is served before any rewrite, so it would answer / itself), and
     nothing else is; /index.html is a 308 to /. */
  {
    const ign = vercelIgnore(existsSync(join(ROOT, '.vercelignore')) ? readFileSync(join(ROOT, '.vercelignore'), 'utf8') : '');
    if (!ign.paths.has('/index.html')) out.push(`.vercelignore does not drop /index.html: Vercel serves a file before any rewrite, so / would be index.html, the app inline, and not ${HOME}`);
    /* And the NAPIC extract whole (plan item 1.6, NAPIC_SOURCE): the source
       of the division files, never served itself. */
    if (!ign.paths.has(`/${NAPIC_SOURCE}`)) out.push(`.vercelignore does not drop /${NAPIC_SOURCE}: every NAPIC benchmark would be one download, which its licence note says stays disabled until JPPH confirms redistribution rights`);
    for (const p of ign.paths) if (p !== '/index.html' && p !== `/${NAPIC_SOURCE}`) out.push(`.vercelignore drops ${p}, and only /index.html and /${NAPIC_SOURCE} are kept off the host`);
    for (const l of ign.refused) out.push(`.vercelignore says "${l}", which neither this check nor serve.mjs reads — only literal paths from the root`);
    const root = rewrites.filter(r => r.source === '/');
    if (root.length !== 1 || root[0].destination !== `/${HOME}`) out.push(`vercel.json rewrites / to ${root.map(r => r.destination).join(', ') || 'nothing'}, not /${HOME}`);
    const cfg = JSON.parse(vercel);
    const index = (cfg.redirects || []).filter(r => r.source === '/index.html');
    if (index.length !== 1 || index[0].destination !== '/' || index[0].permanent !== true) out.push('vercel.json does not redirect /index.html to / (308)');
  }
  for (const { source } of rewrites) {
    if (source === '/' || source.includes(':')) continue;
    const at = join(ROOT, source);
    if (existsSync(at) && (statSync(at).isFile() || existsSync(join(at, 'index.html'))))
      out.push(`${source}: a file in the repository stands at this address, and Vercel serves files before rewrites`);
  }
  const sitemap = existsSync(join(ROOT, 'sitemap.xml')) ? readFileSync(join(ROOT, 'sitemap.xml'), 'utf8') : '';
  const robots = existsSync(join(ROOT, 'robots.txt')) ? readFileSync(join(ROOT, 'robots.txt'), 'utf8') : '';
  const blocked = (p) => !robotsAllows(robots, p).allowed;
  const noindex = noindexByHeader(vercel);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  if (!locs.length) out.push('sitemap.xml lists no addresses');
  const byPath = new Map(plan.pages.map(p => [p.path, p]));
  const seen = new Set();
  for (const loc of locs) {
    if (seen.has(loc)) out.push(`sitemap.xml lists ${loc} twice`);
    seen.add(loc);
    if (!loc.startsWith(plan.origin + '/')) { out.push(`sitemap.xml lists ${loc}, which is not on ${plan.origin}`); continue; }
    const path = loc.slice(plan.origin.length);
    const page = byPath.get(path);
    if (!page) { out.push(`sitemap.xml lists ${path}, which no route without a parameter serves a page for`); continue; }
    if (page.head.canonical !== loc) out.push(`sitemap.xml lists ${path}, whose canonical is ${page.head.canonical}`);
    if (blocked(path)) out.push(`sitemap.xml lists ${path}, which robots.txt disallows`);
    if (noindex(path)) out.push(`sitemap.xml lists ${path}, which vercel.json serves with X-Robots-Tag: noindex`);
  }
  return out;
}

/* SITEMAP <lastmod> (plan item 1.3). Each address the sitemap lists is
   given the day its page last changed: the "changed" day prerender.mjs
   keeps for the page's render in the manifest — the commit's day the render
   was last drawn differently from (prerender.mjs, WHEN EACH PAGE LAST
   CHANGED). The sitemap stays as typed, its addresses, order, comments and
   priorities the author's; the build writes only each <lastmod>, read from
   the tree and not from git, so --check reproduces it in a copy with no
   history. An address whose page carries no render, or whose render has no
   day, is a problem: a <lastmod> nobody can reproduce is worse than none. */
export function sitemapWithLastmod(text, plan, manifest) {
  const fileOf = new Map();
  for (const g of routePages(plan)) g.routes.forEach(p => fileOf.set(p.path, g.file));
  const problems = [];
  const body = text.replace(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>[^<]*<\/lastmod>)?/g, (all, loc) => {
    const at = loc.trim();
    const path = at.startsWith(plan.origin + '/') ? at.slice(plan.origin.length) : null;
    const file = path && fileOf.get(path);
    const day = file ? manifest?.pages?.[file]?.changed : null;
    if (!day || !/^\d{4}-\d\d-\d\d$/.test(day)) {
      problems.push(`sitemap.xml: ${at} has no day its page last changed (${file ? `no "changed" for ${file} in ${MANIFEST}` : 'no page carries a render at it'}) — run node prerender.mjs, then node build.mjs`);
      return `<url><loc>${loc}</loc>`;
    }
    return `<url><loc>${loc}</loc><lastmod>${day}</lastmod>`;
  });
  return { body, problems };
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  const bare = process.argv.includes('--bare');
  if (bare && process.argv.includes('--check')) { console.error('--bare writes pages without their renders, for prerender.mjs; it has nothing to check'); process.exit(2); }
  const built = build({ bare });
  const { html, vercel, notFound, pages, files, rewrites, plan, modules, versions, cspHash, scope, rendered, napic, napicText } = built;
  /* What prerender/ does not hold for the pages in scope, and what it holds
     for none: --check fails on either; a build says so and writes the page
     without a render. */
  const renderProblems = [
    ...rendered.missing.map(m => `no render committed for ${m} — run node prerender.mjs, then node build.mjs`),
    ...rendered.edited.map(m => `edited: ${m}`),
    ...rendered.extra.map(f => `${f} is stale — no page in scope reads it (node prerender.mjs removes it)`),
    ...rendered.unknown.map(f => `${MANIFEST} lists ${f}, which is not a page in scope (node prerender.mjs rewrites it)`),
  ];
  const CFG = join(ROOT, 'vercel.json');
  const kb = (n) => `${(n / 1024).toFixed(0)}kB`;
  /* The sitemap's <lastmod>s, from the renders' days (sitemapWithLastmod);
     --bare reads no render, so it leaves the sitemap as it is. */
  const SITEMAP = join(ROOT, 'sitemap.xml');
  const sitemap = !bare && existsSync(SITEMAP) ? sitemapWithLastmod(lf(readFileSync(SITEMAP, 'utf8')), plan, rendered.manifest) : null;
  const outputs = [['index.html', html], ['vercel.json', vercel], [NOT_FOUND, notFound], ...pages,
    [files.script.file, files.script.body], [files.styles.file, files.styles.body], ...napic, ...(sitemap ? [['sitemap.xml', sitemap.body]] : [])];
  /* A page no route writes, and an app file under a name the build no longer
     writes — last build's app.<hash>.js, still deployed and still served,
     though no page names it. */
  const current = new Set([files.script.file, files.styles.file]);
  const stale = [...filesUnder(PAGES).filter(f => !pages.has(f)), ...filesUnder(ASSETS).filter(f => !current.has(f)),
    ...filesUnder(NAPIC_DIR).filter(f => !napic.has(f))];
  const largest = Math.max(...[notFound, ...pages.values()].map(p => Buffer.byteLength(p, 'utf8')));
  const problems = [...servingProblems(built), ...napicProblems(napic, napicText), ...sourceControls(), ...mapShapeProblems(), ...layoutSystemProblems(), ...(sitemap ? sitemap.problems : [])];
  /* The company pages, and the route pages beside them. */
  const COMPANY_PAGES = `${PAGES}/company/`;
  const isCompanyPage = (f) => f.startsWith(COMPANY_PAGES);
  const companySizes = [...pages].filter(([f]) => isCompanyPage(f)).map(([, p]) => Buffer.byteLength(p, 'utf8'));
  /* The route pages, less the parameter routes' page and the site root's beside them. */
  const routeFiles = pages.size - companySizes.length - 2;
  const shared = plan.pages.length - 1 - routeFiles;
  const filed = plan.companies.filter(c => c.company.real).length;
  const companiesSaid = `${plan.companies.length} company pages (${filed} filed with the SEC, ${plan.companies.length - filed} illustrative)`;
  plan.skippedFilers.forEach(s => console.error(`skipped      ${s} — the page's loader refuses this filer too, so it has no page`));

  if (process.argv.includes('--check')) {
    const drift = [];
    for (const [label, body] of outputs) {
      const path = join(ROOT, label);
      if (!existsSync(path)) { drift.push(`${label} is missing — the build writes it`); continue; }
      const committed = lf(readFileSync(path, 'utf8'));
      if (sha(committed) !== sha(body)) drift.push(`${label} DOES NOT match src/${isCompanyPage(label) || label === 'vercel.json' ? ' and data/us.json' : ''}  committed ${sha(committed).slice(0, 12)}  from src ${sha(body).slice(0, 12)}`);
    }
    /* A page for a route that no longer exists (or a path that changed) is
       still deployed and still served at its file's address; the build removes
       it, so a committed one means the build was not run. The same for a
       company page whose company left the universe, or whose address moved
       with its name. */
    stale.forEach(f => drift.push(`${f} is stale — ${isCompanyPage(f) ? 'no company in the universe has that address any more' : f.startsWith(PAGES) ? 'no route writes it any more' : f.startsWith(NAPIC_DIR) ? `no division in ${NAPIC_SOURCE} writes it any more` : 'no page loads it any more'}`));
    problems.forEach(p => drift.push(p));
    renderProblems.forEach(p => drift.push(p));
    if (!drift.length) {
      console.log(`index.html, 404.html, the site root's page (${HOME}), ${routeFiles} route pages, the parameter routes' page, ${companiesSaid}, the app's two files and vercel.json match src/ and data/us.json (${modules.length} modules, ${kb(html.length)}; ${rewrites.length} rewrites).`);
      console.log(`every page carries the navigation NAV_MARKUP draws; ${rendered.renders.size} of them (${scope.length} in scope) carry their committed render of the page in #views exactly, under prerender/.`);
      console.log(`every page but index.html loads /${files.script.file} (deferred, from its head) and /${files.styles.file} and carries neither inline; the largest is ${kb(largest)} (limit ${kb(PAGE_LIMIT)}). / is ${HOME}, ${kb(Buffer.byteLength(pages.get(HOME)))}, the app's script tag and #views in its first ${HOME_HEAD_BYTES / 1024}kB and its h1 in its first ${HOME_TEXT_BYTES / 1024}kB; .vercelignore keeps index.html off the host and /index.html is a 308 to /.`);
      console.log(`every page, index.html too, carries the first-paint script once in its head before what it loads, named in the CSP (${firstHash().slice(0, 19)}…); ${[...rendered.renders.values()].filter(r => servedReadsOf(r.views, { waits: r.manifest.state === 'filings in', drawn: r.drawn, render: r.render })).length} pages with a render say on <html> what it read.`);
      console.log(`sitemap.xml lists only canonical addresses that are served their own page, each with the day its render last changed as <lastmod>.`);
      console.log(`${NAPIC_DIR}/ holds ${napic.size} division files made from ${NAPIC_SOURCE}, one division each, ${kb([...napic.values()].reduce((n, b) => n + Buffer.byteLength(b), 0))} in all; .vercelignore keeps ${NAPIC_SOURCE} off the host.`);
    } else {
      drift.forEach(d => console.error(d));
      console.error('\nRun `node build.mjs` and commit the result.');
      process.exit(1);
    }
  } else {
    for (const [label, body] of outputs) {
      mkdirSync(dirname(join(ROOT, label)), { recursive: true });
      writeFileSync(join(ROOT, label), body);
    }
    for (const f of stale) rmSync(join(ROOT, f));
    /* And the folders a removed page leaves empty. */
    const prune = (dir) => {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) return;
      for (const d of readdirSync(abs, { withFileTypes: true })) if (d.isDirectory()) prune(`${dir}/${d.name}`);
      if (dir !== PAGES && !readdirSync(abs).length) rmSync(abs, { recursive: true });
    };
    prune(PAGES);
    console.log(`index.html   ${modules.length} modules  ${kb(html.length)}  ${sha(html).slice(0, 12)}`);
    console.log(`assets/      ${files.script.file.slice(ASSETS.length + 1)} ${kb(Buffer.byteLength(files.script.body))}, ${files.styles.file.slice(ASSETS.length + 1)} ${kb(Buffer.byteLength(files.styles.body))} — index.html's inline script and stylesheet`);
    console.log(`404.html     the not-found head, noindex  ${kb(Buffer.byteLength(notFound))}`);
    console.log(`pages/       ${HOME.slice(PAGES.length + 1)} for / (${kb(Buffer.byteLength(pages.get(HOME)))}), ${routeFiles} pages for ${plan.pages.length - 1} routes without a parameter${shared ? ` (${shared} share a page)` : ''} and ${GENERIC.slice(PAGES.length + 1)} for the ${plan.params.length} parameter routes, the largest of every page ${kb(largest)}`);
    console.log(`prerender/   ${bare ? 'not read (--bare): no page carries a render' : `${rendered.renders.size} of the ${scope.length} pages in scope carry their render of the page, ${rendered.renders.size ? `${kb([...rendered.renders.values()].reduce((n, r) => n + Buffer.byteLength(r.views) + Buffer.byteLength(r.tabs || ''), 0))} of renders` : 'none committed'}`}`);
    renderProblems.forEach(p => console.error(`WARNING  ${p}`));
    console.log(`pages/company/  ${companiesSaid}, one per company at its own address, the largest ${kb(Math.max(0, ...companySizes))}, ${(companySizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(2)}MB in all`);
    if (stale.length) console.log(`stale        ${stale.join(', ')} — removed`);
    console.log(`${NAPIC_DIR}/  ${napic.size} division files made from ${NAPIC_SOURCE}, the largest ${kb(Math.max(...[...napic.values()].map(b => Buffer.byteLength(b))))}, ${kb([...napic.values()].reduce((n, b) => n + Buffer.byteLength(b), 0))} in all`);
    console.log(`vercel.json  ${rewrites.length} rewrites (${plan.companies.length} company addresses to their pages, ${plan.params.length} parameter routes to /${GENERIC})  csp ${cspHash.slice(0, 19)}…`);
    Object.entries(versions).forEach(([f, v]) => console.log(`  data/${f.padEnd(18)} v=${v}`));
    if (problems.length) {
      problems.forEach(p => console.error(`WARNING  ${p}`));
      console.error('`node build.mjs --check` fails until these are resolved.');
    }
  }
}
