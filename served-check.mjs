#!/usr/bin/env node
/**
 * Is every address served what it should be?
 *
 *   node served-check.mjs                              http://localhost:8123 (node serve.mjs)
 *   node served-check.mjs http://localhost:8201        another local server
 *   node served-check.mjs --url https://quantum-tradeworks.vercel.app
 *                                                      production, after a deploy
 *
 * Zero dependencies and no browser: it asks the server, over HTTP, what a link
 * preview, a crawler or a reload is given — the HTML before any script runs.
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every address used to be served the same file, whose <head> is the
 * homepage's. The client fixed the title, the description and the canonical
 * once its script ran, so every check that looked at a rendered page passed —
 * and every WhatsApp, Slack, Facebook or LinkedIn preview of /pricing or
 * /status, and every crawler that reads HTML, saw the homepage. An address
 * that exists nowhere answered 200. None of that is visible from inside a
 * browser tab; all of it is one request away.
 *
 * WHAT IT HOLDS
 *
 * - Every route without a parameter is served 200 with its own head: the
 *   title, description and canonical that the client's setDocumentMeta sets
 *   there (evaluated out of src/js, as build.mjs evaluates it), og:url the
 *   canonical, og:/twitter: title and description the same; and apart from
 *   those tags the page is index.html byte for byte, but for loading the
 *   app's script and stylesheet from assets/ where index.html carries them
 *   inline. A query string changes nothing.
 * - The app's two files under assets/ are index.html's inline script and
 *   stylesheet byte for byte, served with a year's immutable cache and their
 *   own content type; every page and the 404 load exactly those two and
 *   weigh tens of kB, not the app's 3MB.
 * - Every company's own address (/company/<ticker or code>-<name>, as
 *   companyPath writes it) is served 200 with its own head — the title and
 *   canonical its page sets, and a description naming the company, its
 *   ticker, its market and whether its figures are filed with the SEC or
 *   illustrative, true to data/us.json — and is otherwise a route page.
 * - A parameter route (/company/:id …) is served the generic page, 200, at
 *   every other address it answers.
 * - An unknown address, a deep one, one in the wrong case, one past a route's
 *   last segment, is served 404 with the not-found title and noindex — the
 *   same app, which draws its not-found card.
 * - A trailing slash, or a trailing /index.html, is a 308 to the address
 *   without it, query kept; the site root's /index.html is a 308 to /.
 * - / is pages/home.app.html: index.html linked like every other page, under
 *   200kB, the app's script tag and #views in its first 32kB and its h1 in
 *   its first 64kB as text (plan item 1.2). index.html is served nowhere.
 * - data/*.json still serve; a missing data file is a 404, not an HTML page
 *   answering 200.
 * - The NAPIC extract whole, data/napic-h1-2025.json, is a 404, and no file
 *   the deployment holds carries more than one division's NAPIC benchmarks
 *   (plan item 1.6; the owner's D7).
 * - Every page carries the headers vercel.json gives its address, the CSP
 *   among them, and that CSP names the hash of the script it was served with.
 * - Every sitemap address is served its own page and names itself canonical.
 *
 * serve.mjs answers from the same vercel.json by the same rules, so this runs
 * in CI against it; run with --url after a deploy it says whether Vercel does
 * what serve.mjs says it does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientRouter, companyPlan, siteOrigin, appFiles, linked, PAGE_LIMIT, GENERIC, HOME, HOME_HEAD_BYTES, HOME_TEXT_BYTES, pageText, routePlan, prerenderScope, readRenders, navMarkup, NAV_SLOTS, myWorkspace,
  servedHtmlTag, servedReadsOf, FIRST_SCRIPT, FIRST_TAG, firstHash, readRecord, withServedRecord, unservedChrome, filedSeries } from './build.mjs';
import { journeysServed, ISLAND_PAGES, resultProblem, RUN_URL } from './journeys.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const BASE = (flag('url') || argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:8123').replace(/\/+$/, '');

const read = (f) => readFileSync(join(ROOT, f), 'utf8').split('\r\n').join('\n');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let failures = 0, passes = 0;
const fail = (msg, detail = []) => {
  failures++;
  console.error(`FAIL  ${msg}`);
  detail.slice(0, 15).forEach(d => console.error(`      ${d}`));
  if (detail.length > 15) console.error(`      … and ${detail.length - 15} more`);
};
const ok = (msg) => { passes++; console.log(`ok    ${msg}`); };
const judge = (problems, good, bad) => (problems.length ? fail(bad, problems) : ok(good));

/* ─── WHAT EACH ADDRESS SHOULD BE ─────────────────────────────────────────── */
const ORIGIN = siteOrigin(read('src/index.template.html'));
const router = clientRouter(ORIGIN);
const ROUTES = router.ROUTES;
const statics = [...new Set(ROUTES.filter(r => !r.path.includes(':')).map(r => r.path))]
  .filter(p => router.matchRoute(p).path === p);
const params = ROUTES.filter(r => r.path.includes(':')).map(r => r.path);
const NOT_FOUND = router.headAt('/404.html');
const expectHead = (path) => {
  const h = router.headAt(path);
  return { title: h.title, description: h.description, canonical: h.canonical, ogUrl: h.canonical,
    ogTitle: h.title, ogDescription: h.description, twitterTitle: h.title, twitterDescription: h.description, robots: null };
};

/* The headers vercel.json gives an address: every rule whose source matches,
   later rules winning, as the host applies them. The sources this site uses
   are regular expressions as they stand (literals and groups). */
const VERCEL = JSON.parse(read('vercel.json'));
/* The file each exact address is rewritten to. */
const FILE_OF = new Map((VERCEL.rewrites || []).filter(x => !x.source.includes(':')).map(x => [x.source, x.destination.replace(/^\//, '')]));
/* The file whose render an address's page carries: the site root's page,
   HOME, carries index.html's (build.mjs, THE SITE ROOT). */
const renderFileOf = (path) => { const f = FILE_OF.get(path); return f === HOME ? 'index.html' : f; };
const expectHeaders = (path) => {
  const out = {};
  for (const g of VERCEL.headers || []) {
    if (new RegExp(`^${g.source}$`).test(path)) g.headers.forEach(h => { out[h.key.toLowerCase()] = h.value; });
  }
  return out;
};
const DATA_VERSIONS = JSON.parse((read('index.html').match(/const DATA_VERSIONS = (\{[^;]*\});/) || [])[1] || '{}');

/* ─── WHAT IS SERVED ──────────────────────────────────────────────────────── */
const cache = new Map();
function get(path) {
  if (!cache.has(path)) {
    cache.set(path, (async () => {
      try {
        const r = await fetch(BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(90000) });
        const body = await r.text();
        return { path, status: r.status, headers: r.headers, type: r.headers.get('content-type') || '', body: body.split('\r\n').join('\n') };
      } catch (e) {
        return { path, status: 0, headers: new Headers(), type: '', body: '', error: e.cause?.code || e.message };
      }
    })());
  }
  return cache.get(path);
}
/* Several at a time, not all at once: each page is 3MB. */
async function getAll(paths, limit = 6) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < paths.length) { const p = paths[i++]; out.push(await get(p)); } }));
  return new Map(out.map(r => [r.path, r]));
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const HEAD_TAGS = {
  title:              /<title>([^<]*)<\/title>/,
  description:        /<meta name="description" content="([^"]*)">/,
  canonical:          /<link rel="canonical" href="([^"]*)">/,
  ogUrl:              /<meta property="og:url" content="([^"]*)">/,
  ogTitle:            /<meta property="og:title" content="([^"]*)">/,
  ogDescription:      /<meta property="og:description" content="([^"]*)">/,
  twitterTitle:       /<meta name="twitter:title" content="([^"]*)">/,
  twitterDescription: /<meta name="twitter:description" content="([^"]*)">/,
  robots:             /<meta name="robots" content="([^"]*)">/,
};
/* Each tag's value, null when absent; two of one tag is a finding of its own. */
function headOf(html) {
  const end = html.indexOf('</head>');
  const top = end < 0 ? '' : html.slice(0, end);
  return Object.fromEntries(Object.entries(HEAD_TAGS).map(([k, re]) => {
    const all = [...top.matchAll(new RegExp(re.source, 'g'))];
    return [k, all.length === 1 ? decode(all[0][1]) : (all.length ? `(${all.length} ${k} tags)` : null)];
  }));
}
/* The page less the tags a route may change: what must be index.html's.
   Less, too, what a page carries of its own since 2026-10-03: its
   navigation, and — a page with a render — its chrome, its tab row and its
   render in #views.
   EXACTLY THOSE, AND ONLY WHERE THE PAGE HAS THEM (2026-10-04). Each was taken
   out of every page whatever it held (build.mjs's unserved, now gone), so a page with
   no render was compared with nothing there: a company's page served
   /pricing's content in #views, the public chrome, and an off-site
   "Business Intelligence" link in its footer passed, as "index.html in every
   other byte" — and group 12 looked at three sample addresses, not the 138
   company pages. Now what is taken out is what the page must carry, byte for
   byte: the navigation NAV_MARKUP draws (marked as the page's render marked
   it), and for a page in prerender's scope its committed render, tab row and
   chrome. Anything else is left in, and differs. */
const RENDER_PLAN = routePlan(read('src/index.template.html'));
const RENDERED = readRenders(prerenderScope(RENDER_PLAN));
/* An island page's render as its page carries it: the committed record in
   its slots (build.mjs, THE RESULT, SERVED). */
const SERVED_RECORD = journeysServed(readRecord());
const servedViews = (rd) => withServedRecord(rd, SERVED_RECORD);
const NAV = navMarkup();
const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function withoutOwn(html, file) {
  const rd = file ? RENDERED.renders.get(file) : null;
  const nav = NAV(rd ? rd.manifest.nav : null, rd ? rd.manifest.chrome : 'public');
  let out = html;
  const take = (from, to) => { out = out.replace(from, () => to); };
  /* With what its render read, for the head's script (build.mjs, BEFORE THE
     FIRST PAINT; 2026-10-04). */
  if (rd) take(servedHtmlTag(rd), '<html lang="en">');
  for (const [slot, [open, close]] of Object.entries(NAV_SLOTS)) take(open + nav[slot] + close, open + close);
  if (rd && rd.tabs !== null) take(`<div class="ptabs-host" id="productTabs">${rd.tabs}</div>`, '<div class="ptabs-host" id="productTabs" hidden></div>');
  if (rd) take(`<div id="views" data-served="${attrEsc(rd.path)}">${servedViews(rd)}</div>`, '<div id="views"></div>');
  /* And its chrome in the template's order: a page is served in its own
     chrome first and the other after its page (plan item 3.5, servedChrome). */
  return unservedChrome(out);
}
/* file: the page's file, whose render (if it has one) it may carry; none
   for a page that may carry none. */
const skeleton = (html, file = null) => {
  html = withoutOwn(html, file);
  const end = html.indexOf('</head>');
  let top = html.slice(0, end);
  for (const re of Object.values(HEAD_TAGS)) top = top.replace(new RegExp(re.source.replace('([^<]*)', '[^<]*').replace('([^"]*)', '[^"]*') + '\\n?', 'g'), '');
  return sha(top + html.slice(end));
};
const scriptHash = (code) => 'sha256-' + createHash('sha256').update(code, 'utf8').digest('base64');
/* A page's scripts: the inline ones' text, and the addresses of the others. */
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const scriptSrcs = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"[^>]*>/g)].map(m => m[1]);
const stylesheets = (html) => [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]*)"[^>]*>/g)].map(m => m[1]);

/* The headers vercel.json gives this address, each present with its value,
   and a CSP that lets this very response run what it carries: the hash of
   each inline script (index.html's), and 'self' for a script it loads from
   this site (every other page's, assets/app.<hash>.js). */
function headerProblems(res, { html = true } = {}) {
  const p = [];
  for (const [k, v] of Object.entries(expectHeaders(res.path.split('?')[0]))) {
    const got = res.headers.get(k);
    if (got !== v) p.push(`${res.path}: ${k} is ${got === null ? 'absent' : JSON.stringify(got.slice(0, 80))}${got === null ? '' : `, not ${JSON.stringify(v.slice(0, 80))}`}`);
  }
  if (html) {
    const csp = res.headers.get('content-security-policy') || '';
    const directive = (name) => ` ${(csp.match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`)) || [])[1] || ''} `;
    const scriptSrc = directive('script-src'), styleSrc = directive('style-src');
    const inline = inlineScripts(res.body), srcs = scriptSrcs(res.body);
    if (inline.some(code => !scriptSrc.includes(` '${scriptHash(code)}' `))) p.push(`${res.path}: the Content-Security-Policy does not name the hash of the script this page carries`);
    for (const s of srcs) if (!/^\/(?!\/)/.test(s) || !scriptSrc.includes(" 'self' ")) p.push(`${res.path}: loads the script ${s}, which its Content-Security-Policy does not allow`);
    for (const s of stylesheets(res.body)) if (!/^\/(?!\/)/.test(s) || !styleSrc.includes(" 'self' ")) p.push(`${res.path}: loads the stylesheet ${s}, which its Content-Security-Policy does not allow`);
    if (!inline.length && !srcs.length) p.push(`${res.path}: carries no script at all`);
  }
  return p;
}
const described = (r) => (r.status ? `${r.status} ${r.type.split(';')[0]}` : `no answer (${r.error})`);

console.log(`served-check  ${BASE}\n`);

/* The generic page, and the check that the server is this checkout's. */
const res0 = await getAll(['/', '/index.html']);
const root = res0.get('/'), indexFile = res0.get('/index.html');
if (!root.status) { console.error(`FAIL  nothing answered at ${BASE} (${root.error}) — start one with: node serve.mjs --port <port>`); process.exit(1); }
const INDEX = read('index.html');
/* Every page but index.html loads the app — index.html's own inline script
   and stylesheet, written once each as assets/app.<hash>.js and .css — where
   index.html carries it (build.mjs, THE APP ONCE). So a route page or the 404
   page is index.html with that one swap, outside the head's own tags. */
const APP = appFiles(INDEX);
const PAGE_SKELETON = skeleton(linked(INDEX, APP), 'index.html');
/* The site root is served the home page (plan item 1.2, build.mjs THE SITE
   ROOT): this checkout's pages/home.app.html, which is index.html linked —
   and so it says whether a deploy has landed, as /index.html said before.
   index.html itself is served nowhere: /index.html is a 308 to /. */
const HOME_PAGE = read(HOME);
{
  const p = [];
  if (HOME_PAGE !== linked(INDEX, APP)) p.push(`${HOME} is not index.html linked — run node build.mjs`);
  if (root.status !== 200 || root.body !== HOME_PAGE) p.push(`/: ${described(root)}, ${root.body === HOME_PAGE ? `this checkout's ${HOME}` : root.body === INDEX ? 'index.html, the app inline — the host deployed it, and served it before the rewrite of / (.vercelignore not honoured?)' : `NOT this checkout's ${HOME} (a deploy not landed, or another build)`}`);
  const loc = indexFile.headers.get('location');
  if (indexFile.status !== 308 || !loc || new URL(loc, BASE).href !== new URL('/', BASE).href) p.push(`/index.html: ${described(indexFile)}${loc ? ` to ${loc}` : ''}, not a 308 to /`);
  judge(p, `/ is served this checkout's ${HOME} (index.html linked), and /index.html is a 308 to /`, `/ is not served the home page, or /index.html is not a 308 to /`);
}

/* 1. Every route without a parameter: its own head. */
{
  const got = await getAll(statics);
  const p = [];
  for (const path of statics) {
    const r = got.get(path);
    if (r.status !== 200 || !/text\/html/.test(r.type)) { p.push(`${path}: ${described(r)}`); continue; }
    const want = expectHead(path), have = headOf(r.body);
    for (const k of Object.keys(want)) if (have[k] !== want[k]) p.push(`${path}: ${k} is ${JSON.stringify(have[k])}, not ${JSON.stringify(want[k])}`);
    /* The site root is index.html itself, the app inline. */
    /* The site root too, since plan item 1.2: index.html linked. */
    if (skeleton(r.body, renderFileOf(path)) !== PAGE_SKELETON) p.push(`${path}: differs from index.html outside the route's own tags and the two app files it loads`);
    p.push(...headerProblems(r));
  }
  judge(p, `every route without a parameter (${statics.length}) is served 200 with its own title, description, canonical, og: and twitter: tags, is index.html in every other byte but the two app files it loads in place of the inline ones, and carries vercel.json's headers with a CSP allowing its script`,
    'a route without a parameter is not served its own head');
}

/* 2. A query string plays no part in which page is served. */
{
  const pairs = [['/pricing?utm_source=served-check&tab=x', '/pricing'], ['/?real=0', '/'], ['/discover?tab=heatmap', '/discover'], ['/learn?tab=scoring', '/learn']];
  const got = await getAll(pairs.flat());
  const p = pairs.filter(([a, b]) => got.get(a).status !== 200 || got.get(a).body !== got.get(b).body)
    .map(([a, b]) => `${a}: ${described(got.get(a))}, ${got.get(a).body === got.get(b).body ? 'same page' : `not the page ${b} is served`}`);
  judge(p, `a query string changes nothing about which page is served (${pairs.length} addresses)`, 'a query string changed the page served');
}

/* 3. Parameter routes: the generic page, 200. And the addresses the router
      accepts outside the table's own forms: a dotted registry id it rewrites
      to the company's own segment, and the app's file name. The sample id is
      a ticker, not a company's own address (aapl-apple-inc), which has a
      page of its own since Release B — group 11. */
{
  const SAMPLE = { id: 'aapl', tab: 'financials', setup: 'no-such-setup', alert: 'a00000000' };
  const paths = [...params.map(r => r.replace(/:([A-Za-z]+)/g, (_, n) => SAMPLE[n] || `sample-${n}`)), '/company/1155.KL', '/app/equities/1155.KL/financials'];
  const got = await getAll(paths);
  const p = [];
  /* The generic page is pages/generic.app.html since 2026-10-03: index.html
     carries the homepage itself in #views now, which a parameter route —
     whose page the router decides — must not be served. It is index.html's
     head and the app, with nothing in #views. */
  const GENERIC_PAGE = read(GENERIC);
  /* And no address of its own (2026-10-04): it carried index.html's
     canonical, telling a crawler that runs no script that every company
     report and setup address was the homepage. Its title and description are
     index.html's; it names no canonical and no og:url, and says noindex,
     until the script writes the page's own. */
  const gh = headOf(GENERIC_PAGE), ih = headOf(INDEX);
  if (skeleton(GENERIC_PAGE) !== PAGE_SKELETON || gh.title !== ih.title || gh.description !== ih.description) p.push(`${GENERIC}: not index.html's title and description, and the app`);
  if (gh.canonical !== null || gh.ogUrl !== null || gh.robots !== 'noindex') p.push(`${GENERIC}: names an address of its own (canonical ${gh.canonical}, og:url ${gh.ogUrl}, robots ${gh.robots}) — it is the page of every parameter route, none of them the homepage`);
  if (!GENERIC_PAGE.includes('<div id="views"></div>')) p.push(`${GENERIC}: carries a page in #views`);
  for (const path of paths) {
    const r = got.get(path);
    if (r.status !== 200) { p.push(`${path}: ${described(r)}`); continue; }
    if (r.body !== GENERIC_PAGE) p.push(`${path}: not the generic page (${GENERIC})`);
    p.push(...headerProblems(r));
  }
  if (root.status !== 200 || root.body !== HOME_PAGE) p.push(`/: ${described(root)}, not ${HOME}`);
  judge(p, `every parameter route (${params.length}) and a dotted company id are served the generic page (${GENERIC}: index.html's title and description, no canonical, noindex, nothing in #views), 200, with the headers; / is ${HOME}`,
    'a parameter route is not served the generic page');
}

/* 4. Unknown addresses: 404, the not-found head, noindex — and the same app. */
{
  const unknown = ['/nope-xyz', '/deep/unknown/path/for-served-check', '/PRICING', '/Pricing', '/pricing.html', '/index.htm',
    '/company', '/company/aapl-apple-inc/report/extra', '/app/scanner/setups/x/edit/more', '/pages', '/pages/pricing', '/my'];
  const got = await getAll(unknown);
  const p = [];
  for (const path of unknown) {
    const r = got.get(path);
    if (r.status !== 404 || !/text\/html/.test(r.type)) { p.push(`${path}: ${described(r)}, not 404 text/html`); continue; }
    const h = headOf(r.body);
    if (h.title !== NOT_FOUND.title) p.push(`${path}: title ${JSON.stringify(h.title)}, not ${JSON.stringify(NOT_FOUND.title)}`);
    if (h.robots !== 'noindex') p.push(`${path}: robots is ${JSON.stringify(h.robots)}, not "noindex"`);
    if (h.canonical !== null || h.ogUrl !== null) p.push(`${path}: a 404 names an address of its own (canonical ${h.canonical}, og:url ${h.ogUrl})`);
    if (skeleton(r.body) !== PAGE_SKELETON) p.push(`${path}: not the app — it differs from index.html outside the head's own tags and the two app files it loads`);
    p.push(...headerProblems(r));
  }
  judge(p, `unknown, deep, wrong-case and overlong addresses (${unknown.length}) answer 404 with the not-found title, noindex, no canonical, the app's own page and the headers`,
    'an unknown address is not a 404 with the not-found page');
}

/* 5. A trailing slash is one redirect to the address without it; so is a
      trailing /index.html, which names its folder — on the 404 page the
      router took that folder for the app's own and drew the homepage. */
{
  const cases = [['/pricing/', '/pricing'], ['/pricing/?a=1&b=two', '/pricing?a=1&b=two'], ['/app/scanner/setups/', '/app/scanner/setups'],
    ['/company/aapl-apple-inc/', '/company/aapl-apple-inc'], ['/pricing/index.html', '/pricing'], ['/nope-folder/index.html?x=1', '/nope-folder?x=1'],
    ['/app/scanner/setups/index.html', '/app/scanner/setups'], ['/index.html', '/'], ['/index.html?x=1&tab=two', '/?x=1&tab=two']];
  const got = await getAll(cases.map(c => c[0]));
  const p = [];
  for (const [from, to] of cases) {
    const r = got.get(from);
    const loc = r.headers.get('location');
    const at = loc ? new URL(loc, BASE) : null;
    if (r.status !== 308 || !at || at.origin !== new URL(BASE).origin || at.pathname + at.search !== to)
      p.push(`${from}: ${r.status} ${loc ? `to ${loc}` : 'with no Location'}, not 308 to ${to}`);
  }
  judge(p, `a trailing slash or /index.html is a 308 to the address without it, query kept (${cases.length} addresses)`, 'a trailing slash or /index.html is not redirected as vercel.json says');
}

/* 6. The files: data (as the app asks for it, and bare), a missing data file,
      and the site's own plain files. */
{
  const files = Object.entries(DATA_VERSIONS).flatMap(([f, v]) => [`/data/${f}?v=${v}`, `/data/${f}`]);
  const plain = ['/sitemap.xml', '/robots.txt', '/og.png'];
  const got = await getAll([...files, ...plain, '/data/no-such-file.json']);
  const p = [];
  if (!files.length) p.push('index.html carries no DATA_VERSIONS to ask for');
  for (const path of files) {
    const r = got.get(path);
    if (r.status !== 200 || !/json/.test(r.type)) { p.push(`${path}: ${described(r)}`); continue; }
    try { JSON.parse(r.body); } catch { p.push(`${path}: does not parse as JSON`); }
    const want = read(`data/${path.slice(6).split('?')[0]}`);
    if (r.body !== want) p.push(`${path}: not this checkout's file`);
    p.push(...headerProblems(r, { html: false }));
  }
  for (const path of plain) { const r = got.get(path); if (r.status !== 200) p.push(`${path}: ${described(r)}`); }
  const miss = got.get('/data/no-such-file.json');
  if (miss.status !== 404) p.push(`/data/no-such-file.json: ${described(miss)}, not 404 — a missing file must not look present`);
  judge(p, `data/*.json (${files.length} requests, versioned and bare) serve this checkout's files with the data cache headers; a missing one is 404; sitemap, robots and og.png serve`,
    'a file does not serve as it should');
}

