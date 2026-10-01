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
 *   without it, query kept; the site root's /index.html is the file.
 * - data/*.json and index.html still serve; a missing data file is a 404,
 *   not an HTML page answering 200.
 * - Every page carries the headers vercel.json gives its address, the CSP
 *   among them, and that CSP names the hash of the script it was served with.
 * - Every sitemap address is served its own page and names itself canonical.
 *
 * serve.mjs answers from the same vercel.json by the same rules, so this runs
 * in CI against it; run with --url after a deploy it says whether Vercel does
 * what serve.mjs says it does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientRouter, companyPlan, siteOrigin, appFiles, linked, PAGE_LIMIT } from './build.mjs';

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
/* The page less the tags a route may change: what must be index.html's. */
const skeleton = (html) => {
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
const INDEX_SKELETON = skeleton(INDEX);
const PAGE_SKELETON = skeleton(linked(INDEX, APP));
judge(indexFile.status === 200 && indexFile.body === INDEX ? [] : [`/index.html: ${described(indexFile)}, ${indexFile.body === INDEX ? 'this checkout\'s file' : 'NOT this checkout\'s index.html (a deploy not landed, or another build)'}`],
  '/index.html is served, and it is this checkout\'s index.html', '/index.html is not served as this checkout\'s file');

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
    if (skeleton(r.body) !== (path === '/' ? INDEX_SKELETON : PAGE_SKELETON)) p.push(`${path}: differs from index.html outside the route's own tags${path === '/' ? '' : ' and the two app files it loads'}`);
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
  for (const path of paths) {
    const r = got.get(path);
    if (r.status !== 200) { p.push(`${path}: ${described(r)}`); continue; }
    if (r.body !== root.body) p.push(`${path}: not the generic page (index.html)`);
    p.push(...headerProblems(r));
  }
  if (root.status !== 200 || root.body !== indexFile.body) p.push(`/: ${described(root)}, ${root.body === indexFile.body ? 'index.html' : 'not index.html'}`);
  judge(p, `every parameter route (${params.length}), a dotted company id and / are served the generic page, 200, with the headers`,
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
    ['/app/scanner/setups/index.html', '/app/scanner/setups']];
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
  judge(p, `every sitemap address (${locs.length}) is served 200 with itself as its canonical`, 'a sitemap address is not served as its own canonical');
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
  const pages = await getAll([...statics.filter(s => s !== '/'), '/nope-xyz', '/deep/unknown/path/for-served-check', '/wp-login.php', '/.env']);
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
    const inline = inlineScripts(r.body).length + (r.body.match(/<style[\s>]/g) || []).length;
    if (inline) p.push(`${path}: carries ${inline} inline <script> or <style>, which only index.html may`);
    const srcs = scriptSrcs(r.body), css = stylesheets(r.body);
    if (srcs.length !== 1 || srcs[0] !== `/${APP.script.file}`) p.push(`${path}: loads the scripts ${JSON.stringify(srcs)}, not /${APP.script.file} alone`);
    if (css.length !== 1 || css[0] !== `/${APP.styles.file}`) p.push(`${path}: loads the stylesheets ${JSON.stringify(css)}, not /${APP.styles.file} alone`);
    if (PROBES.includes(path) && r.status !== 404) p.push(`${path}: ${described(r)}, not 404 or a platform block`);
  }
  /* index.html is the app whole, as every tool that reads it expects. */
  const index = (await getAll(['/index.html'])).get('/index.html');
  if (scriptSrcs(index.body).length || stylesheets(index.body).length || inlineScripts(index.body).length !== 1 || inlineScripts(index.body)[0] !== APP.script.body)
    p.push(`/index.html: does not carry the app inline and alone (${inlineScripts(index.body).length} inline, loads ${JSON.stringify([...scriptSrcs(index.body), ...stylesheets(index.body)])})`);
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
      - the build does not stamp it: no version in the app's DATA_VERSIONS,
        so `node build.mjs --check` passes whatever the workflow commits;
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
      ogDescription: h.description, twitterTitle: h.title, twitterDescription: h.description, robots: null };
    const have = headOf(r.body);
    for (const k of Object.keys(want)) if (have[k] !== want[k]) p.push(`${co.path}: ${k} is ${JSON.stringify(have[k])}, not ${JSON.stringify(want[k])}`);
    if (skeleton(r.body) !== PAGE_SKELETON) p.push(`${co.path}: differs from index.html outside its own head and the two app files it loads`);
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
  const OTHER = ['/company/aapl', '/company/AAPL-SEC', '/company/CIK0000320193', '/company/aapl-apple', '/company/AAPL-apple-inc', '/company/aapl-apple-inc-extra',
    '/company/1155', '/company/maybank', '/company/1155.KL', '/company/1155-malayan-banking-berhad', '/company/aapl-apple-inc/report', '/company/1155-malayan-banking/report',
    '/app/equities/aapl', '/app/equities/aapl-apple-inc', '/app/equities/1155/financials', '/app/equities/brk-b-berkshire-hathaway/report', '/company/no-such-company-for-served-check'];
  const QUERY = [['/company/aapl-apple-inc?tab=valuation', '/company/aapl-apple-inc'], ['/company/1155-malayan-banking?tab=financials&real=0', '/company/1155-malayan-banking']];
  const more = await getAll([...OTHER, ...QUERY.flat()]);
  for (const path of OTHER) {
    const r = more.get(path);
    if (r.status !== 200) { p.push(`${path}: ${described(r)}, not the generic page with 200`); continue; }
    if (r.body !== root.body) p.push(`${path}: not the generic page (index.html), but one titled "${headOf(r.body).title}"`);
    p.push(...headerProblems(r));
  }
  for (const [a, b] of QUERY) if (more.get(a).status !== 200 || more.get(a).body !== more.get(b).body) p.push(`${a}: ${described(more.get(a))}, not the page ${b} is served`);

  judge(p, `every company in the universe (${companies.length}: ${filers.length} filed with the SEC, ${companies.length - filers.length} illustrative) is served 200 at its own address with its own title, description, canonical, og: and twitter: tags — each description naming the company, its ticker, where it is listed and, as data/us.json has it, whether its figures are filed with the SEC or illustrative — is index.html in every other byte but the two app files, carries the headers and weighs at most ${(largest[1] / 1024).toFixed(1)}kB (${(total / 1048576).toFixed(2)}MB in all); each has one exact rewrite before /company/:id; ${OTHER.length} other forms of a company address, reports and an unknown company are the generic page, and a query string changes nothing`,
    'a company\'s own address is not served its own head, or another form of it is not the generic page');
}
/* ---- end releaseB: D ---- */

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
