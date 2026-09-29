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
 *   those tags the page is index.html byte for byte, so the one CSP hash in
 *   vercel.json covers its script. A query string changes nothing.
 * - A parameter route (/company/:id …) is served the generic page, 200.
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
import { clientRouter, siteOrigin } from './build.mjs';

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
const inlineHash = (html) => 'sha256-' + createHash('sha256')
  .update(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')), 'utf8').digest('base64');

/* The headers vercel.json gives this address, each present with its value,
   and a CSP that names the hash of the script this very response carries. */
function headerProblems(res, { html = true } = {}) {
  const p = [];
  for (const [k, v] of Object.entries(expectHeaders(res.path.split('?')[0]))) {
    const got = res.headers.get(k);
    if (got !== v) p.push(`${res.path}: ${k} is ${got === null ? 'absent' : JSON.stringify(got.slice(0, 80))}${got === null ? '' : `, not ${JSON.stringify(v.slice(0, 80))}`}`);
  }
  if (html) {
    const csp = res.headers.get('content-security-policy') || '';
    if (!csp.includes(`'${inlineHash(res.body)}'`)) p.push(`${res.path}: the Content-Security-Policy does not name the hash of the script this page carries`);
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
const INDEX_SKELETON = skeleton(INDEX);
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
    if (skeleton(r.body) !== INDEX_SKELETON) p.push(`${path}: differs from index.html outside the route's own tags`);
    p.push(...headerProblems(r));
  }
  judge(p, `every route without a parameter (${statics.length}) is served 200 with its own title, description, canonical, og: and twitter: tags, is index.html in every other byte, and carries vercel.json's headers with a CSP naming its script`,
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
      to the company's own segment, and the app's file name. */
{
  const SAMPLE = { id: 'aapl-apple-inc', tab: 'financials', setup: 'no-such-setup', alert: 'a00000000' };
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
    if (skeleton(r.body) !== INDEX_SKELETON) p.push(`${path}: not the app — it differs from index.html outside the head's own tags`);
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