/* 6b. NAPIC, ONE DIVISION A FILE (plan item 1.6; the owner's D7, 6 Oct 2026).
      data/napic-h1-2025.json, the whole extract, was served: one 1MB
      download of all 1,583 benchmarks across twelve divisions, against its
      own licence note ("bulk export and raw-file download stay disabled
      until JPPH confirms commercial redistribution rights"). It stays in the
      repository as the source, and .vercelignore keeps it off the host.
      Held here as served:
      - /data/napic-h1-2025.json is a 404, bare and as the app used to ask
        for it (?v=);
      - no served file holds more than one division's benchmarks: every file
        the deployment holds (the tracked files less .vercelignore's) is
        asked for, a JSON one read for benchmark rows (an object with a
        scheme and a min or a max) and the divisions they are filed under,
        any other text one for a benchmark row written out as JSON.
      Locally serve.mjs applies .vercelignore as Vercel does; only --url
      against production shows that Vercel itself leaves the file out. */
{
  const p = [];
  const SOURCE = '/data/napic-h1-2025.json';
  const whole = await getAll([SOURCE, `${SOURCE}?v=0123456789ab`]);
  for (const r of whole.values()) if (r.status !== 404) p.push(`${r.path}: ${described(r)}, not 404 — the whole NAPIC extract is served`);
  /* The files the deployment holds: tracked (and new, not ignored) files
     less what .vercelignore leaves out; a copy with no git (git archive) is
     those files already. */
  const ignoredByHost = new Set(read('.vercelignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
  let deployed;
  try {
    deployed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
  } catch {
    const walk = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap(d => {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) return ['.git', 'node_modules', '.claude', '.vercel'].includes(d.name) ? [] : walk(r);
      return [r];
    });
    deployed = walk('');
  }
  deployed = [...new Set(deployed)].filter(f => !ignoredByHost.has(`/${f}`) && existsSync(join(ROOT, f)));
  const TEXT = /\.(json|m?js|html|css|txt|xml|csv|md|yml|ps1)$/i;
  const asked = deployed.filter(f => TEXT.test(f)).map(f => `/${f.split('/').map(encodeURIComponent).join('/')}`);
  const got = await getAll(asked);
  /* The divisions a document's benchmark rows are filed under: a row's own
     division, or the nearest enclosing object's. */
  const divisionsIn = (doc) => {
    const out = new Set();
    let rows = 0;
    const visit = (v, division) => {
      if (Array.isArray(v)) { v.forEach(x => visit(x, division)); return; }
      if (!v || typeof v !== 'object') return;
      const here = typeof v.division === 'string' ? v.division : division;
      if (typeof v.scheme === 'string' && ('min' in v || 'max' in v)) { rows++; out.add(here || '(no division named)'); }
      for (const x of Object.values(v)) if (x && typeof x === 'object') visit(x, here);
    };
    visit(doc, null);
    return { divisions: [...out], rows };
  };
  const ROW_AS_JSON = /"scheme"\s*:\s*"[^"]*"[^{}]*"(min|max)"\s*:/;
  let servedText = 0, holding = 0;
  for (const path of asked) {
    const r = got.get(path);
    if (r.status !== 200) continue;
    servedText++;
    if (/\.json$/i.test(path)) {
      let doc;
      try { doc = JSON.parse(r.body); } catch { continue; }
      const { divisions, rows } = divisionsIn(doc);
      if (rows) holding++;
      if (divisions.length > 1) p.push(`${path}: ${rows} benchmark rows of ${divisions.length} divisions (${divisions.slice(0, 4).join(', ')}${divisions.length > 4 ? ', …' : ''}), ${Buffer.byteLength(r.body).toLocaleString('en-US')} bytes`);
    } else if (ROW_AS_JSON.test(r.body)) p.push(`${path}: carries a NAPIC benchmark row written out as JSON`);
  }
  if (!holding) p.push('no served file holds a NAPIC benchmark row: the area screen has nothing to read');
  judge(p, `${SOURCE} is a 404, bare and versioned; of the ${servedText} text files the deployment holds, ${holding} hold NAPIC benchmarks, each one division's`,
    'the NAPIC extract is served beyond one division a file');
}

/* 7. The sitemap names only canonical addresses, each served its own page. */
{
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  const paths = locs.map(l => (l.startsWith(ORIGIN) ? l.slice(ORIGIN.length) : null));
  const got = await getAll(paths.filter(Boolean));
  const p = [];
  locs.forEach((loc, i) => {
    if (!paths[i]) { p.push(`${loc} is not on ${ORIGIN}`); return; }
    const r = got.get(paths[i]);
    if (r.status !== 200) { p.push(`${paths[i]}: ${described(r)}`); return; }
    const c = headOf(r.body).canonical;
    if (c !== loc) p.push(`${paths[i]}: served with canonical ${c}`);
  });
  /* And each says when its page last changed (plan item 1.3): one <lastmod>
     per <url>, a day, in the sitemap that is served — this checkout's. */
  const served = (await getAll(['/sitemap.xml'])).get('/sitemap.xml');
  const urls = [...(served.body || '').matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
  if ((served.body || '').split('\r\n').join('\n') !== read('sitemap.xml')) p.push(`/sitemap.xml: ${described(served)}, not this checkout's file`);
  urls.forEach(u => {
    const days = [...u.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map(m => m[1]);
    if (days.length !== 1 || !/^\d{4}-\d\d-\d\d$/.test(days[0])) p.push(`${(/<loc>([^<]+)/.exec(u) || [])[1]}: ${days.length} <lastmod> (${days.join(', ') || 'none'}), not one day`);
  });
  if (urls.length !== locs.length) p.push(`/sitemap.xml serves ${urls.length} <url>s, this checkout's lists ${locs.length}`);
  judge(p, `every sitemap address (${locs.length}) is served 200 with itself as its canonical, and the served sitemap gives each one <lastmod>`, 'a sitemap address is not served as its own canonical, or has no <lastmod>');
}

/* ---- audit: verify ---- */
/* 8. What serve.mjs answered differently from Vercel. Each source in
      vercel.json was compiled by @vercel/routing-utils — what Vercel turns
      vercel.json into — and compared with serve.mjs's compilation over 122
      addresses: every rewrite, redirect and header source agreed, and the
      trailing-slash rule did not. Vercel's is ^/(.*)\/$ to /$1, one slash per
      redirect; serve.mjs answered /pricing// with a 404 and // with a 400.
      Held here by where the reader lands, not by the hops, so a host that
      folds a run of slashes before routing passes as well.
      And a file name in the wrong case (/INDEX.HTML, /Data/us.json) was
      served 200 here, off a case-insensitive disk, where Vercel's
      case-sensitive one has no such file. Last, no redirect may send a reader
      off this site: //example.com/ must not become a Location of
      //example.com, which a browser reads as another host. */
{
  /* Where a run of slashes ends up, following this site's own redirects: the
     rule takes one slash per 308, and a host that folds the run first would
     answer sooner — either way the reader must land on the page. */
  const follow = async (path) => {
    const hops = [];
    for (let at = path; hops.length < 5;) {
      const r = await fetch(BASE + at, { redirect: 'manual', signal: AbortSignal.timeout(90000) }).catch(e => ({ status: 0, error: e.message, headers: new Headers() }));
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) {
        const next = new URL(loc, BASE + at);
        if (next.origin !== new URL(BASE).origin) return { hops, status: r.status, offsite: loc };
        hops.push(`${r.status} ${next.pathname}${next.search}`);
        at = next.pathname + next.search;
        continue;
      }
      return { hops, status: r.status, at, canonical: r.status === 200 ? headOf(await r.text()).canonical : null };
    }
    return { hops, status: 'too many redirects' };
  };
  const slash = [['/pricing//', '/pricing'], ['//', '/'], ['/app/scanner//?q=1', '/app/scanner?q=1']];
  const cased = ['/INDEX.HTML', '/Index.html', '/Data/us.json', '/data/US.json', '/Pages/pricing.html', '/pages/Pricing.html', '/404.HTML', '/Og.png'];
  const offsite = ['//example.com/', '//example.com/index.html', '///example.com/'];
  const got = await getAll([...cased, ...offsite]);
  const p = [];
  for (const [from, to] of slash) {
    const f = await follow(from);
    const page = to.split('?')[0];
    if (f.status !== 200 || f.at !== to || f.canonical !== ORIGIN + page)
      p.push(`${from}: ${[...f.hops, f.offsite ? `off the site to ${f.offsite}` : `${f.status}${f.at ? ` at ${f.at}` : ''}`].join(' → ')}, not the page at ${to}`);
  }
  for (const path of cased) {
    const r = got.get(path);
    if (r.status !== 404) p.push(`${path}: ${described(r)} — a file name in the wrong case is not a file on Vercel`);
    else if (headOf(r.body).title !== NOT_FOUND.title) p.push(`${path}: 404, but not the not-found page`);
  }
  for (const path of offsite) {
    const r = got.get(path), loc = r.headers.get('location');
    if (loc && new URL(loc, BASE).origin !== new URL(BASE).origin) p.push(`${path}: ${r.status} to ${loc} — a redirect off this site`);
  }
  judge(p, `a run of trailing slashes lands on its page, query kept (${slash.length}), a file name in the wrong case is a 404 (${cased.length}), and no redirect leaves the site (${offsite.length})`,
    'an address is not answered as Vercel answers it');
}
/* ---- end audit: verify ---- */

/* ---- audit: slim ---- */
/* 9. THE APP ONCE. Every page under pages/ and 404.html was a whole copy of
      index.html, 3.3MB with the app's script inline: 202MB deployed where
      13.5MB had been, 177MB rewritten into git by every rebuild, and the
      whole app sent as the 404 to every bot probing /wp-login.php or /.env.
      The build now writes the script and the stylesheet once each, as
      assets/app.<first 12 hex of their SHA-256>.js and .css, and each page
      loads them where index.html carries them inline. Held here as served:
      - the two files answer 200 with exactly index.html's inline bytes (and
        the name is the hash of those bytes), a year's immutable cache, their
        own content type and nosniff;
      - every page and the 404 page load exactly those two, carry no inline
        script or stylesheet, and weigh at most PAGE_LIMIT (build.mjs);
      - index.html still carries the app inline, and loads nothing else —
        the tools read the engine out of it, and its CSP hash names it;
      - a name the build does not write is a 404 and is not told to stay in
        a cache for a year, and a bot's probe is a 404 of a page's weight. */
{
  const p = [];
  const APP_FILES = [['script', APP.script, /^(text|application)\/javascript;\s*charset=utf-8$/i], ['stylesheet', APP.styles, /^text\/css;\s*charset=utf-8$/i]];
  for (const [kind, f, type] of APP_FILES) {
    /* As bytes: the text helper above folds CRLF, which would hide one. */
    const r = await fetch(`${BASE}/${f.file}`, { signal: AbortSignal.timeout(90000) }).catch(e => ({ status: 0, error: e.message, headers: new Headers() }));
    if (r.status !== 200) { p.push(`/${f.file}: ${r.status || r.error}, not 200`); continue; }
    const bytes = Buffer.from(await r.arrayBuffer());
    const want = Buffer.from(f.body, 'utf8');
    if (!bytes.equals(want)) p.push(`/${f.file}: ${bytes.length} bytes, not index.html's inline ${kind} (${want.length} bytes) byte for byte`);
    const named = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    if (!f.file.endsWith(`app.${named}.${kind === 'script' ? 'js' : 'css'}`)) p.push(`/${f.file}: its bytes hash to ${named}, which is not its name`);
    if (r.headers.get('cache-control') !== 'public, max-age=31536000, immutable') p.push(`/${f.file}: Cache-Control ${JSON.stringify(r.headers.get('cache-control'))}, not a year's immutable cache`);
    if (!type.test(r.headers.get('content-type') || '')) p.push(`/${f.file}: Content-Type ${JSON.stringify(r.headers.get('content-type'))}, not the ${kind}'s, with charset=utf-8`);
    if (r.headers.get('x-content-type-options') !== 'nosniff') p.push(`/${f.file}: no X-Content-Type-Options: nosniff`);
  }
  /* Every page, reached at every address that serves one, and the 404. */
  const pages = await getAll([...statics, '/nope-xyz', '/deep/unknown/path/for-served-check', '/wp-login.php', '/.env']);
  let largest = ['', 0];
  /* Addresses only a bot asks for. Vercel's own firewall answers some of them
     before any rewrite runs (on production, /wp-login.php is a 403 text/plain
     from the platform), which is better than our 404 page: what must hold is
     that a probe is never sent the app — a small 404 page, or a block. */
  const PROBES = ['/wp-login.php', '/.env'];
  for (const [path, r] of pages) {
    if (!r.status) { p.push(`${path}: ${described(r)}`); continue; }
    if (PROBES.includes(path) && (r.status === 403 || r.status === 404) && !/text\/html/i.test(r.headers.get('content-type') || '')) {
      if (Buffer.byteLength(r.body, 'utf8') > PAGE_LIMIT) p.push(`${path}: a ${r.status} of ${(Buffer.byteLength(r.body, 'utf8') / 1024).toFixed(0)}kB — a probe is sent too much`);
      continue;
    }
    const size = Buffer.byteLength(r.body, 'utf8');
    if (size > largest[1]) largest = [path, size];
    if (size > PAGE_LIMIT) p.push(`${path}: ${(size / 1024).toFixed(0)}kB, over the ${PAGE_LIMIT / 1024}kB a page may weigh — the app is in it again`);
    /* But the first-paint script every page carries in its head (build.mjs,
       BEFORE THE FIRST PAINT), held in group 13. */
    const inline = inlineScripts(r.body).filter(code => code !== FIRST_SCRIPT).length + (r.body.match(/<style[\s>]/g) || []).length;
    if (inline) p.push(`${path}: carries ${inline} inline <script> or <style>, which only index.html may`);
    const srcs = scriptSrcs(r.body), css = stylesheets(r.body);
    if (srcs.length !== 1 || srcs[0] !== `/${APP.script.file}`) p.push(`${path}: loads the scripts ${JSON.stringify(srcs)}, not /${APP.script.file} alone`);
    if (css.length !== 1 || css[0] !== `/${APP.styles.file}`) p.push(`${path}: loads the stylesheets ${JSON.stringify(css)}, not /${APP.styles.file} alone`);
    if (PROBES.includes(path) && r.status !== 404) p.push(`${path}: ${described(r)}, not 404 or a platform block`);
  }
  /* index.html is the app whole, as every tool that reads it expects: the
     checkout's file, since it is served nowhere (plan item 1.2). */
  const indexInline = inlineScripts(INDEX).filter(code => code !== FIRST_SCRIPT);
  if (scriptSrcs(INDEX).length || stylesheets(INDEX).length || indexInline.length !== 1 || indexInline[0] !== APP.script.body)
    p.push(`index.html: does not carry the app inline and alone (${inlineScripts(INDEX).length} inline, loads ${JSON.stringify([...scriptSrcs(INDEX), ...stylesheets(INDEX)])})`);
  /* A name the build does not write, and the folder itself. */
  const gone = await getAll(['/assets/app.000000000000.js', '/assets/app.000000000000.css', '/assets/', '/assets']);
  for (const [path, r] of gone) {
    if (path === '/assets/') { if (r.status !== 308 && r.status !== 404) p.push(`${path}: ${described(r)}`); continue; }
    if (r.status !== 404) p.push(`${path}: ${described(r)}, not 404`);
    if (/immutable/.test(r.headers.get('cache-control') || '')) p.push(`${path}: a 404 told to stay in a cache for a year (${r.headers.get('cache-control')})`);
  }
  judge(p, `the app is served once: /${APP.script.file} (${(Buffer.byteLength(APP.script.body) / 1024).toFixed(0)}kB) and /${APP.styles.file} (${(Buffer.byteLength(APP.styles.body) / 1024).toFixed(0)}kB) are index.html's inline bytes with a year's immutable cache and their content type; ${pages.size} page and 404 addresses load exactly those two, the largest ${(largest[1] / 1024).toFixed(0)}kB (${largest[0]}); index.html keeps the app inline; a stale name is an uncached 404`,
    'the app is not served once, or a page carries it again');
}
/* ---- end audit: slim ---- */

/* ---- audit1: health ---- */
/* 10. THE JOURNEYS' RESULT, AS IT IS NOW. /status reads health/journeys.json,
      which the journeys workflow rewrites after a run against the live site
      (journeys.mjs, .github/workflows/journeys.yml). Unlike data/ and
      assets/, whose names change with their bytes and are cached for a
      year, this file keeps its name and changes, so:
      - it is served 200 as JSON with Cache-Control no-cache — revalidated
        on every read, never kept as the result of a week ago;
      - the build does not stamp it: no version in the app's DATA_VERSIONS.
        (It does write it into the island pages — /status and the three
        product landing pages — and the workflow commits them with it,
        rebuilt; THE JOURNEYS' RESULT, SERVED, below);
      - it is a journeys result, or the placeholder committed before the
        first run (the page says "not run yet" for it). */
{
  const p = [];
  const r = await fetch(`${BASE}/health/journeys.json`, { signal: AbortSignal.timeout(30000) }).catch(e => ({ status: 0, error: e.message, headers: new Headers(), text: async () => '' }));
  let doc = null;
  if (r.status !== 200) p.push(`/health/journeys.json: ${r.status || r.error}, not 200 — the placeholder is committed, so there is always a file`);
  else {
    if (!/^application\/json/i.test(r.headers.get('content-type') || '')) p.push(`/health/journeys.json: Content-Type ${JSON.stringify(r.headers.get('content-type'))}, not JSON`);
    if ((r.headers.get('cache-control') || '') !== 'no-cache') p.push(`/health/journeys.json: Cache-Control ${JSON.stringify(r.headers.get('cache-control'))}, not no-cache — a reader could be shown an old result`);
    try { doc = JSON.parse(await r.text()); } catch { p.push('/health/journeys.json: not JSON'); }
    if (doc && doc.kind !== 'quantum-tradeworks-journeys') p.push(`/health/journeys.json: kind ${JSON.stringify(doc.kind)}, not a journeys result`);
  }
  const versions = /const DATA_VERSIONS = (\{[^;]*\});/.exec(APP.script.body);
  if (!versions) p.push('the app carries no DATA_VERSIONS to check');
  else if (Object.keys(JSON.parse(versions[1])).some(k => /journeys|health/.test(k))) p.push(`the build stamps a version on the journeys file (${versions[1]}), so build --check would depend on a file the workflow rewrites`);
  judge(p, `/health/journeys.json is served as JSON with no-cache and is not versioned by the build (${doc?.ranAt ? `a run of ${doc.ranAt}` : 'the placeholder: no run recorded yet'})`,
    'the journeys result is not served as it is now');
}
/* ---- end audit1: health ---- */

/* ---- releaseB: D ---- */
/* 11. EVERY COMPANY'S OWN ADDRESS, ITS OWN HEAD (Release B, D1 and D2). The
       address a company is linked at — companyPath's /company/<ticker, or a
       Bursa listing code>-<two words of its name> — was served index.html as
       every company address was, so a preview of Apple's page was the
       homepage's, canonical and all. build.mjs now writes a page there for
       each company in the universe the page assembles (ONE HEAD PER
       COMPANY). Held here as served:
       - every company's own address answers 200 with its own title,
         description, canonical, og: and twitter: tags as build.mjs derives
         them from the router and the loader in src/js — a page left from an
         earlier build or an earlier data/us.json differs, and fails — is
         index.html in every other byte but the two app files it loads,
         carries the headers, and weighs at most PAGE_LIMIT: a page, not the
         app;
       - what each description says is true to the company, read here from
         data/us.json itself rather than from the build: every filer in it is
         named with its name and ticker, "listed in the US" and "filed with
         the SEC" with its own CIK, on exactly one page, and no other page
         says "filed"; every other company carries the page's own
         illustrative line, and a Bursa one its listing code and "listed on
         Bursa Malaysia";
       - each company address has one exact rewrite to its own page, listed
         before /company/:id, and no rewrite names a company the universe no
         longer holds;
       - every other form of a company address — a ticker, an id, a CIK, a
         registry alias, a shorter, longer or differently-cased tail, the
         report, the brief's /app/equities/… — and an unknown company are
         still the generic page, 200, where the router resolves the company
         or draws the not-found card with noindex, as it did;
       - a query string on a company's address changes nothing. */
{
  const p = [];
  const { companies } = companyPlan(ORIGIN, router);
  const got = await getAll(companies.map(co => co.path));
  let largest = ['', 0], total = 0;
  for (const co of companies) {
    const r = got.get(co.path);
    if (r.status !== 200 || !/text\/html/.test(r.type)) { p.push(`${co.path}: ${described(r)}`); continue; }
    const h = co.head;
    const want = { title: h.title, description: h.description, canonical: h.canonical, ogUrl: h.canonical, ogTitle: h.title,
      ogDescription: h.description, twitterTitle: h.title, twitterDescription: h.description, robots: h.noindex ? 'noindex' : null };
    const have = headOf(r.body);
    for (const k of Object.keys(want)) if (have[k] !== want[k]) p.push(`${co.path}: ${k} is ${JSON.stringify(have[k])}, not ${JSON.stringify(want[k])}`);
    /* A filer's page carries its committed render as well (company-prerender,
       below); an illustrative company's carries none. */
    if (skeleton(r.body, renderFileOf(co.path)) !== PAGE_SKELETON) p.push(`${co.path}: differs from index.html outside its own head, ${co.company.real ? 'its committed render, ' : ''}and the two app files it loads`);
    p.push(...headerProblems(r));
    const size = Buffer.byteLength(r.body, 'utf8');
    total += size;
    if (size > largest[1]) largest = [co.path, size];
    if (size > PAGE_LIMIT) p.push(`${co.path}: ${(size / 1024).toFixed(0)}kB, over the ${PAGE_LIMIT / 1024}kB a page may weigh`);
  }

  /* True to the company: the served descriptions against data/us.json. */
  const US = JSON.parse(read('data/us.json')).results || [];
  const served = companies.map(co => ({ path: co.path, d: headOf(got.get(co.path).body).description || '' }));
  const FILED = /filed with the SEC/;
  for (const f of US) {
    const says = served.filter(s => s.d.startsWith(`${f.name} (${f.id}), listed in the US. `) && FILED.test(s.d) && s.d.includes(`(CIK ${Number(f.cik)})`));
    if (says.length !== 1) p.push(`${f.id} (${f.name}, CIK ${Number(f.cik)}) is filed in data/us.json, and ${says.length} company pages say so${says.length ? `: ${says.map(s => s.path).join(', ')}` : ''}`);
  }
  const filers = served.filter(s => FILED.test(s.d));
  if (filers.length !== US.length) p.push(`${filers.length} company pages say "filed with the SEC", where data/us.json holds ${US.length} filers`);
  for (const s of served) {
    if (FILED.test(s.d)) { if (s.d.includes(router.ILLUS_TITLE) || /illustrative/i.test(s.d)) p.push(`${s.path}: says both filed and illustrative`); continue; }
    if (!s.d.includes(router.ILLUS_TITLE)) p.push(`${s.path}: neither filed with the SEC nor labelled illustrative — "${s.d.slice(0, 90)}…"`);
    const bursa = /^.+ \([A-Z0-9&.-]+, ([0-9A-Z]+)\), listed on Bursa Malaysia\. /.exec(s.d);
    if (!bursa && !/^.+ \([A-Z0-9&.-]+\), listed in the US\. /.test(s.d)) p.push(`${s.path}: does not say where it is listed, with its ticker (and on Bursa its code) — "${s.d.slice(0, 90)}…"`);
    else if (bursa && !s.path.startsWith(`/company/${bursa[1].toLowerCase()}-`)) p.push(`${s.path}: names the listing code ${bursa[1]}, which its address does not lead with`);
  }

  /* The rewrites: one per company, to its own page, before the fallback. */
  /* Not for a search index while the figures are synthetic (the owner,
     2026-10-03): an illustrative company's page says noindex, a filed one's
     does not — and none says it twice. */
  for (const co of companies) {
    const body = got.get(co.path).body;
    const n = (body.match(/<meta name="robots" content="noindex">/g) || []).length;
    const illus = (headOf(body).description || '').includes(router.ILLUS_TITLE);
    if (illus && n !== 1) p.push(`${co.path}: its figures are illustrative and it carries ${n} noindex tag(s), not one`);
    if (!illus && n) p.push(`${co.path}: its figures are filed and it asks not to be indexed`);
  }
  const rw = VERCEL.rewrites || [];
  const fallback = rw.findIndex(x => x.source === '/company/:id');
  const own = new Set(companies.map(co => co.path));
  if (fallback < 0) p.push('vercel.json has no /company/:id rewrite — every other form of a company address would be a 404');
  rw.forEach((x, i) => {
    if (!/^\/company\/[^/:]+$/.test(x.source)) return;
    if (!own.has(x.source)) p.push(`vercel.json rewrites ${x.source} to ${x.destination}, and no company in the universe has that address — a stale page`);
    else if (x.destination !== `/pages${x.source}.html`) p.push(`vercel.json rewrites ${x.source} to ${x.destination}, not its own page`);
    if (fallback > -1 && i > fallback) p.push(`vercel.json lists ${x.source} after /company/:id, which answers it first`);
  });
  for (const path of own) if (rw.filter(x => x.source === path).length !== 1) p.push(`vercel.json has ${rw.filter(x => x.source === path).length} rewrites for ${path}, not one`);

  /* Every other form of a company address, and an unknown company. */
  const OTHER = ['/company/aapl', '/company/CIK0000320193', '/company/aapl-apple', '/company/AAPL-apple-inc', '/company/aapl-apple-inc-extra',
    '/company/1155', '/company/maybank', '/company/1155.KL', '/company/1155-malayan-banking-berhad', '/company/aapl-apple-inc/report', '/company/1155-malayan-banking/report',
    '/app/equities/aapl', '/app/equities/aapl-apple-inc', '/app/equities/1155/financials', '/app/equities/brk-b-berkshire-hathaway/report', '/company/no-such-company-for-served-check'];
  const QUERY = [['/company/aapl-apple-inc?tab=valuation', '/company/aapl-apple-inc'], ['/company/1155-malayan-banking?tab=financials&real=0', '/company/1155-malayan-banking']];
  const more = await getAll([...OTHER, ...QUERY.flat()]);
  for (const path of OTHER) {
    const r = more.get(path);
    if (r.status !== 200) { p.push(`${path}: ${described(r)}, not the generic page with 200`); continue; }
    if (r.body !== read(GENERIC)) p.push(`${path}: not the generic page (${GENERIC}), but one titled "${headOf(r.body).title}"`);
    p.push(...headerProblems(r));
  }
  for (const [a, b] of QUERY) if (more.get(a).status !== 200 || more.get(a).body !== more.get(b).body) p.push(`${a}: ${described(more.get(a))}, not the page ${b} is served`);

  /* /company/AAPL-SEC, a filer's id, is a 308 to its own page since the 9 Oct
     2026 audit (deep-links, below). */
  judge(p, `every company in the universe (${companies.length}: ${filers.length} filed with the SEC, ${companies.length - filers.length} illustrative) is served 200 at its own address with its own title, description, canonical, og: and twitter: tags — each description naming the company, its ticker, where it is listed and, as data/us.json has it, whether its figures are filed with the SEC or illustrative, the illustrative ones (noindex) asking not to be indexed — is index.html in every other byte but the two app files (and a filer's page its committed render), carries the headers and weighs at most ${(largest[1] / 1024).toFixed(1)}kB (${(total / 1048576).toFixed(2)}MB in all); each has one exact rewrite before /company/:id; ${OTHER.length} other forms of a company address, reports and an unknown company are the generic page, and a query string changes nothing`,
    'a company\'s own address is not served its own head, or another form of it is not the generic page');
}
/* ---- end releaseB: D ---- */

/* ---- prerender ---- */
/* 12. EVERY PAGE'S OWN CONTENT AND NAVIGATION IN ITS HTML (2026-10-03).
       Fetched with no script run, every address gave the same body: the
       header, the strapline and the footer's disclosure, with an empty
       <div id="views"> and the header's and footer's lists empty. Held here
       as served:
       - every static route whose page carries a render (prerender/, every
         page but My Workspace's) is served it in #views exactly — the
         committed render, marked data-served with the address it was drawn
         at — with its tab row exactly where it has one and the chrome it was
         drawn in on <html>; and the #views served there holds an h1 whose
         words are the page's own (its render's, and different from every
         other page's but those drawn as the same page);
       - every other page — My Workspace's, the generic page, the 404 page
         and each illustrative company's — is served with #views empty and
         no chrome (each SEC filer's own page carries its overview since
         8 Oct 2026: company-prerender, below);
       - every page's header, sidebar and footer lists are the app's own
         markup (NAV_MARKUP, as build.mjs makes it), marked as the page's
         render marked them: a link for each product with a path and each
         resource, Business Intelligence as text and never a link;
       - no page carries the search box's keys as text: they are written by
         the script that makes them work (95-boot.js), and a fetch with no
         script read them as the body text of every page. */
{
  const { routePlan, prerenderScope, readRenders, navMarkup, NAV_SLOTS } = await import('./build.mjs');
  const plan = routePlan(read('src/index.template.html'));
  const scope = prerenderScope(plan);
  const { renders, missing, edited } = readRenders(scope);
  const nav = navMarkup();
  const p = [];
  missing.forEach(m => p.push(`no render committed for ${m}`));
  edited.forEach(m => p.push(`edited: ${m}`));
  const entity = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const words = (html) => entity(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  /* What a render may hold (2026-10-04): no table cell is a tab stop — the
     screener's, the comparison's and the calculator's first header cells
     kept tabindex="0" from the grid's arrow keys, a stop where no key does
     anything — and what the app marks as the tab's, now (data-now) says
     only what it may say to anyone, not the render's clock or browser. */
  for (const rd of renders.values()) for (const [part, html] of [['#views', rd.views], ['tab row', rd.tabs || '']]) {
    const cells = (html.match(/<t[hdr]\b[^>]*\btabindex=/g) || []).length;
    if (cells) p.push(`${rd.render}: ${cells} table cell${cells === 1 ? '' : 's'} in its ${part} keep${cells === 1 ? 's' : ''} a tab stop`);
    for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-now="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      if (words(m[3]) !== entity(m[2]).trim()) { p.push(`${rd.render}: a data-now element in its ${part} says ${JSON.stringify(words(m[3]).slice(0, 60))}, not what it may say to anyone (${JSON.stringify(entity(m[2]).slice(0, 60))})`); break; }
    }
    /* And none of the words the render's own tab and clock wrote, which it
       served as the reader's: the greeting of its hour, the minute a record
       was "Prepared", a check's result and time "in this tab", a load caught
       half way, the sample data "this browser was given". */
    const text = words(html);
    for (const [what, re] of [['a greeting of the hour', /\bGood (morning|afternoon|evening)\b/], ['a record prepared at the render\'s minute', /\bPrepared \d{4}-\d{2}-\d{2} \d{2}:\d{2}/],
      ['a check timed in the render\'s tab', /<1 ms|\b\d+ ms\b/], ['a check caught half way', /Checking — \d+ of \d+ done|Waiting for the files this check reads|Reading the latest recorded run/],
      ['code said to have run in the reader\'s tab', /run in this tab when the page opened/], ['a load caught half way', /Loading the locality positions|Checking coverage —/],
      ['sample data said to be in the reader\'s browser', /This browser was given sample/]]) {
      const m = re.exec(text);
      if (m) p.push(`${rd.render}: its ${part} serves ${what}: …${text.slice(Math.max(0, m.index - 40), m.index + 60)}…`);
    }
  }
  /* The parts of a served page that are its own. */
  const parts = (html) => {
    const v = /<div id="views"( data-served="([^"]*)")?>([\s\S]*?)<\/div>\n {2}<p class="sr-only" id="liveStatus"/.exec(html);
    const t = /<div class="ptabs-host" id="productTabs"( hidden)?>([\s\S]*?)<\/div>\n {2}<div id="views"/.exec(html);
    const chrome = /^<!DOCTYPE html>\n<html lang="en"(?: data-chrome="([a-z]+)" data-served(?: data-served-reads="[^"]*")?)?>/.exec(html);
    const slots = Object.fromEntries(Object.entries(NAV_SLOTS).map(([k, [open, close]]) => {
      const i = html.indexOf(open), j = i < 0 ? -1 : html.indexOf(close, i + open.length);
      return [k, i < 0 || j < 0 ? null : html.slice(i + open.length, j)];
    }));
    return { views: v ? v[3] : null, served: v ? v[2] ?? null : null, tabs: t ? (t[1] ? null : t[2]) : undefined, chrome: chrome ? chrome[1] ?? null : undefined, slots };
  };
  const fileOf = new Map();
  for (const s of scope) fileOf.set(s.path, s.file);
  /* Every static route, by the file its rewrite names. */
  const got = await getAll(statics);
  const h1s = new Map();
  let carrying = 0, empty = 0;
  for (const path of statics) {
    const r = got.get(path);
    if (r.status !== 200) { p.push(`${path}: ${described(r)}`); continue; }
    const file = renderFileOf(path);
    const rd = renders.get(file);
    const x = parts(r.body);
    if (x.views === null) { p.push(`${path}: no <div id="views"> where the template has it`); continue; }
    if (rd) {
      carrying++;
      if (x.views !== servedViews(rd)) p.push(`${path}: #views is not ${rd.render} exactly${ISLAND_PAGES.includes(rd.file) ? ', with the recorded journeys in it' : ''}`);
      if (x.served !== rd.path) p.push(`${path}: #views is marked data-served=${JSON.stringify(x.served)}, not ${rd.path}`);
      if ((x.tabs ?? null) !== (rd.tabs ?? null)) p.push(`${path}: its tab row is ${x.tabs ? 'not' : 'missing, where it is'} ${rd.tabsFile} exactly`);
      if (x.chrome !== rd.manifest.chrome) p.push(`${path}: <html> says chrome ${JSON.stringify(x.chrome)}, where its render was drawn in the ${rd.manifest.chrome} chrome`);
      const h = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(x.views);
      const said = h ? words(h[1]) : null;
      if (!said) p.push(`${path}: its #views holds no h1`);
      else if (said !== rd.manifest.h1) p.push(`${path}: its h1 reads ${JSON.stringify(said)}, where the page's is ${JSON.stringify(rd.manifest.h1)}`);
      else { if (!h1s.has(said)) h1s.set(said, new Map()); h1s.get(said).set(router.headAt(path).canonical, path); }
      const want = nav(rd.manifest.nav, rd.manifest.chrome);
      for (const k of Object.keys(NAV_SLOTS)) if (x.slots[k] !== want[k]) p.push(`${path}: its ${k} is not NAV_MARKUP's${k === 'pubnav' || k === 'appnav' ? ', marked as its render marked it' : ''}`);
    } else {
      empty++;
      if (x.views !== '' || x.served !== null || x.tabs !== null || x.chrome !== null) p.push(`${path}: carries no render, but its #views, tab row or chrome is not the template's`);
      /* Every static route carries its render since the 9 Oct 2026 audit
         (item #7): My Workspace's were the ones left out. */
      p.push(`${path}: carries no render, where every static route's page does`);
      const want = nav();
      for (const k of Object.keys(NAV_SLOTS)) if (x.slots[k] !== want[k]) p.push(`${path}: its ${k} is not NAV_MARKUP's`);
    }
  }
  /* One page, one h1: two addresses share one only when they are one page
     — the same canonical address (research's aliases, the wheel's). By the
     view it was (2026-10-03), the screener and the value map, two pages of
     the sitemap with their own titles and canonicals, served one h1 and
     passed as "one view". */
  for (const [h, canon] of h1s) if (canon.size > 1) p.push(`the h1 ${JSON.stringify(h)} is served on ${canon.size} pages with different canonical addresses: ${[...canon.values()].join(', ')}`);
  /* The pages that are never a render's: empty, unmarked navigation. */
  /* A filer's own page carries its overview since 8 Oct 2026 (company-
     prerender, below); every other form of a company address, and an
     illustrative company's page, still carries none. */
  const others = await getAll(['/company/aapl', '/company/aapl-apple-inc/report', '/company/1155-malayan-banking', '/nope-for-served-check']);
  for (const [path, r] of others) {
    const x = parts(r.body), want = nav();
    if (x.views !== '' || x.chrome !== null) p.push(`${path}: carries a render or a chrome`);
    for (const k of Object.keys(NAV_SLOTS)) if (x.slots[k] !== want[k]) p.push(`${path}: its ${k} is not NAV_MARKUP's`);
  }
  /* Crawlable: real links, from the tables; Business Intelligence is text. */
  const sample = parts(got.get('/pricing').body).slots;
  const links = (html) => [...(html || '').matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ href: m[1], text: words(m[2]) }));
  /* The sidebar's list is served on an app page; a public page serves it
     empty, and an app page the header's (plan item 3.5, servedChrome). */
  const appSample = parts(got.get('/app').body).slots;
  if (sample.appnav !== '') p.push('/pricing, a public page, serves the sidebar\x27s list, which the app draws when the reader enters the app');
  if (appSample.pubnav !== '') p.push('/app, an app page, serves the public header\x27s list');
  const pub = links(sample.pubnav), foot = links(sample.footProducts), res = links(sample.footResources), side = links(appSample.appnav);
  for (const [where, list, wantText] of [['#pubnav', pub, true], ['#footProducts', foot, true], ['#appnav', side, true]]) {
    for (const [name, href] of [['Equities Research', '/research'], ['Quantum Scanner', '/app/scanner'], ['Property Intelligence', '/property']]) {
      if (!list.some(l => l.href === href && (!wantText || l.text.startsWith(name)))) p.push(`${where} has no link to ${name} (${href})`);
    }
    if (list.some(l => /Business Intelligence/.test(l.text))) p.push(`${where} links Business Intelligence, which is not built`);
  }
  if (!/Business Intelligence/.test(words(sample.pubnav)) || !/Business Intelligence/.test(words(sample.footProducts))) p.push('Business Intelligence is not in the header\'s and the footer\'s Products as text');
  for (const href of ['/how-it-works', '/pricing', '/methodology', '/data-sources', '/learn/glossary', '/status', '/about', '/contact', '/privacy', '/terms'])
    if (!pub.some(l => l.href === href)) p.push(`#pubnav has no link to ${href}`);
  for (const href of ['/methodology', '/data-sources', '/learn/glossary', '/learn', '/corrections', '/status'])
    if (!res.some(l => l.href === href)) p.push(`#footResources has no link to ${href}`);
  /* The renders' own files are not pages for an index (2026-10-04): served
     at /prerender/…, each was a page's content as a document of its own, no
     head, no canonical, no disclosure. */
  {
    const r = await get('/prerender/pricing.html');
    const robots = (await get('/robots.txt')).body;
    if (r.status === 200 && !/noindex/i.test(r.headers.get('x-robots-tag') || '')) p.push(`/prerender/pricing.html: served ${described(r)} with no X-Robots-Tag: noindex`);
    if (!/^Disallow:\s*\/prerender\/\s*$/m.test(robots)) p.push('robots.txt does not disallow /prerender/');
  }
  /* The search's keys are not served. */
  const SEARCH_WORDS = /The down arrow moves into the results|<span class="kbd">Enter<\/span> open/;
  /* As text: index.html's inline script, which writes them, may name them. */
  for (const [path, r] of [...got, ...others]) if (SEARCH_WORDS.test(r.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''))) p.push(`${path}: carries the search box's keys as text`);
  judge(p, `${carrying} static routes are served their page's own render in #views exactly (each with its own h1 — one per canonical address — its tab row and its chrome), My Workspace's among them, and ${empty} none; the renders' own files are noindex and disallowed; every page's header, sidebar and footer lists are NAV_MARKUP's links — every product with a path and every resource a link, Business Intelligence text — marked as the page's render marked them; no page carries the search box's keys`,
    'a page is not served its own content or its navigation');
}
/* ---- end prerender ---- */
/* ---- second-track ---- */
/* 12b. EACH SEC FILER'S OWN PAGE SERVES ITS OVERVIEW (the owner's second
        track, 8 Oct 2026). A fetch of /company/aapl-apple-inc read the
        company's head and an empty #views: no heading, no figure, no source.
        Held here, as served, before any script, for every company in the
        universe — the filed set read from data/us.json itself, not from the
        build:
        - a filer's page serves #views marked data-served with its own
          address, its committed render exactly; its h1 is the company's
          name as filed; its overview's headline figures wear the Filed
          badge (D6) with the fiscal year, and at least one of them is the
          filed revenue or net income of that year as the page prints it;
          the source is named (SEC EDGAR and the CIK); and what needs a
          price says "Unavailable" with "no licensed price";
        - an illustrative company's page serves #views empty, no chrome, and
          asks not to be indexed, as before. */
{
  const p = [];
  const { companies } = companyPlan(ORIGIN, router);
  const US_FILE = JSON.parse(read('data/us.json'));
  const US = new Map((US_FILE.results || []).map(r => [r.id, r]));
  const got = await getAll(companies.map(co => co.path));
  const ent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const words = (html) => ent(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const num = (v) => new Intl.NumberFormat('en-US', { minimumFractionDigits: Math.abs(v) < 10 ? 2 : 1, maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 }).format(v);
  let filed = 0, illus = 0, figures = 0, largest = 0;
  for (const co of companies) {
    const r = got.get(co.path);
    if (r.status !== 200) { p.push(`${co.path}: ${described(r)}`); continue; }
    const body = r.body;
    const v = /<div id="views"( data-served="([^"]*)")?>([\s\S]*?)<\/div>\n {2}<p class="sr-only" id="liveStatus"/.exec(body);
    const tag = /<html\b[^>]*>/.exec(body)?.[0] || '';
    const noindex = (body.match(/<meta name="robots" content="noindex">/g) || []).length;
    if (!v) { p.push(`${co.path}: no <div id="views"> where the template has it`); continue; }
    if (!co.company.real) {
      illus++;
      if (v[3] !== '' || v[1]) p.push(`${co.path}: an illustrative company's page serves something in #views, where it is drawn by the script alone`);
      if (/data-chrome=/.test(tag)) p.push(`${co.path}: an illustrative company's page is served a chrome`);
      if (noindex !== 1) p.push(`${co.path}: an illustrative company's page carries ${noindex} noindex tags, not one`);
      continue;
    }
    filed++;
    largest = Math.max(largest, Buffer.byteLength(body));
    const f = US.get(String(co.id).replace(/-SEC$/, ''));
    if (!f) { p.push(`${co.path}: ${co.id} is not in data/us.json`); continue; }
    const views = v[3];
    if (!views) { p.push(`${co.path}: #views is served empty — no h1, no filed figure, no source before the script runs`); continue; }
    if (v[2] !== co.path) p.push(`${co.path}: #views is marked data-served=${JSON.stringify(v[2] ?? null)}, not its own address`);
    const rd = RENDERED.renders.get(renderFileOf(co.path));
    if (!rd) p.push(`${co.path}: no committed render for its page`);
    else if (views !== servedViews(rd)) p.push(`${co.path}: #views is not ${rd.render} exactly`);
    if (noindex) p.push(`${co.path}: a filed company's page asks not to be indexed`);
    const h = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(views);
    if (!h || words(h[1]) !== f.name) p.push(`${co.path}: its h1 reads ${JSON.stringify(h ? words(h[1]) : null)}, not ${JSON.stringify(f.name)} as filed`);
    const tilesAt = views.indexOf('overview-tiles');
    /* The overview's card: from its tiles to the next card. */
    const tilesEnd = tilesAt < 0 ? -1 : views.indexOf('<div class="card"', tilesAt);
    const tiles = tilesAt < 0 ? '' : views.slice(tilesAt, tilesEnd < 0 ? undefined : tilesEnd);
    const fy = f.years[f.years.length - 1];
    const badges = (tiles.match(/data-kind-badge="filed"/g) || []).length;
    if (badges < 3) p.push(`${co.path}: its overview's headline figures wear ${badges} Filed badges (D6), not one each`);
    if (!new RegExp(`\\bFY${fy}\\b`).test(words(tiles))) p.push(`${co.path}: its overview names no fiscal year FY${fy}`);
    const s = filedSeries(US_FILE, f.id);
    const want = [s.rev[s.rev.length - 1], s.ni[s.ni.length - 1]].filter(x => typeof x === 'number').map(num);
    const shown = [...tiles.matchAll(/class="stat-value[^"]*"[^>]*>([^<]*)</g)].map(m => ent(m[1]).trim());
    if (!want.some(x => shown.includes(x))) p.push(`${co.path}: its overview shows ${JSON.stringify(shown)}, and neither its filed revenue nor its net income for FY${fy} (${want.join(', ')})`);
    else figures++;
    const text = words(views);
    if (!/SEC EDGAR/.test(text) || !text.includes(`CIK ${Number(f.cik)}`)) p.push(`${co.path}: the source — SEC EDGAR and CIK ${Number(f.cik)} — is not named`);
    if (!/data-kind-badge="unavailable"/.test(views) || !/Unavailable · no licensed price/.test(text)) p.push(`${co.path}: what needs a price does not say "Unavailable · no licensed price"`);
  }
  if (!filed) p.push('no company page is a filer\'s');
  judge(p, `the ${filed} SEC filers' own pages serve their overview in #views before any script — each its committed render at its own address, its h1 the company's name as filed, its headline figures badged Filed with FY and ${figures} showing the filed revenue or net income, SEC EDGAR and the CIK named, and "Unavailable · no licensed price" where a price is needed (the largest page ${(largest / 1024).toFixed(0)}kB); the ${illus} illustrative companies' pages serve #views empty, no chrome, noindex`,
    'a filed company\'s page does not serve its overview, or an illustrative one\'s is not as before');
}
/* 12c. THE SCREENER COVERS ONE EVIDENCE CLASS BY DEFAULT (the same track).
        Served, /discover/screener holds the Coverage selector with its two
        classes, the SEC-filed one chosen, and every result row it serves is
        of that one class (its D6 badge), as many rows as its count says. */
{
  const p = [];
  const SCREEN_WORD = { filed: 'SEC-filed', illustrative: 'Illustrative' };
  const r = await get('/discover/screener');
  const v = /<div id="views"[^>]*>([\s\S]*?)<\/div>\n {2}<p class="sr-only" id="liveStatus"/.exec(r.body)?.[1] || '';
  const ent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const at = v.indexOf('class="scr-class"');
  if (at < 0) p.push('/discover/screener: no Coverage selector is served');
  else {
    const bar = v.slice(at, v.indexOf('class="screener-layout', at));
    /* Each choice is served as its words (prerender.mjs: a button made
       inert), the chosen one marked data-on. */
    const choices = [...bar.matchAll(/<span\b(?=[^>]*\bid="scr-class-(filed|illustrative)")([^>]*)>/g)].map(m => ({ on: /\bdata-on\b/.test(m[2]), what: SCREEN_WORD[m[1]] }));
    if (choices.length !== 2) p.push(`/discover/screener: the Coverage selector serves ${choices.length} classes, not SEC-filed and Illustrative`);
    const on = choices.filter(c => c.on).map(c => c.what);
    if (on.length !== 1 || on[0] !== 'SEC-filed') p.push(`/discover/screener: the Coverage selector serves ${JSON.stringify(on)} chosen, not SEC-filed alone`);
  }
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(v)?.[1] || '';
  const rows = body.split('<tr').slice(1);
  const kinds = rows.map(tr => /data-kind-badge="([a-z]+)"/.exec(tr)?.[1] || null);
  const count = /(\d+) of (\d+) compan(?:y|ies) match/.exec(ent(v));
  if (!rows.length) p.push('/discover/screener: no result row is served');
  if (kinds.some(k => k === null)) p.push(`/discover/screener: ${kinds.filter(k => k === null).length} served rows carry no kind badge`);
  const classes = [...new Set(kinds.filter(Boolean))];
  if (classes.length !== 1 || classes[0] !== 'filed') p.push(`/discover/screener: the served rows are of ${JSON.stringify(classes)}, not the filed class alone`);
  if (!count || +count[1] !== rows.length) p.push(`/discover/screener: the served count reads ${count ? count[0] : 'nothing'}, and ${rows.length} rows are served`);
  judge(p, `/discover/screener is served covering one evidence class: the Coverage selector with SEC-filed chosen and Illustrative beside it, and ${rows.length} result rows (${count?.[0]}), each badged Filed`,
    'the served screener mixes the evidence classes, or serves no Coverage selector');
}
/* ---- end second-track ---- */
/* ---- screener-coverage ---- */
/* 12d. NO SERVED TEMPLATE PROMISES A PRICE ON THE FILED COMPANIES (9 Oct
        audit #8). Each template is classed from the source — its
        thresholds (SCREEN_TEMPLATES, src/js/40-views-discover.js) against
        the registry's inputs (METRICS, src/js/13-metrics.js): a threshold on
        a measure whose inputs include the price or price history needs a
        price. Served, /discover/screener covers the SEC-filed class, and
        there: every template is served with its id; none served on filters
        a price-dependent measure; every one that does is served off, with
        "Needs a price; filed companies carry none — available on the
        illustrative set" and the way to run it on the illustrative set; and
        the results' header serves no column that needs a price. */
{
  const p = [];
  const vm = await import('node:vm');
  const cut = (text, name, file) => { const i = text.indexOf(`const ${name} = [`); const e = text.indexOf('\n];', i); if (i < 0 || e < 0) throw new Error(`const ${name} = [ … ]; not found in ${file}`); return text.slice(i, e + 3); };
  const { METRICS, SCREEN_TEMPLATES } = vm.runInContext([
    cut(read('src/js/13-metrics.js'), 'METRICS', 'src/js/13-metrics.js'),
    'const METRIC_BY_K = Object.fromEntries(METRICS.map(x => [x.k, x]));',
    'const ICOV_UNTESTABLE = () => ({});',
    cut(read('src/js/40-views-discover.js'), 'SCREEN_TEMPLATES', 'src/js/40-views-discover.js'),
    '({ METRICS, SCREEN_TEMPLATES })'].join('\n'), vm.createContext({}));
  const dep = (k) => (METRICS.find(x => x.k === k)?.inputs || []).some(x => x === 'price' || x === 'history');
  const priced = (t) => { const s = { universe: 'all', sectors: [], types: [], local: {}, crit: {}, cols: [] }; t.apply(s);
    return Object.entries(s.crit).filter(([k, c]) => c && (c.min != null || c.max != null) && dep(k)).map(([k]) => k); };
  const REASON = 'Needs a price; filed companies carry none — available on the illustrative set';
  const r = await get('/discover/screener');
  const v = /<div id="views"[^>]*>([\s\S]*?)<\/div>\n {2}<p class="sr-only" id="liveStatus"/.exec(r.body)?.[1] || '';
  const text = (h) => decode(h.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  /* Each served template: the opening tag that carries its id, to the next
     template's (or the end of the list). */
  const marks = [...v.matchAll(/<(\w+)\b[^>]*\bdata-template="([^"]+)"[^>]*>/g)];
  const served = marks.map((m, i) => {
    const body = v.slice(m.index, marks[i + 1] ? marks[i + 1].index : v.indexOf('</details>', m.index));
    return { id: m[2], off: /\bdata-off\b/.test(m[0]), why: text(/<p class="scr-tpl-why"[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[1] || ''), run: /Run on the illustrative set/.test(text(body)) };
  });
  const on = [], off = [];
  for (const t of SCREEN_TEMPLATES) {
    const s = served.find(x => x.id === t.id), pr = priced(t);
    if (!s) { p.push(`${t.id}: not served with its id (data-template)`); continue; }
    (s.off ? off : on).push(t.id);
    if (pr.length && !s.off) p.push(`${t.id}: served on for the filed companies, and it filters ${pr.join(', ')}, which need a price`);
    if (pr.length && s.why !== REASON) p.push(`${t.id}: served off with ${JSON.stringify(s.why)}, not "${REASON}"`);
    if (s.off && (!s.why || !s.run)) p.push(`${t.id}: served off without its reason or the way to run it on the illustrative set`);
  }
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(v)?.[1] || '';
  const heads = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m => text(m[1]).replace(/[▲▼↕]/g, '').trim());
  const LABELS = [...METRICS.filter(x => x.screener !== false && dep(x.k)).map(x => x.label), 'Value', 'vs base-case model estimate'];
  const bad = heads.filter(h => LABELS.some(l => h === l || h.startsWith(`${l} (`)));
  if (!heads.length) p.push('/discover/screener: no results header is served');
  if (bad.length) p.push(`/discover/screener: the filed results serve ${bad.join(', ')}, which need a price`);
  judge(p, `/discover/screener serves its ${served.length} templates classed from the source: on for the filed companies ${on.join(', ')}; off, each with its reason and "Run on the illustrative set", ${off.join(', ')}; the results' header (${heads.join(' · ')}) serves no column that needs a price`,
    'a served template promises a price-based result to the filed companies, or a served off one gives no reason');
}
/* ---- end screener-coverage ---- */
/* ---- integration-final ---- */
/* 13. BEFORE THE FIRST PAINT (2026-10-04, the integration's final
       verification). A served page is a fresh visitor's, drawn in Kuala
       Lumpur; until the app's script came down — seconds, after a deploy —
       a returning reader was shown it over their own work, a reader in New
       York its ringgit, a reader who chose the dark theme its light one.
       Every page now carries one script in its head (build.mjs, FIRST_SCRIPT)
       that applies the theme kept and, where the render read what this
       reader holds otherwise, keeps the served page out of sight until the
       app draws theirs. Held here as served:
       - every address that serves a page — each static route, company pages,
         the parameter routes' page and the 404 page — carries it once, in its
         head before anything it loads, the same bytes as build.mjs's, and its
         Content-Security-Policy names its hash;
       - every page with a render says on <html> exactly what its render read
         (servedReadsOf), every other page says nothing, and what is said
         names nothing the address carries. */
{
  const p = [];
  const { renders } = readRenders(prerenderScope(routePlan(read('src/index.template.html'))));
  const hash = ` '${firstHash()}' `;
  const generic = params[0].replace(/:[A-Za-z]+/g, 'frames-check');
  const paths = [...statics, '/company/aapl-apple-inc', '/company/1155-malayan-banking', generic, '/nope-for-served-check'];
  const got = await getAll(paths);
  let said = 0;
  for (const path of paths) {
    const r = got.get(path);
    if (!r.status) { p.push(`${path}: ${described(r)}`); continue; }
    const body = r.body, at = body.indexOf(FIRST_TAG), head = body.indexOf('</head>');
    const loads = Math.min(...['<style>', '<link rel="stylesheet"'].map(t => body.indexOf(t)).filter(i => i >= 0));
    if (body.split(FIRST_TAG).length !== 2) p.push(`${path}: carries the first-paint script ${body.split(FIRST_TAG).length - 1} times, not once`);
    else if (at > head || at > loads) p.push(`${path}: its first-paint script is not in its head before what it loads`);
    if (inlineScripts(body).filter(code => code === FIRST_SCRIPT).length !== 1) p.push(`${path}: no inline script is the first-paint script byte for byte`);
    const csp = ` ${((r.headers.get('content-security-policy') || '').match(/(?:^|;)\s*script-src\s([^;]*)/) || [])[1] || ''} `;
    if (!csp.includes(hash)) p.push(`${path}: its Content-Security-Policy does not name the first-paint script's hash`);
    const tag = /<html\b[^>]*>/.exec(body)?.[0] || '';
    const reads = /\bdata-served-reads="([^"]*)"/.exec(tag)?.[1] ?? null;
    const rd = renders.get(renderFileOf(path));
    const want = rd ? servedReadsOf(rd.views, { waits: rd.manifest.state === 'filings in', drawn: rd.drawn, render: rd.render }) : null;
    if (reads !== want) p.push(`${path}: <html> says it read ${JSON.stringify(reads)}, where its render read ${JSON.stringify(want)}`);
    if (reads) {
      said++;
      const names = reads.split(' ').map(x => x.slice(0, x.indexOf(':')));
      const address = names.filter(n => n.startsWith('?') || n === 'discoverTab');
      if (address.length) p.push(`${path}: <html> names what the address carries (${address.join(', ')})`);
    }
  }
  judge(p, `${paths.length} addresses (every static route, company pages, the parameter routes' page and the 404) carry the first-paint script once in their head before what they load, the same bytes as build.mjs's, its hash in their Content-Security-Policy; the ${said} pages whose render read what a browser keeps say on <html> exactly what it read, and no other page says anything`,
    'a page does not carry the first-paint script, or says other than what its render read');
}
/* ---- end integration-final ---- */

/* ---- disclosure-guard ---- */
/* THE DISCLOSURE STAYS AS IT IS (plan item 1.5; audits B #9–#10 and C, "keep
   the bottom disclosure"). Two sentences say on every page what this is and
   is not: the strip's "Beta preview." with "Do not use figures here for
   investment decisions.", and the footer's p.footer-legal. Both were right
   on 4 Oct 2026 and nothing held them there: a template edit, a build or a
   render could shorten either, and every other check would still pass.
   Held here on what is served, before any script runs, at every address
   that serves a page — every static route, every company's own page, the
   parameter routes' page and the 404 — word for word against the text
   below, typed here rather than read from the template, so an edit to the
   template is what fails. The footer is compared as text (tags out, white
   space as one space); the strip's two sentences must stand together, the
   first in <strong>, inside #disclosureText. The script may swap the
   strip's first words for a fuller "Beta preview — …" once the filings
   load (95-boot.js); that keeps the sentence and is not what a fetch reads. */
{
  const STRIP = '<strong>Beta preview.</strong> Do not use figures here for investment decisions.';
  const LEGAL = 'Quantum Tradeworks is a research and analysis prototype. It does not provide investment advice, personal recommendations, or a suitability assessment, and it does not execute trades or connect to brokerage accounts. Nothing here is an offer or inducement to buy or sell any security. Financial figures come from two different places and are labelled on every page: statements filed with the US SEC, which are audited and real, and illustrative figures for the Malaysian companies and any other company marked illustrative, which are synthetic and created for interface demonstration. No market-data licence is in place for either exchange. A filed company therefore carries no price at all, and every measure that needs one — market capitalisation, multiples, yield, difference to model estimate — reads as unavailable rather than estimated. Where a price, market capitalisation or yield does appear, it belongs to an illustrative company and is part of that synthetic dataset; it is not a quote and it is not observed from any market. Nothing here may be used for an investment decision. A production deployment would require licensed market data for both markets and, in Malaysia, written legal classification of each surface under the Capital Markets and Services Act before launch.';
  const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const p = [];
  const { companies } = companyPlan(ORIGIN, router);
  const generic = params[0].replace(/:[A-Za-z]+/g, 'disclosure-check');
  const paths = [...statics, ...companies.map(co => co.path), generic, '/nope-for-disclosure-check', '/404.html'];
  const got = await getAll(paths);
  for (const path of paths) {
    const r = got.get(path);
    if (!r.status || !/text\/html/.test(r.type || '')) { p.push(`${path}: ${described(r)}`); continue; }
    /* Since plan item 3.1 the strip is a <details>: the sentence is in its
       summary, the facts beside it (served-3a, below, holds the rest). */
    const strip = /<summary class="disclosure-in">[\s\S]*?<span id="disclosureText">([\s\S]*?)<\/span> <span id="disclosureFacts">/.exec(r.body)?.[1];
    if (strip == null) p.push(`${path}: serves no #disclosureText`);
    else if (strip.replace(/\s+/g, ' ').trim() !== STRIP) p.push(`${path}: the strip reads "${text(strip).slice(0, 120)}", not "Beta preview. Do not use figures here for investment decisions."`);
    const legal = [...r.body.matchAll(/<p class="footer-legal">([\s\S]*?)<\/p>/g)].map(m => text(m[1]));
    if (legal.length !== 1) p.push(`${path}: serves ${legal.length} p.footer-legal, not one`);
    else if (legal[0] !== LEGAL) {
      const at = [...LEGAL].findIndex((c, i) => legal[0][i] !== c);
      p.push(`${path}: p.footer-legal is not its text of 4 Oct 2026 — from character ${at}: "${legal[0].slice(Math.max(0, at - 20), at + 60)}"`);
    }
  }
  judge(p, `${paths.length} addresses (every static route, every company's own page, the parameter routes' page and the 404) serve "Beta preview." with "Do not use figures here for investment decisions." and the footer's p.footer-legal word for word as on 4 Oct 2026`,
    'a served page shortens or drops the disclosure strip or the footer\'s legal text');
}
/* ---- end disclosure-guard ---- */

/* ---- status-served ---- */
/* A CHECK THAT RAN NOWHERE IS SERVED AS NO RESULT (N1a, the 5 Oct audit).
   /status's in-browser checks are run by the page's script in the reader's
   tab; served, each chip says "Not run". Two of them were served green
   (chip-ok) in rows marked data-status="PASS" — the render's own run's
   result, read by every fetch as a pass. On the served page no health row
   may carry PASS, FAIL or DEGRADED, and no chip that says "Not run" a
   result's colour. */
{
  const p = [];
  const r = (await getAll(['/status'])).get('/status');
  /* The in-browser rows are class="health-row"; the recorded journeys'
     (journey-row, #health-journeys) are a recorded result, served as
     recorded, and their chips never say "Not run" — THE JOURNEYS' RESULT,
     SERVED, below. */
  const rows = [...(r.body || '').matchAll(/<li\b[^>]*\bclass="health-row"[^>]*>/g)].map(m => m[0]);
  const chips = [...(r.body || '').matchAll(/<span\b[^>]*\bclass="([^"]*\bhealth-chip\b[^"]*)"[^>]*>([^<]*)<\/span>/g)].map(m => ({ cls: m[1], says: m[2].trim() }));
  if (r.status !== 200) p.push(`/status: ${described(r)}`);
  if (!rows.length || !chips.length) p.push(`/status serves ${rows.length} health rows and ${chips.length} result chips — the check has nothing to read`);
  rows.forEach((row, i) => { const st = /\bdata-status="([^"]*)"/.exec(row)?.[1]; if (/^(PASS|FAIL|DEGRADED)$/.test(st || '')) p.push(`/status: health row ${i + 1} is served data-status="${st}"`); });
  chips.forEach((c, i) => { if (c.says === 'Not run' && /\bchip-(ok|warn|critical|dn|up)\b/.test(c.cls)) p.push(`/status: chip ${i + 1} says "Not run" and is served as ${c.cls.trim()}`); });
  judge(p, `/status serves its ${rows.length} in-browser check rows with no PASS, FAIL or DEGRADED status, and none of its ${chips.length} "Not run" chips in a result's colour`,
    '/status serves a check that ran nowhere as a result');
}
/* ---- end status-served ---- */

/* ---- journeys-served ---- */
/* THE JOURNEYS' RESULT, SERVED (N1c–N1e, the 5 Oct audit; D16). A fetch of
   /status that ran no script read "Read from the site by this page's
   script." and an empty list: no result, no time, no commit, no run. The
   build now writes the committed record into the page (journeysServed,
   journeys.mjs), and into one line on each product landing page. Held here,
   before any script, against the record this same site serves:
   1. /status's summary states the run's UTC time and a 7-character commit,
      and its list has one li per journey with every step named and marked
      OK, FAIL or gated — both exactly journeysServed(/health/journeys.json),
      and neither the placeholder; "Complete journeys on the live site"
      comes before "Checked in your browser now";
   4. the summary links the record's own Actions run (the workflow's run
      history only for a record that names none);
   6. /property, /research and /app/scanner each serve their journey's line,
      equal to the record, with a title saying what a journey proves, and
      the Scanner's says its evaluate step is gated when the record does.
   Against the live site (BASE is the template's origin, or --live), also:
   the record names its run (4); the run is under 24 hours old (2); the
   latest Production deployment GitHub lists is the recorded commit, or
   differs from it only in the record and the island pages (3); Property
   passes and the Scanner's evaluate step is gated (6). Item 5 is
   status-served, above; item 7 is journeys.mjs --self-test. */
{
  const p = [];
  const LIVE = BASE === ORIGIN || argv.includes('--live');
  const REPO = 'georgewong1014-pixel/quantum-tradeworks';
  const words = (html) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const rec = await fetch(`${BASE}/health/journeys.json?fetch=${Date.now()}`, { signal: AbortSignal.timeout(30000) }).then(r => r.json()).catch(e => ({ unreadable: e.message }));
  const bad = resultProblem(rec);
  if (bad) p.push(`/health/journeys.json is not a result (${bad}) — nothing to hold the pages to`);
  const want = journeysServed(rec);
  if (!want.recorded) p.push('/health/journeys.json records no run, so no page can serve one');
  const got = await getAll(['/status', '/property', '/research', '/app/scanner']);
  const status = got.get('/status').body || '';
  const sum = /<p class="metaline" id="health-journeys-sum"[^>]*>([\s\S]*?)<\/p>/.exec(status)?.[1];
  const list = /<ul id="health-journeys"[^>]*>([\s\S]*?)<\/ul>/.exec(status)?.[1];
  if (sum == null) p.push('/status serves no #health-journeys-sum');
  else {
    if (/Read from the site by this page/.test(words(sum))) p.push(`/status serves the placeholder in #health-journeys-sum: "${words(sum)}"`);
    if (!/^Last recorded run \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC on [0-9a-f]{7}: \d+ of \d+ pass\b/.test(words(sum))) p.push(`/status's summary states no UTC run time and 7-character commit: "${words(sum).slice(0, 120)}"`);
    if (want.recorded && sum !== want.sum) p.push(`/status's summary is not the record's: served "${words(sum).slice(0, 110)}", the record "${words(want.sum).slice(0, 110)}"`);
    const link = /<a class="journeys-log" href="([^"]*)">/.exec(sum)?.[1] || null;
    if (rec.run && link !== rec.run) p.push(`/status links ${link || 'no run'}, not the recorded run ${rec.run}`);
    if (LIVE && !(link && RUN_URL.test(link))) p.push(`/status links ${link || 'nothing'}, not an Actions run (…/actions/runs/<id>) — the record names no run`);
  }
  if (list == null) p.push('/status serves no #health-journeys');
  else if (want.recorded) {
    if (list !== want.list) p.push('/status\'s #health-journeys is not the record\'s list');
    const rows = [...list.matchAll(/<li class="journey-row" id="journey-[a-z0-9-]+" data-status="(PASS|DEGRADED|FAIL)">([\s\S]*?)<\/div><\/li>/g)];
    if (rows.length !== (rec.journeys || []).length) p.push(`/status serves ${rows.length} journey rows for the record's ${(rec.journeys || []).length} journeys`);
    rows.forEach((m, i) => {
      const j = rec.journeys[i] || {};
      const steps = [...m[2].matchAll(/<li data-mark="(ok|fail|gated)"><span class="journey-mark">(OK|FAIL|gated)<\/span> ([^<]*)/g)];
      const recSteps = Array.isArray(j.steps) ? j.steps : [];
      if (steps.length !== recSteps.length) p.push(`/status: ${j.id} serves ${steps.length} steps marked OK, FAIL or gated, of the record's ${recSteps.length}`);
      steps.forEach((s, k) => { if (recSteps[k] && words(s[3]) !== recSteps[k].name) p.push(`/status: ${j.id}'s step ${k + 1} reads "${words(s[3])}", the record's "${recSteps[k].name}"`); });
    });
  }
  const jAt = status.indexOf('>Complete journeys on the live site</h3>'), bAt = status.indexOf('>Checked in your browser now</h3>');
  if (jAt < 0 || bAt < 0 || jAt > bAt) p.push('/status: "Complete journeys on the live site" is not served above "Checked in your browser now"');
  for (const path of ['/property', '/research', '/app/scanner']) {
    const body = got.get(path).body || '';
    const m = new RegExp(`<p class="journey-line"[^>]*\\bdata-journey="${path.replace(/\//g, '\\/')}"[^>]*>([\\s\\S]*?)<\\/p>`).exec(body);
    if (!m) { p.push(`${path} serves no journey line`); continue; }
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    if (!/title="[^"]*proves[^"]*not show that any figure[^"]*accurate/.test(tag)) p.push(`${path}: the journey line's title does not say that a journey proves the path works, not that a figure is accurate`);
    if (want.recorded && m[1] !== want.lines[path]) p.push(`${path}: the journey line is not the record's: served "${words(m[1]).slice(0, 100)}", the record "${words(want.lines[path] || '').slice(0, 100)}"`);
    if (want.recorded && !/^Journey: .+ · (PASS|DEGRADED|FAIL)\b.* · \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} UTC · [0-9a-f]{7} · details$/.test(words(m[1]))) p.push(`${path}: the journey line does not read "Journey: <name> · <status> · <time UTC> · <sha> · details": "${words(m[1]).slice(0, 120)}"`);
    if (!new RegExp(`href="/status#journey-[a-z0-9-]+"`).test(m[1]) && want.recorded) p.push(`${path}: the journey line links no journey on /status`);
    if (/class="ptabs/.test(m[0])) p.push(`${path}: the journey line is in the tab row`);
  }
  const scan = (rec.journeys || []).find(j => j.id === 'scanner');
  const gated = (scan?.steps || []).some(s => s.gated && /^Evaluate/.test(s.name));
  const scanLine = words(/<p class="journey-line"[^>]*data-journey="\/app\/scanner"[^>]*>([\s\S]*?)<\/p>/.exec(got.get('/app/scanner').body || '')?.[1] || '');
  if (gated && !/ · evaluate: gated \(no prices ship\) · /.test(scanLine)) p.push(`/app/scanner: the record gates the evaluate step and the line does not say so: "${scanLine.slice(0, 120)}"`);
  if (LIVE) {
    const age = Date.now() - Date.parse(rec.ranAt);
    if (!(age < 24 * 3600000)) p.push(`the recorded run of ${rec.ranAt} is ${Math.round(age / 3600000)} hours old — over 24`);
    if (!gated) p.push('the record does not gate the Scanner\'s evaluate step on the live site, where no prices ship');
    const prop = (rec.journeys || []).find(j => j.id === 'property');
    if (prop?.status !== 'PASS') p.push(`the property journey is ${prop?.status || 'not recorded'}, not PASS`);
    const gh = (u) => fetch(`https://api.github.com/repos/${REPO}/${u}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'served-check' }, signal: AbortSignal.timeout(30000) }).then(r => r.json());
    try {
      const dep = (await gh('deployments?environment=Production&per_page=1'))?.[0]?.sha;
      if (!dep) p.push('GitHub lists no Production deployment');
      else if (dep !== rec.commit) {
        const files = ((await gh(`compare/${rec.commit}...${dep}`))?.files || []).map(f => f.filename);
        const other = files.filter(f => f !== 'health/journeys.json' && !ISLAND_PAGES.includes(f));
        if (!files.length || other.length) p.push(`the latest Production deployment ${dep.slice(0, 7)} is not the recorded commit ${String(rec.commit).slice(0, 7)}, and differs from it in ${other.length ? other.slice(0, 5).join(', ') : 'nothing GitHub lists'}`);
      }
    } catch (e) { p.push(`GitHub's deployments and compare APIs could not be read (${e.message})`); }
  }
  judge(p, `the recorded journeys are served before any script runs: /status's summary (${want.recorded ? words(want.sum).slice(0, 72) + '…' : 'none'}) and ${(rec.journeys || []).length} journey rows with every step OK, FAIL or gated, exactly the record this site serves, above the in-browser checks; and the journey line on /property, /research and /app/scanner, equal to it${gated ? ', the Scanner\'s evaluate step gated' : ''}${LIVE ? '; the live record names its run, is under 24 hours old and is the latest Production deployment\'s commit or differs from it only in the record and the island pages' : ''}`,
    'the recorded journeys are not served as recorded');
}
/* ---- end journeys-served ---- */

/* ---- live-proof ---- */
/* EACH LIVE BADGE BESIDE ITS JOURNEY'S LAST RESULT, SERVED (D15, the
   owner's decision of 6 Oct 2026; plan item 2.6). An outcome step in a
   production journey proves a Live badge; a landing does not. Held here,
   before any script, on /status against the registry (every 'live' row of
   PRODUCTS and TOOLS in src/js/35-ui.js, and its proof) and the record this
   same site serves:
   1. every Live badge whose row names its journey and outcome step is
      listed in #health-proofs, in the registry's order, as Live, with its
      name, the journey's name (journeys.mjs, JOURNEY_NAMES) and the step,
      and its last result exactly journeysServed(record).proof(journey,
      step);
   2. every Live badge whose row says it is not yet proven (proof: null) is
      listed in #health-unproven, as Live, and nothing else is;
   3. the two headings count them out of every Live badge. */
{
  const p = [];
  const J = await import('./journeys.mjs');
  const vm = await import('node:vm');
  const words = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const cutArray = (text, name) => { const i = text.indexOf(`const ${name} = [`); const e = text.indexOf('\n];', i); if (i < 0 || e < 0) throw new Error(`const ${name} = [ … ]; not found in src/js/35-ui.js`); return text.slice(i, e + 3); };
  const UI = read('src/js/35-ui.js');
  const { PRODUCTS, TOOLS } = vm.runInContext([cutArray(UI, 'PRODUCTS'), cutArray(UI, 'TOOLS'), '({ PRODUCTS, TOOLS })'].join('\n'), vm.createContext({}));
  const rows = [
    ...PRODUCTS.filter(x => x.status === 'live').map(x => ({ key: `product:${x.id}`, name: x.name, of: 'Product', proof: x.proof })),
    ...TOOLS.filter(x => x.status === 'live').map(x => ({ key: `tool:${x.id}`, name: x.label, of: x.product ? PRODUCTS.find(q => q.id === x.product)?.name || x.product : 'My workspace', proof: x.proof })),
  ];
  const proven = rows.filter(r => r.proof), unproven = rows.filter(r => !r.proof);
  const rec = await fetch(`${BASE}/health/journeys.json?fetch=${Date.now()}`, { signal: AbortSignal.timeout(30000) }).then(r => r.json()).catch(e => ({ unreadable: e.message }));
  const want = journeysServed(rec);
  if (typeof want.proof !== 'function') p.push('journeysServed (journeys.mjs) draws no Live badge\'s result (proof)');
  if (!J.JOURNEY_NAMES) p.push('journeys.mjs names no journeys (JOURNEY_NAMES)');
  const status = (await getAll(['/status'])).get('/status').body || '';
  const listOf = (id) => new RegExp(`<ul id="${id}"[^>]*>([\\s\\S]*?)</ul>`).exec(status)?.[1];
  const items = (html) => [...(html || '').matchAll(/<li class="proof-row" data-proof-row="([^"]+)">([\s\S]*?)<\/li>/g)].map(m => ({ key: m[1], html: m[2] }));
  const BADGE = /^<span class="status-badge status-live">Live<\/span><p class="proof-name">/;
  const head = (re) => (status.match(re) || [])[1] || null;
  const proofs = listOf('health-proofs'), rest = listOf('health-unproven');
  if (proofs == null) p.push('/status serves no list of the Live badges and the journeys that prove them (#health-proofs)');
  else {
    const got = items(proofs);
    if (got.map(x => x.key).join() !== proven.map(r => r.key).join()) p.push(`/status lists ${got.map(x => x.key).join(', ') || 'no badge'} as proven, where the registry's proven Live rows are ${proven.map(r => r.key).join(', ')}`);
    for (const r of proven) {
      const li = got.find(x => x.key === r.key);
      if (!li) continue;
      const w = words(li.html);
      if (!BADGE.test(li.html)) p.push(`/status: ${r.key} is not served as Live`);
      if (!w.includes(`${r.name} · ${r.of}`)) p.push(`/status: ${r.key} does not read "${r.name} · ${r.of}": "${w.slice(0, 90)}"`);
      const jn = J.JOURNEY_NAMES?.[r.proof.journey];
      if (!jn || !w.includes(`Journey “${jn}”, outcome step “${r.proof.step}”.`)) p.push(`/status: ${r.key} does not name its journey "${jn || r.proof.journey}" and outcome step "${r.proof.step}"`);
      const slot = /<span class="proof-result" data-proof-journey="([^"]*)" data-proof-step="([^"]*)" data-now="">([\s\S]*?)<\/span><\/p>/.exec(li.html);
      if (!slot) { p.push(`/status: ${r.key} serves no last result`); continue; }
      if (slot[1] !== r.proof.journey || words(slot[2]) !== r.proof.step) p.push(`/status: ${r.key}'s result is for ${slot[1]} "${words(slot[2])}", not ${r.proof.journey} "${r.proof.step}"`);
      if (typeof want.proof === 'function' && slot[3] !== want.proof(r.proof.journey, r.proof.step)) p.push(`/status: ${r.key}'s last result is not the record's: served "${words(slot[3]).slice(0, 90)}", the record "${words(want.proof(r.proof.journey, r.proof.step)).slice(0, 90)}"`);
    }
  }
  if (rest == null) p.push('/status serves no list of the Live tools not yet proven by a journey (#health-unproven)');
  else {
    const got = items(rest);
    if (got.map(x => x.key).join() !== unproven.map(r => r.key).join()) p.push(`/status lists ${got.map(x => x.key).join(', ') || 'nothing'} as not yet proven, where the registry's are ${unproven.map(r => r.key).join(', ') || 'none'}`);
    for (const r of unproven) {
      const li = got.find(x => x.key === r.key);
      if (li && (!BADGE.test(li.html) || words(li.html) !== `Live ${r.name} · ${r.of}`)) p.push(`/status: ${r.key} is not served as "Live ${r.name} · ${r.of}": "${words(li.html).slice(0, 90)}"`);
    }
  }
  const hp = head(/>(Proven by an outcome step — \d+ of \d+)<\/h4>/), hu = head(/>(Live, and not yet proven by a journey — \d+ of \d+)<\/h4>/);
  /* Under the recorded journeys it reads, above the checks run in the
     reader's tab (which fill in after the page is drawn). */
  const at = (s) => status.indexOf(s);
  if (!(at('id="health-journeys"') < at('id="health-proofs"') && at('id="health-unproven"') < at('>Checked in your browser now</h3>'))) p.push('/status does not serve the Live badges between the recorded journeys and "Checked in your browser now"');
  if (hp !== `Proven by an outcome step — ${proven.length} of ${rows.length}`) p.push(`/status heads the proven badges "${hp || 'nothing'}", not "Proven by an outcome step — ${proven.length} of ${rows.length}"`);
  if (hu !== `Live, and not yet proven by a journey — ${unproven.length} of ${rows.length}`) p.push(`/status heads the unproven badges "${hu || 'nothing'}", not "Live, and not yet proven by a journey — ${unproven.length} of ${rows.length}"`);
  judge(p, `/status serves every Live badge beside what proves it (D15): ${proven.length} of ${rows.length} beside their journey's outcome step and its last recorded result, exactly the record's (${proven.map(r => r.name).join(', ')}); ${unproven.length} listed as not yet proven by a journey (${unproven.map(r => r.name).join(', ')})`,
    '/status does not serve each Live badge beside what proves it');
}
/* ---- end live-proof ---- */

/* ---- robots-noindex ---- */
/* FETCHABLE, AND OUT OF SEARCH (plan item 1.1; the owner's decision D2 of
   5 Oct 2026). robots.txt said Disallow: /app$ and Disallow: /app/scanner,
   so a fetcher that follows it — an assistant, an auditor's tool — could not
   read the Scanner's dashboard or the setup builder at all, though each
   serves a fresh visitor's page, and a search engine that may not fetch a
   page never reads a noindex on it. Held here as served, not as vercel.json
   says (the headers checks above hold that):
   - the served robots.txt, read as RFC 9309 reads it (robotsAllows,
     build.mjs) for "*" and for two named crawlers that have no group of
     their own, allows /app, /app/scanner, the setup builder and an alert,
     and has no Disallow line for /app or /app/scanner; /admin/, /prerender/
     and /my/ stay disallowed;
   - every response at /app and at /app/scanner and under it — a GET with a
     query string, a HEAD as `curl -sI` sends, a parameter route's address —
     carries X-Robots-Tag: noindex; a product page under /app
     (/app/equities), a page in the sitemap and the site root do not;
   - /app/scanner, fetched, is the Scanner's dashboard: its h1 reads
     "Scanner dashboard". */
{
  const { robotsAllows } = await import('./build.mjs');
  const p = [];
  const robots = (await getAll(['/robots.txt'])).get('/robots.txt');
  if (robots.status !== 200) p.push(`/robots.txt: ${described(robots)}`);
  const FETCHABLE = ['/app', '/app/scanner', '/app/scanner/setups/new', '/app/scanner/setups', '/app/scanner/alerts/a00000000'];
  const KEPT_OUT = ['/admin/scanner', '/prerender/pricing.html', '/my/workspace'];
  for (const agent of ['*', 'ClaudeBot', 'Googlebot']) {
    for (const path of FETCHABLE) { const r = robotsAllows(robots.body, path, agent); if (!r.allowed) p.push(`robots.txt disallows ${path} to ${agent} (${r.rule}), read as RFC 9309 reads it`); }
    for (const path of KEPT_OUT) { const r = robotsAllows(robots.body, path, agent); if (r.allowed) p.push(`robots.txt allows ${path} to ${agent}, which stays disallowed`); }
  }
  const lines = [...robots.body.matchAll(/^\s*Disallow\s*:\s*(\S*)/gmi)].map(m => m[1]);
  for (const d of lines) if (/^\/app(\$|\/scanner)?(\/.*|\$)?$/.test(d) && !/^\/app\/(watchlists|workspace)/.test(d)) p.push(`robots.txt still says Disallow: ${d}`);
  const NOINDEX = ['/app', '/app?tab=served-check', '/app/scanner', '/app/scanner/setups/new', '/app/scanner/setups/served-check/edit', '/app/scanner/alerts/a00000000', '/app/scanner/settings'];
  const INDEXABLE = ['/', '/app/equities', '/pricing', '/research', '/status'];
  const got = await getAll([...NOINDEX, ...INDEXABLE]);
  for (const path of NOINDEX) {
    const r = got.get(path), tag = r.headers.get('x-robots-tag');
    if (r.status !== 200) p.push(`${path}: ${described(r)}`);
    if (!/^\s*noindex\s*$/i.test(tag || '')) p.push(`${path}: X-Robots-Tag is ${tag === null ? 'absent' : JSON.stringify(tag)}, not noindex`);
  }
  for (const path of ['/app/scanner', '/app/scanner/setups/new']) {
    const h = await fetch(BASE + path, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(30000) }).catch(e => ({ status: 0, error: e.message, headers: new Headers() }));
    if (h.status !== 200 || !/^\s*noindex\s*$/i.test(h.headers.get('x-robots-tag') || '')) p.push(`HEAD ${path}: ${h.status || h.error}, X-Robots-Tag ${JSON.stringify(h.headers.get('x-robots-tag'))}, not 200 with noindex`);
  }
  for (const path of INDEXABLE) {
    const tag = got.get(path).headers.get('x-robots-tag');
    if (tag !== null) p.push(`${path}: served X-Robots-Tag ${JSON.stringify(tag)} — a page for an index`);
  }
  const words = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(got.get('/app/scanner').body || '');
  if (!h1 || words(h1[1]) !== 'Scanner dashboard') p.push(`/app/scanner: its served h1 reads ${JSON.stringify(h1 ? words(h1[1]) : null)}, not "Scanner dashboard"`);
  judge(p, `robots.txt, read as RFC 9309 reads it, lets a fetcher read /app, /app/scanner and the setup builder (/app/scanner/setups/new) and still disallows /admin/, /prerender/ and /my/; ${NOINDEX.length} addresses at /app and /app/scanner (a query, a parameter route, a HEAD too) are served X-Robots-Tag: noindex and ${INDEXABLE.length} pages for an index are not; /app/scanner serves its h1 "Scanner dashboard"`,
    '/app or /app/scanner cannot be fetched by a crawler that follows robots.txt, or is not served noindex');
}
/* ---- end robots-noindex ---- */

/* ---- home-served ---- */
/* THE SITE ROOT, SERVED LIKE EVERY OTHER PAGE (plan item 1.2; the owner's
   decision D2 of 5 Oct 2026). / was index.html: 3.8MB with the app inline,
   its h1 at byte 309,867, so a fetcher that keeps the first 32–256kB read the
   head and nothing of the page. Held here as a fetcher reads it, by bytes:
   - / answers 200 with fewer than 204,800 bytes, by the body and by the
     Content-Length a HEAD with no compression is given (`curl -sI`);
   - its first 32kB hold `<script src="/assets/app.` and `<div id="views"`;
   - its first 64kB, as text, hold its h1 (the render's, from the manifest);
   - /index.html is a 308 to /, and followed it lands on that page. */
{
  const p = [];
  const LIMIT = 204800;
  const r = await fetch(`${BASE}/`, { headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(90000) }).catch(e => ({ status: 0, error: e.message }));
  const bytes = r.status ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
  if (r.status !== 200) p.push(`/: ${r.status || r.error}, not 200`);
  if (bytes.length >= LIMIT) p.push(`/: ${bytes.length.toLocaleString('en')} bytes, not under ${LIMIT.toLocaleString('en')}`);
  const head = await fetch(`${BASE}/`, { method: 'HEAD', headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(30000) }).catch(e => ({ status: 0, error: e.message, headers: new Headers() }));
  const length = head.headers.get('content-length');
  if (length !== null && !(Number(length) < LIMIT)) p.push(`HEAD /: Content-Length ${length}, not under ${LIMIT.toLocaleString('en')}`);
  const first = bytes.subarray(0, HOME_HEAD_BYTES).toString('utf8');
  for (const tag of ['<script src="/assets/app.', '<div id="views"']) {
    const at = bytes.indexOf(tag);
    if (!first.includes(tag)) p.push(`/: ${tag} is ${at < 0 ? 'not in the page' : `at byte ${at.toLocaleString('en')}`}, not within the first ${HOME_HEAD_BYTES / 1024}kB`);
  }
  const h1 = RENDERED.renders.get('index.html')?.manifest.h1;
  if (!h1) p.push('no render of / is committed, so there is no h1 to look for');
  else if (!pageText(bytes.subarray(0, HOME_TEXT_BYTES).toString('utf8')).includes(h1)) p.push(`/: its first ${HOME_TEXT_BYTES / 1024}kB, as text, do not hold its h1 "${h1}" (the h1 is at byte ${bytes.indexOf('<h1').toLocaleString('en')})`);
  const idx = await fetch(`${BASE}/index.html`, { signal: AbortSignal.timeout(90000) }).catch(e => ({ status: 0, error: e.message, url: '' }));
  const landed = idx.status ? await idx.text() : '';
  if (idx.status !== 200 || new URL(idx.url || BASE).pathname !== '/' || landed.split('\r\n').join('\n') !== HOME_PAGE) p.push(`/index.html, followed: ${idx.status || idx.error} at ${idx.url ? new URL(idx.url).pathname : '?'}, not the home page at /`);
  judge(p, `/ is ${bytes.length.toLocaleString('en')} bytes (under ${LIMIT.toLocaleString('en')}${length !== null ? `; Content-Length ${length}` : ''}), with <script src="/assets/app. at byte ${bytes.indexOf('<script src="/assets/app.').toLocaleString('en')} and <div id="views" at ${bytes.indexOf('<div id="views"').toLocaleString('en')} (within ${HOME_HEAD_BYTES / 1024}kB) and its h1 "${h1}" within the first ${HOME_TEXT_BYTES / 1024}kB as text; /index.html lands on it`,
    '/ is not a light page that says what it is early');
}
/* ---- end home-served ---- */

/* ---- readiness-served ---- */
/* WHAT PROPERTY SAYS IT IS, SERVED (the 5 Oct audit, N2b, N2c and N4a).
   - /property/lab: the Scenario Lab is Beta (TOOLS), and TOOL_FLAGGED marks
     no tab Beta, so its only visible state was its product's "Live". A
     status badge reading Beta sits beside its h1, outside it, and not as
     screen-reader text or a title.
   - /property/calculator: every one of the ten seeded inputs — not the four
     evidence drivers only — has the illustrative-default tag in its row.
   - /status: no capability named a "map" at /property/calculator — what
     exists is a diagram of 8 locality points per town on /property/areas,
     with no basemap, and its row says so. */
{
  const p = [];
  const got = await getAll(['/property/lab', '/property/calculator', '/status']);
  const lab = got.get('/property/lab').body || '';
  const hd = /<div class="page-hd-title">\s*<h1>([^<]*)<\/h1>\s*<span class="status-badge status-beta"[^>]*>([^<]*)<\/span>\s*<\/div>/.exec(lab);
  if (!hd) p.push('/property/lab: no status badge beside its h1 — its only visible state is the product\'s');
  else if (hd[1].trim() !== 'Scenario Lab' || hd[2].trim() !== 'Beta') p.push(`/property/lab: the heading reads "${hd[1]}" beside "${hd[2]}", not "Scenario Lab" beside "Beta"`);
  const TAG = 'Illustrative default — not yours, and not from any market';
  const SEEDED = ['price', 'rent', 'sqft', 'maintenance', 'ratePct', 'vacancyPct', 'downPct', 'apprecPct', 'tenureYears', 'holdYears'];
  const calc = got.get('/property/calculator').body || '';
  const untagged = SEEDED.filter(k => {
    const at = calc.indexOf(`id="d-${k}"`);
    if (at < 0) return true;
    const row = calc.slice(at, calc.indexOf('</div>', at));
    return !row.includes(`>${TAG}</span>`) || /class="sr-only"|hidden/.test(row.slice(row.lastIndexOf('<span', row.indexOf(TAG)), row.indexOf(TAG)));
  });
  if (untagged.length) p.push(`/property/calculator: ${SEEDED.length - untagged.length} of the ${SEEDED.length} seeded inputs carry the "${TAG}" tag in their row; ${untagged.join(', ')} do not`);
  const status = got.get('/status').body || '';
  if (/Property map and area observations/.test(status)) p.push('/status: still lists "Property map and area observations"');
  const row = /<tr>(?:(?!<\/tr>)[\s\S])*Locality diagram and area observations(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(status)?.[0] || '';
  if (!row) p.push('/status: no "Locality diagram and area observations" row');
  else {
    if (!row.includes('<a href="/property/areas">/property/areas</a>')) p.push('/status: the locality diagram\'s row does not give /property/areas as where it is');
    if (!/no basemap/.test(row) || !/8 locality points per town/.test(row)) p.push(`/status: the locality diagram's row does not say "8 locality points per town" and "no basemap": ${row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  judge(p, `/property/lab serves "Beta" beside its h1 "Scenario Lab"; /property/calculator serves the illustrative-default tag in the row of each of its ${SEEDED.length} seeded inputs; /status lists the "Locality diagram and area observations" at /property/areas, 8 locality points per town with no basemap, and no property map`,
    'a Property page serves its readiness other than as it is');
}
/* ---- end readiness-served ---- */

/* ---- n3-property-landing ---- */
/* /PROPERTY OPENS THE SCENARIO LAB, AND THE CALCULATOR'S TOP IS DRAWERS
   (N3, the 5 Oct audit; the owner's decision D18). /property served the
   calculator: about 730 words before its first field, 571 of them prose in
   20 blocks of eight words or more — a Start here panel, the methodology,
   the blockers, a Summary table, notes and two section contracts — and the
   cash and the monthly position three times. Now, read as a fetch reads it
   (what is visible: not under [hidden], aria-hidden, .sr-only, an <svg> or
   a closed <details> but its <summary>):
   - /property: at most 290 words in <main> before the first form control
     (an input, select or textarea, or a served control made inert as a
     field, a slider or a choice), at most 228 of them in blocks of eight
     words or more;
   - before that control, in this order: the identity line, naming the
     property or "Sample deal", then four tiles labelled Cash required,
     Monthly position, Net yield and Next step, each with a kind tag;
   - "Not an official property valuation" and "not a real listing" visible
     before it;
   - /property/calculator: the methodology ("The score and the grade are
     not the same claim"), the pillar table and the list of blockers inside
     closed <details>, with the worst blocker in sight on one line, and the
     cash to complete and the monthly position stated once above the
     sections.
   THE TWO QUESTIONS (the property decision layer, P1, 8 Oct 2026) are the
   page's first controls, between the identity line and the tiles: "the
   first form control" above is the first one after them ([data-pq]), and
   the p1-questions check below holds them to being first. */
{
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'header', 'footer', 'nav', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'caption', 'dl', 'dt', 'dd', 'details', 'summary', 'form', 'fieldset', 'legend', 'figure', 'figcaption', 'article', 'aside', 'main', 'br', 'hr', 'blockquote', 'pre',
    'label', 'button', 'select', 'textarea', 'input']);
  const ent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attr = (tag, k) => { const m = new RegExp(`\\s${k}(?:="([^"]*)"|='([^']*)'|(?=[\\s>/]))`, 'i').exec(tag); return m ? (m[1] ?? m[2] ?? '') : null; };
  /* One pass over <main>: each tag and each run of text with whether it is
     visible there and whether a closed <details> holds it; the visible words
     in blocks (a block-level tag ends one); and the first form control. */
  const scan = (html) => {
    const from = html.search(/<main\b/), to = html.indexOf('</main>', from);
    const body = from < 0 ? '' : html.slice(from, to < 0 ? undefined : to);
    const stack = [], blocks = [], tags = [], runs = [];
    let cur = [], control = null, qControl = null;
    const visible = () => stack.every(f => !f.skip && !(f.closed && !f.inSummary));
    const inClosed = () => stack.some(f => f.closed && !f.inSummary);
    const flush = () => { const w = cur.join(' ').split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t)); if (w.length) blocks.push(w); cur = []; };
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m[4] != null) { const s = ent(m[4]); runs.push({ at: m.index, s, visible: visible(), closed: inClosed() }); if (visible()) cur.push(s); continue; }
      if (!m[2]) continue;
      const close = m[1] === '/', tag = m[2].toLowerCase(), raw = m[0];
      if (BLOCK.has(tag)) flush();
      if (close) {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { if (tag === 'summary' && stack[i - 1]?.closed) stack[i - 1].inSummary = false; stack.length = i; break; }
        continue;
      }
      if (tag === 'script' || tag === 'style' || tag === 'template') { const e = body.indexOf(`</${tag}`, re.lastIndex); re.lastIndex = e < 0 ? body.length : e; continue; }
      const inert = attr(raw, 'data-inert'), type = (attr(raw, 'type') || '').toLowerCase();
      const isControl = (tag === 'input' && type !== 'hidden') || tag === 'select' || tag === 'textarea' || ['field', 'range', 'choice'].includes(inert);
      const inPq = stack.some(f => f.pq);
      tags.push({ at: m.index, tag, raw, visible: visible(), closed: inClosed(), pq: inPq });
      if (isControl && visible() && inPq && !qControl) qControl = { at: m.index, tag, inert, blocks: blocks.length };
      if (isControl && visible() && !inPq && !control) { flush(); control = { at: m.index, tag, inert, blocks: blocks.length }; }
      if (VOID.has(tag) || raw.endsWith('/>')) continue;
      const cls = ` ${attr(raw, 'class') || ''} `;
      const f = { tag, skip: tag === 'svg' || attr(raw, 'hidden') !== null || attr(raw, 'aria-hidden') === 'true' || / sr-only /.test(cls),
        closed: tag === 'details' && attr(raw, 'open') === null, inSummary: false, pq: attr(raw, 'data-pq') !== null };
      if (tag === 'summary' && stack[stack.length - 1]?.closed) stack[stack.length - 1].inSummary = true;
      stack.push(f);
    }
    flush();
    /* The visible text of the element whose tag opens at `at`, to its end
       (all of its text, with `all`). */
    const textOf = (at, all = false) => {
      const t = tags.find(x => x.at === at);
      if (!t) return '';
      let depth = 0, out = '';
      const re2 = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
      re2.lastIndex = at;
      let n;
      while ((n = re2.exec(body))) {
        if (n[4] != null) { const run = runs.find(r => r.at === n.index); if (run && (all || run.visible)) out += run.s; continue; }
        const tg = n[2].toLowerCase();
        if (VOID.has(tg) || n[0].endsWith('/>')) continue;
        if (tg !== t.tag) continue;
        depth += n[1] ? -1 : 1;
        if (!depth) break;
      }
      return out.replace(/\s+/g, ' ').trim();
    };
    return { body, blocks, tags, runs, control, qControl, textOf };
  };
  const p = [], said = {};
  const got = await getAll(['/property', '/property/calculator']);
  const land = got.get('/property'), calc = got.get('/property/calculator');
  if (land.status !== 200) p.push(`/property: ${described(land)}`);
  if (calc.status !== 200) p.push(`/property/calculator: ${described(calc)}`);
  const L = scan(land.body || '');
  if (!L.control) p.push('/property: serves no form control in <main>');
  else {
    const before = L.blocks.slice(0, L.control.blocks);
    const words = before.flat().length, prose = before.filter(b => b.length >= 8);
    const proseWords = prose.reduce((a, b) => a + b.length, 0);
    said.words = words; said.prose = proseWords; said.proseBlocks = prose.length;
    if (words > 290) p.push(`/property: ${words} visible words in <main> before the first form control, more than 290`);
    if (proseWords > 228) p.push(`/property: ${proseWords} of them in ${prose.length} blocks of eight words or more, more than 228`);
    const seen = L.runs.filter(r => r.at < L.control.at && r.visible).map(r => r.s).join(' ').replace(/\s+/g, ' ');
    for (const want of ['Not an official property valuation', 'not a real listing']) if (!seen.includes(want)) p.push(`/property: "${want}" is not visible before the first form control`);
    const id = L.tags.find(t => / lab-identity /.test(` ${attr(t.raw, 'class') || ''} `));
    if (!id || !id.visible || id.at > L.control.at) p.push(`/property: ${!id ? 'no identity line (.lab-identity)' : !id.visible ? 'its identity line is not visible' : 'its identity line comes after the first form control'}`);
    else {
      const name = L.textOf(L.tags.find(t => t.at > id.at && attr(t.raw, 'id') === 'lab-status')?.at ?? -1);
      said.identity = name;
      if (!/^(Sample deal|“[^”]+”)/.test(name)) p.push(`/property: the identity line names "${name.slice(0, 60)}", not the property or "Sample deal"`);
    }
    const WANT = ['Cash required', 'Monthly position', 'Net yield', 'Next step'];
    const tiles = L.tags.filter(t => attr(t.raw, 'data-tile') !== null && / lab-tile /.test(` ${attr(t.raw, 'class') || ''} `));
    const labels = tiles.map(t => L.textOf(L.tags.find(x => x.at > t.at && / lab-tile-label /.test(` ${attr(x.raw, 'class') || ''} `))?.at ?? -1));
    const kinds = tiles.map((t, i) => { const k = L.tags.find(x => x.at > t.at && (i + 1 >= tiles.length || x.at < tiles[i + 1].at) && attr(x.raw, 'data-kind') !== null); return k ? [attr(k.raw, 'data-kind'), L.textOf(k.at)] : null; });
    said.tiles = labels.map((l, i) => `${l} [${kinds[i]?.[1] || 'no tag'}]`);
    if (JSON.stringify(labels) !== JSON.stringify(WANT)) p.push(`/property: its tiles are labelled ${JSON.stringify(labels)}, not ${JSON.stringify(WANT)}`);
    tiles.forEach((t, i) => {
      if (!t.visible || t.at > L.control.at || (id && t.at < id.at)) p.push(`/property: the "${labels[i]}" tile is ${!t.visible ? 'not visible' : t.at > L.control.at ? 'after the first form control' : 'before the identity line'}`);
      if (!kinds[i] || !kinds[i][0] || !kinds[i][1]) p.push(`/property: the "${labels[i]}" tile carries no kind tag`);
    });
  }
  const C = scan(calc.body || '');
  const firstSection = C.tags.find(t => attr(t.raw, 'id') === 'acquisition')?.at ?? Infinity;
  const method = C.runs.find(r => r.s.includes('The score and the grade are not the same claim'));
  if (!method) p.push('/property/calculator: serves no "The score and the grade are not the same claim" — the check has nothing to read');
  else if (!method.closed) p.push('/property/calculator: "The score and the grade are not the same claim" is not inside a closed <details>');
  const pillar = C.tags.find(t => t.tag === 'th' && C.textOf(t.at, true) === 'Pillar');
  if (!pillar) p.push('/property/calculator: serves no pillar table');
  else if (!pillar.closed) p.push('/property/calculator: the pillar table is not inside a closed <details>');
  const gates = C.tags.filter(t => t.tag === 'li' && / evidence counter /.test(` ${attr(t.raw, 'class') || ''} `) && t.at < firstSection);
  if (!gates.length) p.push('/property/calculator: serves no blockers above its sections — the check has nothing to read');
  else if (gates.some(t => !t.closed)) p.push(`/property/calculator: ${gates.filter(t => !t.closed).length} of its ${gates.length} blockers stand outside a closed <details>`);
  const worst = C.tags.find(t => / pc-worst /.test(` ${attr(t.raw, 'class') || ''} `));
  if (!worst || !worst.visible) p.push('/property/calculator: the worst blocker is not in sight on its own line (.pc-worst)');
  else said.worst = C.textOf(worst.at).slice(0, 60);
  /* Stated once above the sections: the capstrip and the Summary table
     said the cash and the monthly position again. */
  const top = C.runs.filter(r => r.visible && r.at < firstSection).map(r => r.s).join(' ').replace(/\s+/g, ' ');
  for (const k of ['Cash to complete', 'Monthly position']) {
    const n = top.split(k).length - 1;
    if (n !== 1) p.push(`/property/calculator: "${k}" is visible ${n} times above its sections, not once`);
  }
  judge(p, `/property opens the Scenario Lab: ${said.words} visible words in <main> before the first form control (≤290), ${said.prose} of them in ${said.proseBlocks} blocks of eight or more (≤228); before it the identity line ("${said.identity}"), then the tiles ${(said.tiles || []).join(', ')}, with "Not an official property valuation" and "not a real listing" in sight; /property/calculator keeps the methodology, the pillar table and its blockers in closed drawers, the worst in sight ("${said.worst}…"), and says the cash to complete and the monthly position once above its sections`,
    '/property is not the Scenario Lab with its identity line and four tiles first, or the calculator\'s top is not compacted (N3, D18)');

  /* ---- p1-questions ---- */
  /* THE TWO QUESTIONS, SERVED FIRST (the property decision layer, P1; the
     owner's brief of 7 Oct 2026). On /property and /property/calculator, as
     a fetch reads them: the questions ([data-pq]) serve "What are you
     buying?" with Residential · Commercial · Land and "How are you
     buying?" with New development · Subsale · Auction, each a row of
     choices that is one line of chips on a phone (ls-chips), and the
     optional objective; their first choice is the page's first form
     control — before every slider, field and other choice in <main> — and
     on /property it stands after the identity line and before the tiles;
     and the sample is served answered as every deal was before the
     questions: Residential, Subsale, no objective. */
  {
    const q = [], qs = {};
    const choices = (S, group) => {
      const fs = S.tags.find(t => t.tag === 'fieldset' && attr(t.raw, 'data-q') === group && t.pq);
      if (!fs) return null;
      const end = S.tags.find(t => t.at > fs.at && (t.tag === 'fieldset' || !t.pq))?.at ?? Infinity;
      const opts = S.tags.filter(t => t.at > fs.at && t.at < end && / lab-seg-opt /.test(` ${attr(t.raw, 'class') || ''} `));
      const row = S.tags.find(t => t.at > fs.at && t.at < end && / lab-seg /.test(` ${attr(t.raw, 'class') || ''} `));
      return { legend: S.textOf(S.tags.find(t => t.at > fs.at && t.tag === 'legend')?.at ?? -1),
        chips: !!row && / ls-chips /.test(` ${attr(row.raw, 'class') || ''} `), visible: fs.visible,
        opts: opts.map(o => { const all = S.textOf(o.at, true); return { label: S.textOf(o.at).replace(/[☑☐]/g, '').trim(), on: all.includes('☑') }; }) };
    };
    for (const [path, S, prefix] of [['/property', L, 'lab'], ['/property/calculator', C, 'pc']]) {
      const what = choices(S, 'what'), how = choices(S, 'how'), why = choices(S, 'why');
      if (!what || !how) { q.push(`${path}: serves no ${!what ? '"What are you buying?"' : '"How are you buying?"'} among its questions ([data-pq])`); continue; }
      const W = [['What are you buying?', what, ['Residential', 'Commercial', 'Land'], 'Residential'], ['How are you buying?', how, ['New development', 'Subsale', 'Auction'], 'Subsale']];
      for (const [legend, g, want, on] of W) {
        if (g.legend !== legend) q.push(`${path}: a question reads "${g.legend}", not "${legend}"`);
        if (!g.visible) q.push(`${path}: "${legend}" is not visible`);
        if (JSON.stringify(g.opts.map(o => o.label)) !== JSON.stringify(want)) q.push(`${path}: "${legend}" offers ${JSON.stringify(g.opts.map(o => o.label))}, not ${JSON.stringify(want)}`);
        const ons = g.opts.filter(o => o.on).map(o => o.label);
        if (ons.join() !== on) q.push(`${path}: "${legend}" is served answered ${ons.join(', ') || 'with nothing'}, not ${on} — the answer every deal had before the question`);
        if (!g.chips) q.push(`${path}: "${legend}"'s choices are not a row of chips (ls-chips) for a phone`);
      }
      if (!why || why.legend !== 'Objective (optional)' || why.opts.filter(o => o.on).map(o => o.label).join() !== 'Not chosen') q.push(`${path}: the objective is served ${why ? `"${why.legend}" answered ${why.opts.filter(o => o.on).map(o => o.label).join(', ')}` : 'not at all'}, not optional and not chosen`);
      if (!S.qControl) q.push(`${path}: the questions serve no choice`);
      else if (S.control && S.qControl.at > S.control.at) q.push(`${path}: a form control comes before the questions`);
      /* On a phone the questions fold into one summary line (the owner's
         decision, 9 Oct 2026): served with it, saying the answers, its
         Change beside it; the questions themselves served whole under it, as
         a page with no script shows them. */
      const sumAt = S.tags.find(t => attr(t.raw, 'id') === `${prefix}-q-sum`);
      const sumWords = sumAt ? S.textOf(sumAt.at, true) : null;
      if (sumWords !== 'Residential · Subsale') q.push(`${path}: the questions' summary line is served ${sumWords == null ? 'not at all' : `reading "${sumWords}"`}, not "Residential · Subsale"`);
      if (!S.tags.some(t => attr(t.raw, 'id') === `${prefix}-q-change`)) q.push(`${path}: the summary line's Change is not served`);
      if (sumAt && S.qControl && sumAt.at > S.qControl.at) q.push(`${path}: the summary line is served after the questions`);
      qs[path] = `${what.opts.map(o => o.label + (o.on ? '*' : '')).join(' · ')} / ${how.opts.map(o => o.label + (o.on ? '*' : '')).join(' · ')}`;
    }
    if (L.qControl) {
      const id = L.tags.find(t => / lab-identity /.test(` ${attr(t.raw, 'class') || ''} `));
      const tile = L.tags.find(t => attr(t.raw, 'data-tile') !== null);
      if (!id || id.at > L.qControl.at) q.push('/property: the questions come before the identity line, or there is none');
      if (!tile || tile.at < L.qControl.at) q.push('/property: a tile comes before the questions');
    }
    judge(q, `the two questions are served first on /property (after the identity line, before the tiles) and on /property/calculator, each a row of chips for a phone and, for a phone, their summary line served ahead of them ("Residential · Subsale" and Change), the sample answered as every deal was: ${Object.entries(qs).map(([k, v]) => `${k} ${v}`).join('; ')}; the objective optional, not chosen`,
      'the two questions are not the first controls of /property and the calculator, or the sample is not served as a subsale of its class (the property decision layer, P1)');
  }
  /* ---- end p1-questions ---- */
}
/* ---- end n3-property-landing ---- */
/* ---- layout-system ---- */
/* THE PAGES ON THE LAYOUT SYSTEM, AS SERVED (the owner's decision, 7 Oct
   2026; 37-layout-system.js). /property, /property/calculator and, since
   its first view (N5), /app/scanner, read as a fetch reads them:
   - the page is on the system: its view is .ls-view, its root .ls-page;
   - every card is one of the four types, and holds what its type holds —
     a metric its label, its value and its data badge; an action its title,
     one line and one call to action; an alert its count of what needs
     evidence and "Review"; an insight its figure, its finding and "See
     why" — and every other surface drawn as a card is a named one: a
     section (with its heading), the page's bar (with its controls), a form
     (with its fields), a figure of a section (with its figure) or L3
     evidence (a <details> or an <aside>);
   - the type is the scale's: a size written on the page is a token
     (var(--ls-…)), and the stylesheet the page loads defines the seven;
   - no block of text is let wider than 70 characters: the measure is a
     token of 70ch or less, the stylesheet holds every paragraph, item and
     definition on these pages to it, and no width written on the page is
     wider.
   Each fails on 740ceab merged with main: no page carried the system, the
   tiles and the calculator's 32 panels were none of the four, and sizes and
   widths were px and ch written past it (mobile.mjs holds what is drawn). */
{
  const p = [], said = { cards: {}, surfaces: {}, sizes: 0 };
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const attrOf = (raw, k) => { const m = new RegExp(`\\s${k}(?:="([^"]*)"|='([^']*)'|(?=[\\s>/]))`, 'i').exec(raw); return m ? (m[1] ?? m[2] ?? '') : null; };
  /* <main> as a tree: enough to ask what an element holds. */
  const tree = (html) => {
    const from = html.search(/<main\b/), to = html.indexOf('</main>', from);
    const body = from < 0 ? '' : html.slice(from, to < 0 ? undefined : to);
    const root = { tag: '#root', kids: [], text: '' }, stack = [root];
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m[4] != null) { stack.forEach(n => { n.text += m[4]; }); continue; }
      if (!m[2]) continue;
      const tag = m[2].toLowerCase();
      if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
      if (tag === 'script' || tag === 'style') { const e = body.indexOf(`</${tag}`, re.lastIndex); re.lastIndex = e < 0 ? body.length : e; continue; }
      const raw = m[0], cls = (attrOf(raw, 'class') || '').split(/\s+/).filter(Boolean);
      const n = { tag, raw, cls, kids: [], text: '', parent: stack[stack.length - 1] };
      n.parent.kids.push(n);
      if (!VOID.has(tag) && !raw.endsWith('/>')) stack.push(n);
    }
    return root;
  };
  const all = (n, out = []) => { for (const k of n.kids) { out.push(k); all(k, out); } return out; };
  const has = (n, test) => all(n).filter(test);
  const hasCls = (c) => (x) => x.cls.includes(c);
  const words = (n) => n.text.replace(/\s+/g, ' ').trim();
  const CARDISH = ['card', 'panel', 'ls-card', 'lab-tile', 'tile'];
  const FIELD = (x) => ['input', 'select', 'textarea'].includes(x.tag) || ['field', 'range', 'choice'].includes(attrOf(x.raw, 'data-inert'));
  const CONTROL = (x) => x.tag === 'button' || x.tag === 'a' || attrOf(x.raw, 'data-inert') !== null || FIELD(x);
  /* /app/scanner joined with its first view (N5, 8 Oct 2026); /app, My
     Dashboard, as a workspace (D12, 8 Oct 2026). */
  /* /research, Research's front page (N7, 9 Oct 2026). */
  const LS_PAGES = ['/property', '/property/calculator', '/app/scanner', '/app', '/research'];
  const got = await getAll(LS_PAGES);
  /* The stylesheet the pages load. */
  const cssHref = ((got.get('/property')?.body || '').match(/<link rel="stylesheet" href="([^"]+)"/) || [])[1];
  const css = cssHref ? (await get(cssHref)).body : '';
  const TOKENS = ['--ls-hero', '--ls-title', '--ls-section', '--ls-metric', '--ls-body', '--ls-support', '--ls-meta'];
  const missing = TOKENS.filter(t => !new RegExp(`${t}\\s*:`).test(css));
  if (!css) p.push(`the pages load no stylesheet that could be read (${cssHref || 'none named'})`);
  else if (missing.length) p.push(`the stylesheet defines no ${missing.join(', ')} — the type scale's tokens`);
  const measure = (css.match(/--ls-measure\s*:\s*([\d.]+)ch/) || [])[1];
  if (!measure || Number(measure) > 70) p.push(`the measure token --ls-measure is ${measure ? `${measure}ch, wider than 70ch` : 'not defined in ch'}`);
  if (!/\.ls-view\s+:is\(p,\s*li,\s*dd[^)]*\)\s*\{\s*max-width:\s*var\(--ls-measure\)/.test(css)) p.push('the stylesheet does not hold a page\'s paragraphs, items and definitions to --ls-measure');
  for (const [path, r] of got) {
    if (r.status !== 200) { p.push(`${path}: ${described(r)}`); continue; }
    const root = tree(r.body);
    const view = has(root, x => x.tag === 'section' && x.cls.includes('view'))[0];
    if (!view) { p.push(`${path}: serves no view`); continue; }
    /* Not on the system, its cards are still read: what it would have to change. */
    if (!view.cls.includes('ls-view')) p.push(`${path}: its view is not on the system (.ls-view)`);
    if (!has(view, hasCls('ls-page')).length) p.push(`${path}: no .ls-page in its view`);
    for (const n of all(view)) {
      if (!n.cls.some(c => CARDISH.includes(c))) continue;
      const type = attrOf(n.raw, 'data-card');
      const name = `${path}: ${n.tag}.${n.cls.join('.')} “${words(n).slice(0, 48)}”`;
      if (n.cls.includes('ls-card') && type) {
        if (!['metric', 'action', 'alert', 'insight'].includes(type)) { p.push(`${name} is a card of no type of the four ("${type}")`); continue; }
        said.cards[type] = (said.cards[type] || 0) + 1;
        const q = (test) => has(n, test);
        if (type === 'metric') {
          if (!q(x => x.cls.includes('ls-card-label') || x.cls.includes('stat-label')).length) p.push(`${name}: a metric card with no label`);
          if (!q(x => x.cls.includes('ls-card-value') || x.cls.includes('stat-value')).length) p.push(`${name}: a metric card with no value`);
          if (!q(x => x.cls.includes('ls-badge') && words(x)).length) p.push(`${name}: a metric card with no data badge`);
        } else if (type === 'action') {
          if (!q(x => x.cls.includes('ls-card-label') || x.cls.includes('ls-card-title')).length) p.push(`${name}: an action card with no title`);
          if (!q(hasCls('ls-card-sub')).length) p.push(`${name}: an action card with no line`);
          if (q(hasCls('ls-card-cta')).length !== 1) p.push(`${name}: an action card with ${q(hasCls('ls-card-cta')).length} calls to action, not one`);
        } else if (type === 'alert') {
          const t = q(hasCls('ls-card-title'))[0];
          if (!t || !/^\d+ .*\bneeds?\b/.test(words(t))) p.push(`${name}: an alert that does not count what needs the reader ("${t ? words(t) : ''}")`);
          if (!q(x => x.cls.includes('ls-card-cta') && /^Review\b/.test(words(x))).length) p.push(`${name}: an alert with no "Review"`);
        } else if (type === 'insight') {
          if (!q(hasCls('ls-card-figure')).length) p.push(`${name}: an insight with no figure`);
          if (!q(hasCls('ls-card-title')).length) p.push(`${name}: an insight with no finding`);
          if (!q(x => x.cls.includes('ls-card-cta') && /^See why\b/.test(words(x))).length) p.push(`${name}: an insight with no "See why"`);
        }
        continue;
      }
      const kind = ['ls-section', 'ls-bar', 'ls-form', 'ls-fig', 'ls-l3'].find(k => n.cls.includes(k));
      if (!kind) { p.push(`${name} is drawn as a card and is none of the four types, nor a named surface`); continue; }
      said.surfaces[kind] = (said.surfaces[kind] || 0) + 1;
      if (kind === 'ls-section' && !has(n, x => /^h[1-6]$/.test(x.tag)).length) p.push(`${name}: a section with no heading`);
      if (kind === 'ls-bar' && !has(n, CONTROL).length) p.push(`${name}: a bar with no control`);
      if (kind === 'ls-form' && !has(n, FIELD).length) p.push(`${name}: a form with no field`);
      if (kind === 'ls-fig' && !has(n, x => x.cls.includes('stat-value') || x.cls.includes('num')).length) p.push(`${name}: a figure with no figure`);
      if (kind === 'ls-l3' && !['details', 'aside'].includes(n.tag)) p.push(`${name}: L3 evidence that is not a <details> or an <aside>`);
    }
    /* Sizes and widths written on the page. */
    for (const n of all(view)) {
      const st = attrOf(n.raw, 'style');
      if (!st) continue;
      for (const [, v] of st.matchAll(/font-size\s*:\s*([^;]+)/g)) { said.sizes++; if (!/^var\(--ls-[a-z0-9-]+\)$/.test(v.trim())) p.push(`${path}: ${n.tag}.${n.cls.join('.')} is sized ${v.trim()}, not a token of the scale`); }
      for (const [, v] of st.matchAll(/max-width\s*:\s*([\d.]+)ch/g)) if (Number(v) > 70) p.push(`${path}: ${n.tag}.${n.cls.join('.')} is let ${v}ch wide, more than 70`);
    }
  }
  const tally = (o) => Object.entries(o).map(([k, v]) => `${v} ${k}`).join(', ');
  judge(p, `the pages on the layout system (${LS_PAGES.join(", ")}): every card one of the four types with what its type holds (${tally(said.cards)}), every other card-drawn surface a named one (${tally(said.surfaces)}); the seven type tokens defined and all ${said.sizes} sizes written on the pages tokens; the measure --ls-measure ${measure}ch, held on every paragraph, item and definition, and no width written past 70ch`,
    'a page on the layout system serves a card that is none of the four types, a size off the scale, or a text block let wider than 70ch');
}
/* ---- end layout-system ---- */

/* ---- home-3a ---- */
/* THE HOMEPAGE CLEANUP, AS SERVED (plan Phase 3A and 3B; the owner's
   decisions D5, D6, D17, D21 and D22, 5 Oct 2026), read as a fetch reads
   it — each item a [fetch] acceptance line of the plan, the addendum's N8,
   N9 and N2a. Each fails on the merged base 7d25484e (the homepage of
   557 drawn words, the strip a line and a button, Pricing of 1,002 words):
   3.1  the strip is a native <details> on every page — its summary holds
        "Beta preview. Do not use figures here for investment decisions."
        and "· SEC-filed and illustrative data, labelled · No licensed
        prices", with no link in it; its body Research mode, "No advice · No
        recommendations", /data-sources and /how-it-works#hiw-status;
   3.2  /'s hero: the held h1, POSITIONING's lede, 15 words or fewer, one
        call to action;
   3.3  three cards, each an <article> of 12 words or fewer outside its
        figure, its link described by its qualifier and its note (both
        served), no link, button or <details> inside a link; the Property
        card links /property/lab; the Scanner's ⓘ says "this site ships no
        prices"; the badges on /, /how-it-works and the footer read Beta,
        Beta, Live and Coming soon; Business is text;
   3.4, N9  the example path: an "Example" label, 50 words or fewer, two
        <ol>s of 5 and 4 links each served 200, no digit, ticker or company
        name; "Saved in this browser" once, one link to /my/data;
        /how-it-works#hiw-journey still holds its five steps;
   3.5  <div id="views"> within the first 16kB of every served page; no
        "My Dashboard" or "Saved Models" before /'s h1, no "My workspace" on
        /about; each positioning string one variant across the served pages;
   3.6  / within its budgets (homeBudgets, build.mjs);
   3.8  two cards or more with an <svg> of data marks and a source label;
        the Equities columns equal Apple's revenue and net income in the
        served data/us.json, in US$; no baseCcy among /'s served reads; no
        digit in the Scanner card but the 50; no "matched", "approaching" or
        "watching" on /;
   N8   /pricing: its h1 and "Nothing on this page can be bought." first,
        three cards of 20 words or fewer besides name and price, each saying
        "Not on sale" or "Nothing to buy", no link, button or .btn in a card,
        no btn-primary in main, buttons only in the closed "Compare
        details", 300 words or fewer outside it, the coverage line once, and
        "not on sale" beside every link to /pricing in a page's main;
   N2a  on /, /property, /property/calculator, /property/lab, /how-it-works,
        /about and /status, every Property Live badge with "Your figures,
        sample to start" in sight beside it, as many qualifiers as badges. */
{
  const B = await import('./build.mjs');
  const P = RENDER_PLAN.POSITIONING || {};
  const p = [], said = {};
  const T = (html) => B.htmlTree(html);
  const all = B.allOf, has = B.hasClass, attr = B.attrOf, sight = B.sightText, wordsIn = B.wordsIn;
  const mainOf = (html) => all(T(html)).find(n => n.tag === 'main');
  /* Every word under n, in sight or not (what a closed <details> holds). */
  const rawText = (n) => { let o = ''; const w = (x) => { for (const k of x.kids || []) { if (k.tag === '#text') o += k.text; else { o += ' '; w(k); } } }; w(n); return o.replace(/\s+/g, ' ').trim(); };
  const { companies } = companyPlan(ORIGIN, router);
  const STRIP_PAGES = ['/', '/property', '/company/aapl-apple-inc', '/nope-for-home-3a'];
  const got = await getAll([...new Set([...statics, ...STRIP_PAGES, '/data/us.json'])]);
  /* 3.1 */
  for (const path of [...new Set([...STRIP_PAGES, ...statics])]) {
    const body = got.get(path)?.body || '';
    const nodes = all(T(body));
    const region = nodes.find(n => n.tag === 'div' && has(n, 'disclosure') && attr(n, 'role') === 'region');
    const det = region && all(region).find(n => n.tag === 'details');
    const sum = det && det.kids.find(k => k.tag === 'summary');
    if (!det || !sum) { p.push(`${path}: the strip is not a <details> with a summary inside its region`); continue; }
    if (attr(det, 'open') !== null) p.push(`${path}: the strip is served open`);
    const s = sight(sum);
    if (!s.includes('Beta preview. Do not use figures here for investment decisions.')) p.push(`${path}: the strip's summary does not hold the warning sentence word for word: "${s.slice(0, 100)}"`);
    if (!s.includes('· SEC-filed and illustrative data, labelled · No licensed prices')) p.push(`${path}: the strip's summary does not say "· SEC-filed and illustrative data, labelled · No licensed prices"`);
    if (all(sum).some(n => n.tag === 'a')) p.push(`${path}: a link inside the strip's summary`);
    const inside = all(det).filter(n => n !== sum && !all(sum).includes(n));
    const txt = rawText(det);
    for (const w of ['Research mode', 'No advice · No recommendations']) if (!txt.includes(w)) p.push(`${path}: the strip's Details do not hold "${w}"`);
    for (const h of ['/data-sources', '/how-it-works#hiw-status']) if (!inside.some(n => n.tag === 'a' && attr(n, 'href') === h)) p.push(`${path}: the strip's Details do not link ${h}`);
  }
  said.strips = STRIP_PAGES.length + statics.length;
  /* 3.2 */
  const home = got.get('/')?.body || '';
  const hm = mainOf(home);
  const hero = hm && all(hm).find(n => has(n, 'pub-hero'));
  if (!hero) p.push('/: no .pub-hero');
  else {
    const h1 = all(hero).find(n => n.tag === 'h1'), lede = all(hero).find(n => has(n, 'pub-lede'));
    if (!h1 || sight(h1) !== 'Make financial decisions with greater clarity.') p.push(`/: the h1 reads "${h1 ? sight(h1) : ''}", not the held headline`);
    if (!lede || sight(lede) !== P.lede) p.push(`/: the lede reads "${lede ? sight(lede) : ''}", not POSITIONING's "${P.lede}"`);
    said.hero = wordsIn(`${h1 ? sight(h1) : ''} ${lede ? sight(lede) : ''}`).length;
    if (said.hero > 15) p.push(`/: the h1 and the lede are ${said.hero} words, more than 15`);
    const acts = all(hero).filter(n => n.tag === 'a' || n.tag === 'button' || attr(n, 'data-inert') === 'button');
    if (acts.length !== 1) p.push(`/: the hero has ${acts.length} calls to action, not one`);
  }
  /* 3.3 */
  const cards = hm ? all(hm).filter(n => n.tag === 'article' && has(n, 'pub-card')) : [];
  if (cards.length !== 3) p.push(`/: ${cards.length} product cards (<article>), not three`);
  for (const c of cards) {
    const id = attr(c, 'data-product') || '?';
    const w = wordsIn(sight(c, n => n.tag === 'figure' || has(n, 'pub-card-also'))).length;
    if (w > 12) p.push(`/: the ${id} card is ${w} words outside its figure, more than 12`);
    const link = all(c).find(n => n.tag === 'a' && has(n, 'pub-card-link'));
    const ids = (link && attr(link, 'aria-describedby') || '').split(/\s+/).filter(Boolean);
    const q = ids.find(x => /-q$/.test(x)), note = ids.find(x => /-note$/.test(x));
    if (!q || !note || !home.includes(`id="${q}"`) || !home.includes(`id="${note}"`)) p.push(`/: the ${id} card's link is not described by its qualifier and its note, both served (${ids.join(' ')})`);
    if (!all(c).some(n => n.tag === 'details' && has(n, 'pub-info'))) p.push(`/: the ${id} card has no ⓘ (<details>)`);
  }
  if (hm) for (const a of all(hm).filter(n => n.tag === 'a')) if (all(a).some(n => ['a', 'button', 'details'].includes(n.tag))) p.push(`/: a link holds a ${all(a).find(n => ['a', 'button', 'details'].includes(n.tag)).tag}`);
  const cardOf = (id) => cards.find(c => attr(c, 'data-product') === id);
  if (!cardOf('property') || !all(cardOf('property')).some(n => n.tag === 'a' && attr(n, 'href') === '/property/lab')) p.push('/: the Property card does not link /property/lab');
  const scanNote = cardOf('scanner') && all(cardOf('scanner')).find(n => has(n, 'pub-info-body'));
  if (!scanNote || !/this site ships no prices/.test(rawText(scanNote))) p.push('/: the Scanner card\'s ⓘ does not say "this site ships no prices"');
  const WANT = { equities: 'Beta', scanner: 'Beta', property: 'Live', business: 'Coming soon' };
  const badgeIn = (n) => { const b = n && all(n).find(x => has(x, 'status-badge')); return b ? sight(b) : null; };
  for (const [id, want] of Object.entries(WANT)) {
    const onHome = id === 'business' ? badgeIn(hm && all(hm).find(n => has(n, 'pub-soon'))) : badgeIn(cardOf(id));
    if (onHome !== want) p.push(`/: the ${id} badge reads ${JSON.stringify(onHome)}, not "${want}"`);
  }
  const soon = hm && all(hm).find(n => has(n, 'pub-soon'));
  if (!soon || all(soon).some(n => n.tag === 'a') || !/Business Intelligence · Plan my business ·/.test(sight(soon))) p.push(`/: Business is not one line of text, "Business Intelligence · Plan my business · Coming soon" (${soon ? sight(soon) : 'none'})`);
  const hiw = got.get('/how-it-works')?.body || '';
  const hiwNodes = all(T(hiw));
  for (const [id, want] of Object.entries(WANT)) {
    const sec = hiwNodes.find(n => attr(n, 'id') === `hiw-${id}`);
    const st = sec && all(sec).find(n => has(n, 'hiw-product-status'));
    if (badgeIn(st) !== want) p.push(`/how-it-works: the ${id} badge reads ${JSON.stringify(badgeIn(st))}, not "${want}"`);
  }
  const foot = all(T(home)).find(n => attr(n, 'id') === 'footProducts');
  const footBadges = foot ? foot.kids.filter(k => k.tag === 'li').map(li => badgeIn(li)) : [];
  if (JSON.stringify(footBadges) !== JSON.stringify(Object.values(WANT))) p.push(`/: the footer's badges read ${JSON.stringify(footBadges)}, not ${JSON.stringify(Object.values(WANT))}`);
  /* 3.4 and N9 */
  const path = hm && all(hm).find(n => has(n, 'pub-path'));
  if (!path) p.push('/: no example path (.pub-path)');
  else {
    const text = sight(path);
    said.path = wordsIn(text).length;
    if (said.path > 50) p.push(`/: the example path is ${said.path} words, more than 50`);
    if (!/\bExample\b/.test(text)) p.push('/: the example path carries no "Example" label');
    const ols = all(path).filter(n => n.tag === 'ol');
    const counts = ols.map(o => all(o).filter(n => n.tag === 'a').length);
    if (JSON.stringify(counts) !== '[5,4]') p.push(`/: the example path's lists hold ${JSON.stringify(counts)} links, not two of 5 and 4`);
    const hrefs = [...new Set(ols.flatMap(o => all(o).filter(n => n.tag === 'a').map(n => attr(n, 'href'))))];
    const st = await getAll(hrefs);
    for (const h of hrefs) if (st.get(h)?.status !== 200) p.push(`/: the example path links ${h}, served ${described(st.get(h))}`);
    if (/\d/.test(text)) p.push(`/: the example path carries a digit: "${text.match(/.{0,20}\d.{0,20}/)[0]}"`);
    const tickers = new Set(companies.map(co => co.company.tk).filter(t => t && t.length > 1));
    const names = new Set(companies.map(co => co.company.name.split(/\s+/)[0]).filter(x => x.length > 3));
    const hit = text.split(/[\s,.]+/).find(t => tickers.has(t) || names.has(t));
    if (hit) p.push(`/: the example path names "${hit}", a ticker or a company`);
  }
  const homeText = pageText(home);
  const savedN = homeText.split('Saved in this browser').length - 1;
  const myData = hm ? all(hm).filter(n => n.tag === 'a' && attr(n, 'href') === '/my/data').length : 0;
  if (savedN !== 1 || myData !== 1) p.push(`/: "Saved in this browser" ${savedN} times and ${myData} links to /my/data in main, not one of each`);
  const journey = hiwNodes.find(n => attr(n, 'id') === 'hiw-journey');
  if (!journey || all(journey).filter(n => has(n, 'hiw-path-step')).length !== 5) p.push('/how-it-works#hiw-journey does not hold its five steps');
  /* 3.5 */
  const late = [];
  const pagesToCheck = [...statics, ...companies.map(co => co.path), params[0].replace(/:[A-Za-z]+/g, 'home-3a'), '/nope-for-home-3a'];
  const pg = await getAll(pagesToCheck);
  for (const path of pagesToCheck) {
    const r = pg.get(path);
    const at = Buffer.from(r?.body || '', 'utf8').indexOf('<div id="views"');
    if (at < 0 || at >= B.SERVED_VIEWS_BYTES) late.push(`${path} (${at < 0 ? 'none' : `byte ${at.toLocaleString('en')}`})`);
  }
  said.views = pagesToCheck.length;
  if (late.length) p.push(`<div id="views"> is not within the first 16kB of ${late.length} served page(s): ${late.slice(0, 6).join(', ')}${late.length > 6 ? ' …' : ''}`);
  const beforeH1 = pageText(home.slice(0, home.indexOf('<h1')));
  for (const w of ['My Dashboard', 'Saved Models']) if (beforeH1.includes(w)) p.push(`/: "${w}" in its text before the h1`);
  if (pageText(got.get('/about')?.body || '').includes('My workspace')) p.push('/about: its text holds "My workspace"');
  const allowed = [P.title, P.oneLiner, P.description, P.lede, P.kicker].filter(Boolean);
  const variants = [];
  for (const path of statics) {
    const body = got.get(path)?.body || '';
    const metas = [...body.matchAll(/<meta (?:name|property)="(?:description|og:description|twitter:description|og:title|twitter:title)" content="([^"]*)">/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    let text = `${pageText(body)} ${metas.join(' ')} ${(/<title>([^<]*)<\/title>/.exec(body) || [])[1] || ''}`;
    for (const a of allowed) text = text.split(a).join(' ');
    const m = /.{0,40}(decision workspace|market setups|evaluate property investments|Research · Monitor).{0,40}/i.exec(text);
    if (m) variants.push(`${path}: …${m[0].trim()}…`);
    const desc = /<p class="body foot-desc">([^<]*)<\/p>/.exec(body)?.[1];
    if (desc !== undefined && desc.replace(/&amp;/g, '&') !== P.oneLiner) variants.push(`${path}: the footer's line is "${desc}"`);
  }
  const hd = (k) => (new RegExp(`<meta (?:name|property)="${k}" content="([^"]*)">`).exec(home) || [])[1];
  if (![hd('description'), hd('og:description'), hd('twitter:description')].every(x => (x || '').replace(/&amp;/g, '&') === P.description)) variants.push(`/: its description, og:description and twitter:description are not POSITIONING's one description`);
  if (variants.length) p.push(`a positioning string served in another variant: ${variants.slice(0, 4).join(' · ')}${variants.length > 4 ? ` … and ${variants.length - 4} more` : ''}`);
  /* 3.6 */
  const budget = B.homeBudgets(home);
  budget.problems.forEach(x => p.push(`/ budgets: ${x}`));
  said.budget = budget.said;
  /* 3.8 */
  const visuals = cards.filter(c => all(c).some(n => n.tag === 'svg' && all(n).filter(x => attr(x, 'data-v') !== null).length >= 3) && all(c).some(n => has(n, 'pub-vis-src') && wordsIn(sight(n)).length));
  said.visuals = visuals.length;
  if (visuals.length < 2) p.push(`/: ${visuals.length} cards carry an <svg> of data marks with a source label, fewer than two`);
  let usj = null; try { usj = JSON.parse(got.get('/data/us.json')?.body || 'null'); } catch { usj = null; }
  const ser = usj && B.filedSeries(usj);
  const eq = cardOf('equities');
  if (!ser) p.push('/data/us.json: no Apple to compare the Equities columns with');
  else if (!eq) p.push('/: no Equities card');
  else {
    const marks = all(eq).filter(n => attr(n, 'data-fy') !== null);
    const bad = [];
    ser.years.forEach((fy, i) => {
      for (const [line, want] of [['rev', ser.rev[i]], ['ni', ser.ni[i]]]) {
        const m = marks.find(n => attr(n, 'data-fy') === String(fy) && attr(n, 'data-line') === line);
        if (!m || Number(attr(m, 'data-v')) !== want) bad.push(`FY${fy} ${line} ${m ? attr(m, 'data-v') : 'missing'} (filed ${want})`);
      }
    });
    if (marks.length !== ser.years.length * 2) bad.push(`${marks.length} columns for ${ser.years.length} years`);
    if (bad.length) p.push(`/: the Equities columns are not Apple's filed revenue and net income in the served data/us.json: ${bad.slice(0, 4).join('; ')}`);
    if (!/US\$/.test(sight(eq))) p.push('/: the Equities visual does not say US$');
    said.years = `${ser.years[0]}–${ser.years[ser.years.length - 1]}`;
  }
  const reads = /<html[^>]*data-served-reads="([^"]*)"/.exec(home)?.[1] || '';
  if (/baseCcy/.test(reads)) p.push(`/: its served reads name the base currency (${reads})`);
  const sc = cardOf('scanner');
  const scDigits = sc ? (sight(sc).match(/\d+/g) || []) : ['no card'];
  if (scDigits.some(d => d !== '50')) p.push(`/: the Scanner card carries digits other than the 50: ${scDigits.join(', ')}`);
  if (/\b(matched|approaching|watching)\b/i.test(sight(hm || { kids: [] }))) p.push('/: "matched", "approaching" or "watching" on the homepage');
  /* N8 */
  const pr = got.get('/pricing')?.body || '';
  const pm = mainOf(pr);
  const pmText = pm ? sight(pm) : '';
  const h1At = pmText.indexOf('Proposed plans — not on sale yet'), buyAt = pmText.indexOf('Nothing on this page can be bought.');
  const pcards = pm ? all(pm).filter(n => n.tag === 'article' && has(n, 'plan-concept')) : [];
  const firstCard = pcards[0] ? pmText.indexOf(sight(pcards[0]).slice(0, 12)) : -1;
  if (h1At < 0 || buyAt < 0 || (firstCard >= 0 && (h1At > firstCard || buyAt > firstCard))) p.push('/pricing: the h1 and "Nothing on this page can be bought." do not both come before the cards');
  if (!pmText.includes('No payment is processed anywhere in this build')) p.push('/pricing: "No payment is processed anywhere in this build" is gone');
  if (pcards.length !== 3) p.push(`/pricing: ${pcards.length} concept cards, not three`);
  for (const c of pcards) {
    const name = sight(all(c).find(n => n.tag === 'h3') || { kids: [] });
    const w = wordsIn(sight(c, n => n.tag === 'h3' || has(n, 'plan-concept-price'))).length;
    if (w > 20) p.push(`/pricing: the ${name} card is ${w} words besides its name and price, more than 20`);
    if (!/Not on sale|Nothing to buy/.test(sight(c))) p.push(`/pricing: the ${name} card says neither "Not on sale" nor "Nothing to buy"`);
    if (all(c).some(n => n.tag === 'a' || n.tag === 'button' || attr(n, 'data-inert') === 'button' || has(n, 'btn'))) p.push(`/pricing: the ${name} card holds a link or a button`);
  }
  const det = pm && all(pm).find(n => n.tag === 'details' && attr(n, 'id') === 'plan-compare');
  if (!det || attr(det, 'open') !== null || !/Compare details/.test(sight(det.kids.find(k => k.tag === 'summary') || { kids: [] }))) p.push('/pricing: no closed "Compare details"');
  if (pm && all(pm).some(n => has(n, 'btn-primary'))) p.push('/pricing: a btn-primary in main');
  const buttons = pm ? all(pm).filter(n => n.tag === 'button' || attr(n, 'data-inert') === 'button' || has(n, 'btn')) : [];
  if (buttons.some(b => !det || !all(det).includes(b))) p.push(`/pricing: ${buttons.filter(b => !det || !all(det).includes(b)).length} button(s) in main outside "Compare details"`);
  said.pricing = pm ? wordsIn(sight(pm)).length : null;
  if (said.pricing > 300) p.push(`/pricing: ${said.pricing} words in main outside the closed details, more than 300`);
  const cov = pageText(pr).split('It is not a complete listing of either market').length - 1;
  if (cov !== 1) p.push(`/pricing: the coverage line ${cov} times, not once`);
  const noSale = [];
  for (const path of statics) {
    const m = mainOf(got.get(path)?.body || '');
    if (!m) continue;
    for (const a of all(m).filter(n => n.tag === 'a' && attr(n, 'href') === '/pricing')) {
      let blk = a.parent; while (blk && !/^(p|li|section|article|div)$/.test(blk.tag)) blk = blk.parent;
      while (blk && blk.parent && blk.tag !== '#root' && wordsIn(sight(blk)).length < 6) blk = blk.parent;
      if (!/not on sale/i.test(blk ? sight(blk) : '')) noSale.push(`${path}: "${sight(a)}"`);
    }
  }
  if (noSale.length) p.push(`a link to /pricing with no "not on sale" beside it: ${noSale.join(', ')}`);
  /* N2a (D17) */
  const PROPERTY_NOTE = 'Computed from the figures you enter; the starting deal and the sample projects’ transactions are synthetic and labelled so, and fee lines not yet verified are marked as placeholders.';
  said.qual = [];
  for (const path of ['/', '/property', '/property/calculator', '/property/lab', '/how-it-works', '/about', '/status']) {
    const body = got.get(path)?.body || (await get(path)).body || '';
    const nodes = all(T(body));
    const badges = nodes.filter(n => has(n, 'status-live') && attr(n, 'title') === PROPERTY_NOTE && B.inSight(n));
    const quals = nodes.filter(n => has(n, 'pbadge-q') && sight(n) === 'Your figures, sample to start');
    const beside = badges.filter(b => { const i = b.parent.kids.indexOf(b); return has(b.parent, 'pbadge') && b.parent.kids.slice(i + 1).some(k => has(k, 'pbadge-q') && sight(k) === 'Your figures, sample to start'); });
    said.qual.push(`${path} ${badges.length}`);
    if (!badges.length) p.push(`${path}: serves no Property Live badge in sight`);
    if (beside.length !== badges.length || quals.length !== badges.length) p.push(`${path}: ${badges.length} Property Live badges, ${beside.length} with "Your figures, sample to start" in sight beside them, ${quals.length} qualifiers`);
  }
  judge(p, `the homepage cleanup as served: the strip a <details> on ${said.strips} pages, the warning and "No licensed prices" in its summary, Research mode and the links in its Details; the hero ${said.hero} words with one action; three cards, each 12 words or fewer, described by qualifier and note, the Property card to /property/lab, badges Beta · Beta · Live · Coming soon on /, /how-it-works and the footer; the example path ${said.path} words, 5 and 4 links served 200, no digit or name; #views within 16kB on ${said.views} pages; one variant of each positioning string; budgets ${JSON.stringify(said.budget)}; ${said.visuals} visuals, Apple's ${said.years} columns as filed; /pricing ${said.pricing} words outside "Compare details", three cards, no button outside it; Property's qualifier beside every Live badge (${said.qual.join(', ')})`,
    'the homepage cleanup (plan 3.1–3.6, 3.8, N8, N9, D17) is not served as accepted');
}
/* ---- end home-3a ---- */

/* ---- scanner-first-view ---- */
/* THE SCANNER'S FIRST VIEW AND ITS EXAMPLE, AS SERVED (the 5 Oct audit's
   N5a and N5b; the owner's decision D14c, constrained). /app/scanner with
   no files open, read as a fetch reads it (in sight: not .sr-only, not
   [hidden], not inside a closed <details> but its summary — build.mjs's
   sightText, the measure homeBudgets uses; a word is wordsIn's):
   N5a  "node scanner/scan.mjs" and every data/*.json name are served only
        inside the closed <details> "Run the worker on your own computer",
        which also holds the three commands and the eight file names — but
        for an Unavailable badge's own note (.tool-off: its title and its
        screen-reader words name the file it lacks, and the badge stays as
        it is); "No scan has been recorded on this machine" and "by design,
        not by fault" are in sight, and so are the four Unavailable badges;
   N5b  on /app/scanner and on /how-it-works#hiw-scanner, one <figure>:
        its caption "Example — generated series, not a market’s prices",
        the Illustrative badge linking /data-sources#kinds, an <svg> path of
        66 points (series A's closes, bars 1–66), the setup's three
        conditions in the engine's own words at bar 66 — scanEvaluate on
        scanFixture, from the engine in index.html — each Held or Not held,
        series B "Not held; RSI cannot be computed on a flat series.", and
        "Shows how a rule is evaluated — not whether it works, and nothing
        about any market."; inside it no date (YYYY-MM-DD), no "RM", "US$"
        or "$", no symbol of the instruments registry or of a filed company,
        none of "approaching", "watching", "signal", "buy" or "sell", and no
        state but Held, Not held and Unavailable — in its words and in its
        attributes;
        no "N match", "N matches" or "N matched" anywhere on either page;
        /app/scanner's <main> 300 words or fewer in sight (499 on 8763a283);
        /how-it-works no longer says "No example match is shown here".
   Each fails on 8763a283, which served no example and the commands, the
   file names and the run log's path in sight. */
{
  const B = await import('./build.mjs');
  const { loadEngine } = await import('./scanner/scan.mjs');
  const E = await loadEngine(join(ROOT, 'index.html'));
  const p = [], said = {};
  const all = B.allOf, has = B.hasClass, attr = B.attrOf, sight = B.sightText;
  const rawText = (n) => { let o = ''; const w = (x) => { for (const k of x.kids || []) { if (k.tag === '#text') o += k.text; else { o += ' '; w(k); } } }; w(n); return decode(o).replace(/\s+/g, ' ').trim(); };
  const attrsText = (n) => [n, ...all(n)].map(x => [...String(x.raw || '').matchAll(/\s[\w:-]+="([^"]*)"/g)].map(m => decode(m[1])).join(' ')).join(' ');
  const apos = (s) => String(s).replace(/[’‘]/g, "'");
  /* What the engine says at bar 66 of series A and of series B. */
  const fx = E.scanFixture(), setup = E.scanNormaliseSetup(fx.setup), C = E.scanCache();
  const barsOf = (sym) => E.scanBars(fx.history, sym, { timeframe: '1D', now: fx.now, calendar: E.scanCalendar(fx.history, [], null) });
  const A = barsOf('MATCH'), Bb = barsOf('FLAT');
  const rA = E.scanEvaluate(setup.ruleTree, A, { cache: C }), rB = E.scanEvaluate(setup.ruleTree, Bb, { cache: C });
  const WORD = { MET: 'Held', NOT_MET: 'Not held', UNAVAILABLE: 'Unavailable' };
  /* The registry's symbols and aliases, and every filed company's. */
  const reg = JSON.parse(read('data/instruments.json')).instruments || [];
  const us = JSON.parse(read('data/us.json')).results || [];
  const SYMBOLS = [...new Set([...reg.flatMap(e => [e.symbol, ...(e.aliases || [])]), ...us.map(c => c.id)].filter(Boolean).map(String))];
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const symbolIn = (t) => SYMBOLS.find(s => new RegExp(`(?<![\\w!:/=])${reEsc(s)}(?![\\w!])`).test(t)) || null;
  const got = await getAll(['/app/scanner', '/how-it-works']);
  const figureProblems = (path, root) => {
    const figs = all(root).filter(n => n.tag === 'figure' && has(n, 'scan-ex'));
    if (figs.length !== 1) { p.push(`${path}: ${figs.length} example figures (figure.scan-ex), not one`); return; }
    const f = figs[0];
    if (!B.inSight(f)) p.push(`${path}: the example figure is not in sight`);
    const cap = all(f).find(n => n.tag === 'figcaption');
    const capT = cap ? apos(rawText(cap)) : '';
    if (!capT.includes("Example — generated series, not a market's prices")) p.push(`${path}: the figure's caption is "${capT.slice(0, 90)}", not "Example — generated series, not a market’s prices"`);
    const badge = all(f).find(n => n.tag === 'a' && has(n, 'kind-badge') && has(n, 'kind-illustrative'));
    if (!badge || attr(badge, 'href') !== '/data-sources#kinds' || rawText(badge) !== 'Illustrative') p.push(`${path}: the figure carries no Illustrative badge linking /data-sources#kinds`);
    const svg = all(f).find(n => n.tag === 'svg');
    const close = svg && all(svg).find(n => n.tag === 'path' && has(n, 'scan-ex-close'));
    const pts = close ? (attr(close, 'd') || '').match(/[ML]\s*-?[\d.]+[ ,]-?[\d.]+/g)?.length || 0 : 0;
    said[`${path} points`] = pts;
    if (pts !== 66) p.push(`${path}: the figure's svg path of series A's closes has ${pts} points, not 66`);
    const lis = all(f).filter(n => n.tag === 'li' && has(n, 'scan-ex-c'));
    if (lis.length !== rA.conditions.length) p.push(`${path}: ${lis.length} condition lines, not the setup's ${rA.conditions.length}`);
    lis.forEach((li, i) => {
      const c = rA.conditions[i];
      const text = rawText(all(li).find(n => has(n, 'scan-ex-x')) || { kids: [] });
      const state = rawText(all(li).find(n => has(n, 'scan-ex-s')) || { kids: [] });
      if (!c || text !== c.text) p.push(`${path}: condition ${i + 1} reads "${text}", where the engine says "${c?.text}"`);
      if (!c || state !== WORD[c.state] || attr(li, 'data-state') !== c.state) p.push(`${path}: condition ${i + 1} is marked "${state}" (${attr(li, 'data-state')}), where the engine says ${c?.state}`);
      if (!['Held', 'Not held'].includes(state)) p.push(`${path}: condition ${i + 1} at bar 66 is "${state}", not Held or Not held`);
    });
    const verdict = all(f).find(n => has(n, 'scan-ex-v'));
    if (!verdict || rawText(verdict) !== WORD[rA.state] || attr(verdict, 'data-state') !== rA.state) p.push(`${path}: the verdict at bar 66 reads "${verdict ? rawText(verdict) : ''}", where the engine says ${rA.state}`);
    const bLine = all(f).find(n => has(n, 'scan-ex-b'));
    const bT = bLine ? rawText(bLine) : '';
    const rsiB = rB.conditions.find(c => c.leftLabel === 'RSI14' || /^RSI/.test(c.text));
    if (!bT.includes('Not held; RSI cannot be computed on a flat series.') || rB.state !== 'NOT_MET' || rsiB?.state !== 'UNAVAILABLE') p.push(`${path}: series B reads "${bT}" (the engine: ${rB.state}, RSI ${rsiB?.state})`);
    const note = all(f).find(n => has(n, 'scan-ex-note'));
    if (!note || rawText(note) !== 'Shows how a rule is evaluated — not whether it works, and nothing about any market.') p.push(`${path}: the figure does not say "Shows how a rule is evaluated — not whether it works, and nothing about any market."`);
    /* Nothing inside it that a market's page would carry. */
    const inside = `${rawText(f)} ${attrsText(f)}`;
    const date = inside.match(/[0-9]{4}-[0-9]{2}-[0-9]{2}/);
    if (date) p.push(`${path}: a date inside the figure (${date[0]})`);
    const money = inside.match(/\bRM\b|US\$|\$/);
    if (money) p.push(`${path}: "${money[0]}" inside the figure`);
    const sym = symbolIn(inside);
    if (sym) p.push(`${path}: the symbol ${sym} inside the figure`);
    const banned = inside.match(/\b(approaching|watching|signal|buy|sell)\b/i);
    if (banned) p.push(`${path}: "${banned[0]}" inside the figure`);
    const states = all(f).filter(n => attr(n, 'data-state') !== null);
    for (const s of states) {
      if (!['MET', 'NOT_MET', 'UNAVAILABLE'].includes(attr(s, 'data-state'))) p.push(`${path}: a state "${attr(s, 'data-state')}" inside the figure`);
      const w = rawText(s.tag === 'li' ? (all(s).find(n => has(n, 'scan-ex-s')) || s) : s);
      if (!['Held', 'Not held', 'Unavailable'].includes(w)) p.push(`${path}: a state reads "${w}" inside the figure`);
    }
    said[`${path} states`] = states.length;
  };
  for (const [path, r] of got) {
    if (r.status !== 200) { p.push(`${path}: ${described(r)}`); continue; }
    const counts = r.body.match(/[0-9]+ (match|matches|matched)\b/gi);
    if (counts) p.push(`${path}: "${counts[0]}" on the page`);
  }
  /* /app/scanner. */
  const sc = got.get('/app/scanner');
  if (sc?.status === 200) {
    const main = all(B.htmlTree(sc.body)).find(n => n.tag === 'main');
    if (!main) p.push('/app/scanner: no <main>');
    else {
      figureProblems('/app/scanner', main);
      const run = all(main).filter(n => n.tag === 'details' && attr(n, 'open') === null && sight(n.kids.find(k => k.tag === 'summary') || { kids: [] }) === 'Run the worker on your own computer');
      if (run.length !== 1) p.push(`/app/scanner: ${run.length} closed <details> "Run the worker on your own computer", not one`);
      const fold = run[0] ? rawText(run[0]) : '';
      for (const want of ['How the scan runs', 'node scanner/scan.mjs', 'node ingest/daily.mjs', 'node scanner/scan.mjs --status',
        'scan-runs, scan-alerts, scan-setups, price-history, price-adjustments, scan-control, scan-deliveries, ingest-runs'])
        if (!fold.includes(want)) p.push(`/app/scanner: the closed <details> does not hold "${want}"`);
      /* Every run of words that names a command or a data file: inside the
         <details>, or an Unavailable badge's own note. */
      const texts = [];
      const walk = (n, inRun, inBadge) => { for (const k of n.kids || []) { if (k.tag === '#text') texts.push({ t: decode(k.text), inRun, inBadge }); else walk(k, inRun || run.includes(k), inBadge || has(k, 'tool-off')); } };
      walk(main, false, false);
      const loose = texts.filter(x => !x.inRun && !x.inBadge && /node scanner\/scan\.mjs|data\/[\w.-]+\.json/.test(x.t));
      said.loose = loose.length;
      loose.slice(0, 4).forEach(x => p.push(`/app/scanner: outside the closed <details>: "${x.t.trim().slice(0, 100)}"`));
      const seen = sight(main);
      for (const want of ['No scan has been recorded on this machine', 'by design, not by fault']) if (!seen.includes(want)) p.push(`/app/scanner: "${want}" is not in sight`);
      const unav = all(main).filter(n => has(n, 'status-badge') && has(n, 'status-unavailable') && B.inSight(n) && rawText(n) === 'Unavailable');
      said.unavailable = unav.length;
      if (unav.length < 4) p.push(`/app/scanner: ${unav.length} Unavailable badges in sight, not the four`);
      said.words = B.wordsIn(seen).length;
      if (said.words > 300) p.push(`/app/scanner: ${said.words} words in sight in <main>, more than 300`);
    }
  }
  /* /how-it-works#hiw-scanner. */
  const hw = got.get('/how-it-works');
  if (hw?.status === 200) {
    const sec = all(B.htmlTree(hw.body)).find(n => attr(n, 'id') === 'hiw-scanner');
    if (!sec) p.push('/how-it-works: no #hiw-scanner');
    else figureProblems('/how-it-works#hiw-scanner', sec);
    if (/No example match is shown here/.test(hw.body)) p.push('/how-it-works: still says "No example match is shown here"');
  }
  judge(p, `the Scanner's first view (N5a, N5b, D14c): /app/scanner ${said.words} words in sight (≤300), the commands and the data files only in the closed "Run the worker on your own computer" or an Unavailable badge's note, "No scan has been recorded" and "by design, not by fault" in sight with ${said.unavailable} Unavailable badges; one example figure there and on /how-it-works#hiw-scanner — "Example — generated series, not a market’s prices", Illustrative to /data-sources#kinds, ${said['/app/scanner points']} points, the engine's three conditions at bar 66 word for word, series B Not held for RSI on a flat series, the caption — with no date, currency, registry symbol, banned word or other state in it; no "N match" on either page`,
    'the Scanner\'s first view and its example (N5a, N5b) are not served as accepted');
}
/* ---- end scanner-first-view ---- */

/* ---- d12-workspace ---- */
/* MY DASHBOARD AS A WORKSPACE, AS SERVED (the owner's decision D12, 8 Oct
   2026; 40-views-discover.js). The served /app is a fresh visitor's page —
   a first visit — read as a fetch reads it (in sight: build.mjs's
   sightText):
   - every step (li.dash-step) carries its schematic picture, an <svg>
     with no <text> in it, and the property step opens Property's landing,
     the Scenario Lab: a link to /property;
   - the workspace's five parts are listed — Recently opened, Saved
     properties, Watchlists, Scanner setups, Your alerts — each with what it
     holds, which is nothing yet ("None yet", "None of your own yet");
   - no count: not one digit is in sight in #views (no "0 of 4 done", no
     "0" read as a figure of the reader's), and no "Tool snapshot";
   - the alerts' line says the samples are not counted.
   Each fails on 877e5eb4, which served the steps with no picture, the
   property step to /property/calculator, "0 of 4 done" and no list of the
   workspace's parts. */
{
  const B = await import('./build.mjs');
  const all = B.allOf, has = B.hasClass, attr = B.attrOf, sight = B.sightText;
  const p = [], said = {};
  const r = await get('/app');
  if (r.status !== 200) p.push(`/app: ${described(r)}`);
  else {
    const views = all(B.htmlTree(r.body)).find(n => attr(n, 'id') === 'views');
    if (!views) p.push('/app: serves no #views');
    else {
      const steps = all(views).filter(n => n.tag === 'li' && has(n, 'dash-step'));
      said.steps = steps.length;
      if (steps.length < 4) p.push(`/app: ${steps.length} steps served, not four`);
      steps.forEach((li, i) => {
        const svg = all(li).filter(n => n.tag === 'svg');
        if (!svg.length) p.push(`/app: step ${i + 1} ("${sight(li).slice(0, 40)}") carries no <svg> picture`);
        if (all(li).some(n => n.tag === 'text')) p.push(`/app: step ${i + 1}'s picture has words in it`);
      });
      said.pics = steps.filter(li => all(li).some(n => n.tag === 'svg')).length;
      const prop = all(views).filter(n => n.tag === 'a' && attr(n, 'href') === '/property');
      if (!prop.length) p.push('/app: no link to /property (the property step opens the Scenario Lab)');
      const propStep = steps.find(li => attr(li, 'data-step') === 'property');
      if (propStep && !all(propStep).some(n => n.tag === 'a' && attr(n, 'href') === '/property')) p.push('/app: the property step does not open /property');
      const WANT = { recent: 'Recently opened', properties: 'Saved properties', watchlists: 'Watchlists', setups: 'Scanner setups', alerts: 'Your alerts' };
      for (const [k, name] of Object.entries(WANT)) {
        const li = all(views).find(n => n.tag === 'li' && attr(n, 'data-sec') === k);
        const text = li ? sight(li) : '';
        if (!li) p.push(`/app: the workspace's "${name}" is not listed`);
        else if (!text.includes(name) || !/\bNone (of your own )?yet\b/.test(text)) p.push(`/app: "${name}" reads "${text.slice(0, 90)}", not "None yet"`);
      }
      const seen = sight(views);
      const digits = seen.match(/[^\s]*\d[^\s]*/g) || [];
      said.digits = digits.length;
      if (digits.length) p.push(`/app: a count or figure is served in sight: ${digits.slice(0, 6).map(x => `"${x}"`).join(', ')}`);
      if (/Tool snapshot/i.test(seen)) p.push('/app: "Tool snapshot" is served');
      if (!/Sample alerts are not counted/.test(seen)) p.push('/app: the alerts\' line does not say the sample alerts are not counted');
    }
  }
  judge(p, `/app served as a first visit (D12): ${said.pics} of ${said.steps} steps with a schematic <svg> and no words in it, the property step to /property (the Scenario Lab); Recently opened, Saved properties, Watchlists, Scanner setups and Your alerts listed, each "None yet"; no digit in sight (${said.digits}), no "Tool snapshot", and the sample alerts said not counted`,
    '/app is not served as D12\'s first visit');
}
/* ---- end d12-workspace ---- */

/* ---- n7-research-front ---- */
/* RESEARCH'S FRONT PAGE, AS SERVED (the 5 Oct addendum's N7; the owner's
   D20). /research read as a fetch reads it, by build.mjs's researchFront —
   the measure build --check holds the committed render to — with the
   served data/us.json and the company pages' addresses:
   - the search is the first form control in <main>, with 40 words or fewer
     in sight before it (144 on a4a8d0b4, a Start here panel's "Hide" the
     first control);
   - the Apple, JPMorgan Chase and Realty Income examples are links to
     their filed company pages, each an <svg> of 10 data marks or more, each
     mark that year's revenue or net income in the served data/us.json (a
     year it does not hold drawn as a gap), and "Filed · SEC 10-K · US$" in
     sight; no example links an illustrative company;
   - under "More ways in", the six lenses, the Trading Index ("Scanner
     tool") and the Cash Wheel are <a href>s, Banks and REITs badged
     Illustrative — and every one of those addresses is served 200;
   - data-served-reads names no baseCcy; the coverage line once; the page in
     N7's order; Recently viewed and saved cases each one line of nothing
     yet, no sample shown as the reader's.
   Each fails on a4a8d0b4 but the base currency, which /research never
   read. */
{
  const B = await import('./build.mjs');
  const p = [];
  const r = await get('/research');
  let said = {};
  if (r.status !== 200) p.push(`/research: ${described(r)}`);
  else {
    let usFile = null;
    try { usFile = JSON.parse((await get('/data/us.json')).body); } catch { usFile = null; }
    if (!usFile) p.push('/data/us.json: not served as JSON, so the examples cannot be held to it');
    const { companies } = companyPlan(ORIGIN, router);
    const res = B.researchFront(r.body, { usFile, companies });
    said = res.said;
    res.problems.forEach(x => p.push(`/research: ${x}`));
    const main = B.allOf(B.htmlTree(r.body)).find(n => n.tag === 'main');
    const hrefs = main ? [...new Set(B.allOf(main).filter(n => n.tag === 'a' && (B.hasClass(n, 'rf-ex') || B.hasClass(n, 'rf-way'))).map(n => B.attrOf(n, 'href')))] : [];
    const st = await getAll(hrefs);
    for (const h of hrefs) if (st.get(h)?.status !== 200) p.push(`/research links ${h}, served ${described(st.get(h))}`);
    said.links = hrefs.length;
  }
  judge(p, `/research served as N7 orders it: the search its first form control after ${said.wordsBeforeSearch} words (40 or fewer); the three filed examples, each a link to its filer's page with columns of its filed revenue and net income as data/us.json holds them (${(said.marks || []).join(', ')} marks) and "Filed · SEC 10-K · US$"; More ways in ${said.ways} links, the six lenses, the Trading Index and the Cash Wheel among them, Bursa Malaysia, Banks, REITs and Dividend research Illustrative; ${said.links} addresses served 200; no baseCcy among its reads (${said.reads}); the coverage line ${said.coverage} time; ${said.empty} one-line empty states`,
    '/research is not served as N7 accepts it');
}
/* ---- end n7-research-front ---- */

/* ---- deep-links ---- */
/* DEEP LINKS, AS SERVED (the 9 Oct 2026 audit, item #7; the owner's track
   B). A fetch of /company/AAPL-SEC, /my/alerts or /my/reports returned the
   app's shell and nothing of the page — no h1, no line saying what it
   holds — on production. Held here, before any script:
   - every SEC filer's id (/company/AAPL-SEC, in upper, lower and mixed
     case) is a 308 to the company's own pre-rendered page, and nothing
     else is: an illustrative company's address, an id no company has, a
     longer address and the report are the router's (the generic page), as
     before; the query rides along — /company/AAPL-SEC?tab=financials
     arrives at /company/aapl-apple-inc?tab=financials, which is served the
     company's own page with its h1;
   - each filer's own page previews as the company: its title names it, and
     its description, og: and twitter: tags name it, its ticker, the SEC,
     the fiscal years its statements span as data/us.json holds them and
     its CIK — and no price;
   - every My Workspace address (/my/…, and the aliases of its pages) is
     served its page as a fresh visitor's: #views marked data-served, its
     own h1, a lede saying what the page holds, what its render read on
     <html> (so the head's script can keep it from a reader holding their
     own), "None yet" where nothing is the reader's — no "0 of 1", "— 0" or
     "0/3" — and every sample under the banner that says it is one; and
     robots.txt still disallows each, and the sitemap names none.
   Each fails on 09e9083e, which served every one of those addresses the
   generic page or a page with an empty #views. */
{
  const B = await import('./build.mjs');
  const all = B.allOf, attr = B.attrOf, has = B.hasClass, sight = B.sightText;
  const p = [], said = { redirects: 0, previews: 0, kept: [], my: 0, samples: 0 };
  const { companies } = companyPlan(ORIGIN, router);
  const filers = companies.filter(co => co.company.real);
  const US_FILE = JSON.parse(read('data/us.json'));
  const US = new Map((US_FILE.results || []).map(r => [`${r.id}-SEC`, r]));
  const GENERIC_PAGE = read(GENERIC);
  const locOf = (r) => { const l = r.headers.get('location'); try { return l ? new URL(l, BASE) : null; } catch { return null; } };
  /* 1. Each filer's id, in three cases, a 308 to its own page. */
  const forms = (id) => [...new Set([id, id.toLowerCase(), id[0] + id.slice(1).toLowerCase()])];
  const asked = filers.flatMap(co => forms(co.id).map(f => [co, `/company/${f}`]));
  const got = await getAll(asked.map(([, path]) => path), 12);
  for (const [co, path] of asked) {
    const r = got.get(path), to = locOf(r);
    if (r.status !== 308 || !to || to.pathname !== co.path || to.search) p.push(`${path}: ${described(r)}${to ? ` to ${to.pathname}${to.search}` : ''}, not a 308 to ${co.path}`);
    else said.redirects++;
  }
  const ids = (VERCEL.redirects || []).filter(x => /^\/company\//.test(x.source));
  const byDest = new Map(filers.map(co => [co.path, co]));
  if (ids.length !== filers.length || ids.some(x => !byDest.has(x.destination) || x.permanent !== true))
    p.push(`vercel.json carries ${ids.length} company redirects, where each of the ${filers.length} filers has one permanent redirect to its own page`);
  /* 2. The query kept, and the page it arrives at. */
  for (const [from, want] of [['/company/AAPL-SEC?tab=financials', '/company/aapl-apple-inc?tab=financials'],
    ['/company/msft-sec?tab=valuation&utm_source=served-check', '/company/msft-microsoft-corp?tab=valuation&utm_source=served-check']]) {
    const r = await get(from), to = locOf(r);
    if (r.status !== 308 || !to || to.pathname + to.search !== want) { p.push(`${from}: ${described(r)}${to ? ` to ${to.pathname}${to.search}` : ''}, not a 308 to ${want}, the query kept`); continue; }
    const page = await get(want);
    const co = filers.find(x => x.path === to.pathname);
    const views = page.status === 200 ? all(B.htmlTree(page.body)).find(n => attr(n, 'id') === 'views') : null;
    const h1 = views ? all(views).find(n => n.tag === 'h1') : null;
    if (page.status !== 200) p.push(`${want}: ${described(page)}`);
    else if (!views || attr(views, 'data-served') !== to.pathname || !h1 || sight(h1) !== US.get(co?.id)?.name)
      p.push(`${want}: not served its company's own page (#views ${views ? `marked ${attr(views, 'data-served')}` : 'missing'}, h1 ${JSON.stringify(h1 ? sight(h1) : null)})`);
    else said.kept.push(`${from} → ${want}`);
  }
  /* 3. Nothing else redirected. */
  for (const path of ['/company/MAYBANK', '/company/maybank', '/company/1155', '/company/ZZZZ-SEC', '/company/aapl-sec-x', '/company/AAPL-SEC/report', '/app/equities/AAPL-SEC']) {
    const r = await get(path);
    if (r.status !== 200 || r.body !== GENERIC_PAGE) p.push(`${path}: ${described(r)}${locOf(r) ? ` to ${locOf(r).pathname}` : ''}, not the generic page, 200 — the router's address`);
  }
  /* 4. Each filer's page previews as the company. */
  const own = await getAll(filers.map(co => co.path), 12);
  for (const co of filers) {
    const f = US.get(co.id), r = own.get(co.path);
    if (!f || r.status !== 200) { p.push(`${co.path}: ${f ? described(r) : `${co.id} is not in data/us.json`}`); continue; }
    const h = headOf(r.body);
    const ys = f.years.filter(Number.isInteger);
    const span = Math.min(...ys) === Math.max(...ys) ? `FY${ys[0]}` : `FY${Math.min(...ys)}–FY${Math.max(...ys)}`;
    const bad = [];
    if (!h.title || !h.title.includes(f.name)) bad.push(`title ${JSON.stringify(h.title)}`);
    if (!h.description || !h.description.startsWith(`${f.name} (`) || !h.description.includes(`filed with the SEC, ${span} (CIK ${Number(f.cik)})`)) bad.push(`description ${JSON.stringify(h.description)}`);
    if (h.ogTitle !== h.title || h.twitterTitle !== h.title || h.ogDescription !== h.description || h.twitterDescription !== h.description) bad.push('og:/twitter: tags that are not the title and the description');
    if (/(US\$|\$|RM)\s?\d/.test(`${h.title} ${h.description}`)) bad.push('a price in the title or the description');
    if (bad.length) p.push(`${co.path}: ${bad.join('; ')}`); else said.previews++;
  }
  /* 5. My Workspace's addresses. */
  const robots = (await get('/robots.txt')).body;
  const sitemap = (await get('/sitemap.xml')).body;
  const mine = statics.filter(path => myWorkspace({ path, head: router.headAt(path) }));
  const SAMPLE_BANNER = /Sample data These holdings, investment cases, watchlists and price alerts were written into this browser .* They are not yours/;
  const NONE = { '/my/reports': /No reports yet/, '/my/watchlists': /None of your own yet/, '/my/alerts': /Price alerts — none of your own yet/, '/my/data': /Saved work — none yet/ };
  const pages = await getAll(mine);
  for (const path of mine) {
    const r = pages.get(path);
    if (r.status !== 200) { p.push(`${path}: ${described(r)}`); continue; }
    const tree = B.htmlTree(r.body);
    const views = all(tree).find(n => attr(n, 'id') === 'views');
    const html = all(tree).find(n => n.tag === 'html');
    const h1 = views ? all(views).find(n => n.tag === 'h1') : null;
    const lede = views ? all(views).find(n => n.tag === 'p' && has(n, 'page-lede')) : null;
    const text = views ? sight(views) : '';
    const bad = [];
    if (!views || attr(views, 'data-served') === null) bad.push('#views is not a served page');
    if (!h1 || !sight(h1)) bad.push('no h1');
    if (!lede || sight(lede).split(/\s+/).length < 5) bad.push('no lede saying what the page holds');
    if (!html || !attr(html, 'data-served-reads')) bad.push('<html> does not say what its render read, so the head\'s script could not keep it from a reader holding their own');
    const nought = text.match(/(^|\s)0 of \d|— 0(\s|$)|(^|\s)0\/\d/);
    if (nought) bad.push(`a nought of the reader's own in sight: …${text.slice(Math.max(0, nought.index - 30), nought.index + 40)}…`);
    if (NONE[path] && !NONE[path].test(text)) bad.push(`not "${NONE[path].source}"`);
    if (/\bsample\b/i.test(text)) {
      if (!SAMPLE_BANNER.test(text)) bad.push('samples in sight with no banner saying they are not the reader\'s');
      else said.samples++;
    }
    if (B.robotsAllows(robots, path).allowed) bad.push('robots.txt allows it');
    if (sitemap.includes(`${ORIGIN}${path}<`)) bad.push('sitemap.xml lists it');
    if (bad.length) p.push(`${path}: ${bad.join('; ')}`); else said.my++;
  }
  judge(p, `deep links (audit #7): ${said.redirects} filer ids (${filers.length} filers in three cases) are each a 308 to the company's own page, one permanent redirect each in vercel.json, and illustrative, unknown, longer and report addresses are not; ${said.kept.join(' and ')}, the query kept, each its company's page with its h1; ${said.previews} filers' pages preview with the company's name, the SEC, its fiscal years and CIK and no price; ${said.my} of ${mine.length} My Workspace addresses served their page as a fresh visitor's — h1, lede, its reads on <html>, "None yet" and no nought of the reader's, ${said.samples} with samples under the sample banner — and kept out of crawlers and the sitemap`,
    'a deep link is not served its page');
}
/* ---- end deep-links ---- */

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
