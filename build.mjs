#!/usr/bin/env node
/**
 * Assembles index.html from src/. The shipped artefact is still exactly one
 * self-contained file — that has not changed, and must not.
 *
 *   node build.mjs            write index.html, 404.html, pages/ and vercel.json
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
 *   404.html            the shell with the not-found head and noindex. Vercel
 *                       serves it with status 404 for any address nothing
 *                       else answers, and the app draws its not-found card.
 *   vercel.json         one rewrite per route, generated from ROUTES in place
 *                       of the catch-all: a static route to its page, a
 *                       parameter route (/company/:id …) to index.html.
 *
 * Parameter routes keep the generic page: which company an :id names is the
 * router's to resolve, after the filings load.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(ROOT, 'src', ...p);
const OUT = join(ROOT, 'index.html');
const NOT_FOUND = '404.html';
/* The route pages' folder. No route starts with /pages, and nothing links to
   a file in it: each page is reached through its route's rewrite. */
const PAGES = 'pages';

const STYLE_MARKER = '/*@INJECT:styles*/\n';
const SCRIPT_MARKER = '//@INJECT:scripts\n';
const VERSIONS_MARKER = '/*@INJECT:dataversions*/';
const CSP_MARKER = '@CSP_HASH';
const REWRITES_MARKER = '@ROUTE_REWRITES';

/* Data files that ship WITH the repo, and may therefore be cached forever under
   a content-addressed URL. The licensed lane is deliberately absent: those files
   are git-ignored, exist only on the reader's own machine, and publishing a hash
   of them in a public repo would leak a fingerprint of licensed data. They keep
   plain URLs and no-store, which is what fetchJson falls back to. */
const VERSIONED = ['us.json', 'instruments.json', 'sarawak-geo.json', 'napic-h1-2025.json'];

function dataVersions() {
  const out = {};
  for (const f of VERSIONED) {
    const path = join(ROOT, 'data', f);
    if (!existsSync(path)) throw new Error(`data/${f} is missing — it is committed, so this is a broken checkout`);
    out[f] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  }
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
export function clientRouter(origin) {
  const js = (f) => lf(readFileSync(src('js', f), 'utf8'));
  const UI = js('35-ui.js'), DISCOVER = js('40-views-discover.js'), LEARN = js('65-learn.js');
  /* From the first `start` to the first `close` after it — a top-level
     declaration, which is what every one of these is. If one stops being, this
     throws with its name rather than evaluating half a file. */
  const cut = (text, file, start, close) => {
    const i = text.indexOf(start);
    if (i < 0) throw new Error(`${file}: "${start.trim()}" not found — the build reads the router out of it`);
    const j = text.indexOf(close, i);
    if (j < 0) throw new Error(`${file}: no ${JSON.stringify(close)} closes "${start.trim()}"`);
    return text.slice(i, j + close.length);
  };
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
  const ctx = vm.createContext({
    URLSearchParams, document, location: null, State: {}, BY_ID: new Map(),
    /* Reached only for a company's own address, which is a parameter route
       and never gets a page of its own. */
    companyPath: () => { throw new Error('a route without a parameter asked for a company path'); },
  });
  const api = vm.runInContext([
    "const BASE = '';",
    cut(UI, '35-ui.js', 'const href = ', ';\n'),
    cut(UI, '35-ui.js', 'const ROUTES = [', '\n];'),
    cut(UI, '35-ui.js', 'const META = {', '\n};'),
    ...additions,
    cut(DISCOVER, '40-views-discover.js', 'const DISCOVER_TABS = [', '\n];'),
    cut(LEARN, '65-learn.js', 'const LEARN_TAB_ALIAS = ', ';\n'),
    cut(LEARN, '65-learn.js', 'const LEARN_TABS = [', '\n];'),
    cut(UI, '35-ui.js', 'function matchRoute(', '\n}\n'),
    cut(UI, '35-ui.js', 'function setDocumentMeta(', '\n}\n'),
    cut(UI, '35-ui.js', 'function canonicalPath(', '\n}\n'),
    '({ ROUTES, META, matchRoute, setDocumentMeta })',
  ].join('\n'), ctx, { filename: 'src/js (router)' });

  /* What setDocumentMeta writes on a first load of `path`: the route's title,
     META line and canonical address, or — for an address no route matches —
     the not-found card's. */
  const headAt = (path) => {
    ctx.location = { origin, pathname: path, search: '', hash: '' };
    tags.clear();
    document.title = '';
    api.setDocumentMeta(api.matchRoute(path));
    const description = tags.get('meta[name="description"]')?.attrs.content;
    const canonical = tags.get('link[rel="canonical"]')?.attrs.href;
    if (!document.title || !description || !canonical) throw new Error(`setDocumentMeta set no title, description or canonical for ${path}`);
    return { title: document.title, description, canonical };
  };
  return { ROUTES: api.ROUTES, META: api.META, matchRoute: api.matchRoute, headAt };
}

/* The site's own address, read from the canonical link the template gives the
   site root — the one place it is written. */
export function siteOrigin(template) {
  const m = template.match(/<link rel="canonical" href="(https?:\/\/[^/"]+)\/">/);
  if (!m) throw new Error("the template's canonical link no longer names the site root, so the site's address cannot be read");
  return m[1];
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
    /* data/ and _vercel/ are the host's and the files', never a page's. */
    if (/^\/(data|_vercel)(\/|$)/.test(r.path)) throw new Error(`route ${r.path} is under /data or /_vercel`);
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
  /* An address no route matches: setDocumentMeta(null)'s title and description. */
  return { origin, pages, params, notFound: router.headAt('/404.html'), ROUTES: router.ROUTES };
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
  put(TAG.canonical, notFound ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escAttr(head.canonical)}">`);
  put(TAG.ogUrl, notFound ? '' : `<meta property="og:url" content="${escAttr(head.canonical)}">\n`);
  put(TAG.ogTitle, `<meta property="og:title" content="${escAttr(head.title)}">`);
  put(TAG.ogDesc, `<meta property="og:description" content="${escAttr(head.description)}">`);
  put(TAG.twTitle, `<meta name="twitter:title" content="${escAttr(head.title)}">`);
  put(TAG.twDesc, `<meta name="twitter:description" content="${escAttr(head.description)}">`);
  return top + html.slice(end);
}

/* The inline script exactly as the browser sees it — what the CSP hash names. */
const inlineScript = (html) => html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

export function build() {
  const template = lf(readFileSync(src('index.template.html'), 'utf8'));
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
  const versions = dataVersions();
  if (!js.includes(VERSIONS_MARKER)) throw new Error('src/js lost its data-version marker');
  js = js.replace(VERSIONS_MARKER, () => JSON.stringify(versions));

  const shell = template
    .replace(STYLE_MARKER, () => css)
    .replace(SCRIPT_MARKER, () => js);

  /* Every page is the shell with its route's head; the site root's is
     index.html. Pages whose heads are identical share one file, named after
     the route among them that is its own canonical address (the wheel's five
     aliases share pages/us-options/wheel.html), else after the first. */
  const plan = routePlan(template);
  const html = withHead(shell, plan.pages.find(p => p.path === '/').head);
  const notFound = withHead(shell, plan.notFound, { notFound: true });
  const groups = new Map();
  for (const p of plan.pages) {
    if (p.path === '/') continue;
    const key = JSON.stringify(p.head);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const pages = new Map();
  const fileOfHead = new Map();
  for (const [key, group] of groups) {
    const named = group.find(p => plan.origin + p.path === p.head.canonical) || group[0];
    const file = `${PAGES}${named.path}.html`;
    fileOfHead.set(key, file);
    pages.set(file, withHead(shell, named.head));
  }
  const rewrites = plan.pages.map(p => ({
    source: p.path,
    destination: p.path === '/' ? '/index.html' : `/${fileOfHead.get(JSON.stringify(p.head))}`,
  }));
  /* After every exact path, so no :param can answer an address a page is
     written for (matchRoute has already decided each of those). They all go
     to one file, so their order among themselves cannot matter. */
  for (const path of plan.params) rewrites.push({ source: path, destination: '/index.html' });

  /* The CSP hash covers the inline script EXACTLY as the browser will see it —
     taken back out of the assembled document rather than from the pieces, so a
     templating slip can never produce a header that describes something other
     than what shipped. Every page must carry that same script, byte for byte:
     one header is served for all of them. */
  const inline = inlineScript(html);
  for (const [file, page] of [[NOT_FOUND, notFound], ...pages]) {
    if (inlineScript(page) !== inline) throw new Error(`${file}'s inline script differs from index.html's, so the one CSP hash cannot cover both`);
  }
  const cspHash = 'sha256-' + createHash('sha256').update(inline, 'utf8').digest('base64');

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
  const parsed = JSON.parse(cfgTemplate.replace(CSP_MARKER, () => cspHash));
  if (parsed.rewrites !== REWRITES_MARKER) throw new Error(`vercel template's "rewrites" must be "${REWRITES_MARKER}" — the build writes them from ROUTES`);
  parsed.rewrites = rewrites;
  const vercel = JSON.stringify(stripComments(parsed), null, 2) + String.fromCharCode(10);
  if (vercel.includes('"$comment')) throw new Error('a $comment survived into vercel.json');

  return { html, vercel, notFound, pages, rewrites, plan, modules, versions, cspHash };
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

/* What would make the committed files serve something other than what they
   say, beyond drift from src/.

   1. A file where a route's address is. Vercel looks at the files BEFORE the
      rewrites, so a file or a folder with an index.html at /pricing would be
      served there and the rewrite never reached. Nothing may rely on that
      order, so nothing may stand there.
   2. The sitemap: every address it lists must be served its own page, name
      itself as its canonical (the sitemap lists canonical addresses only, and
      the page's canonical is what the router sets), sit on the site's own
      origin, and not be one robots.txt disallows. */
function servingProblems({ rewrites, plan }) {
  const out = [];
  for (const { source } of rewrites) {
    if (source === '/' || source.includes(':')) continue;
    const at = join(ROOT, source);
    if (existsSync(at) && (statSync(at).isFile() || existsSync(join(at, 'index.html'))))
      out.push(`${source}: a file in the repository stands at this address, and Vercel serves files before rewrites`);
  }
  const sitemap = existsSync(join(ROOT, 'sitemap.xml')) ? readFileSync(join(ROOT, 'sitemap.xml'), 'utf8') : '';
  const robots = existsSync(join(ROOT, 'robots.txt')) ? readFileSync(join(ROOT, 'robots.txt'), 'utf8') : '';
  const disallow = [...robots.matchAll(/^Disallow:\s*(\S+)/gmi)].map(m => m[1]);
  const blocked = (p) => disallow.some(d => (d.endsWith('$') ? p === d.slice(0, -1) : p.startsWith(d)));
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
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  const built = build();
  const { html, vercel, notFound, pages, rewrites, plan, modules, versions, cspHash } = built;
  const CFG = join(ROOT, 'vercel.json');
  const kb = (n) => `${(n / 1024).toFixed(0)}kB`;
  const outputs = [['index.html', html], ['vercel.json', vercel], [NOT_FOUND, notFound], ...pages];
  const stale = filesUnder(PAGES).filter(f => !pages.has(f));
  const problems = servingProblems(built);
  const shared = plan.pages.length - 1 - pages.size;

  if (process.argv.includes('--check')) {
    const drift = [];
    for (const [label, body] of outputs) {
      const path = join(ROOT, label);
      if (!existsSync(path)) { drift.push(`${label} is missing — the build writes it`); continue; }
      const committed = lf(readFileSync(path, 'utf8'));
      if (sha(committed) !== sha(body)) drift.push(`${label} DOES NOT match src/  committed ${sha(committed).slice(0, 12)}  from src ${sha(body).slice(0, 12)}`);
    }
    /* A page for a route that no longer exists (or a path that changed) is
       still deployed and still served at its file's address; the build removes
       it, so a committed one means the build was not run. */
    stale.forEach(f => drift.push(`${f} is stale — no route writes it any more`));
    problems.forEach(p => drift.push(p));
    if (!drift.length) {
      console.log(`index.html, 404.html, ${pages.size} route pages and vercel.json match src/ (${modules.length} modules, ${kb(html.length)}; ${rewrites.length} rewrites).`);
      console.log(`sitemap.xml lists only canonical addresses that are served their own page.`);
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
    console.log(`404.html     the not-found head, noindex`);
    console.log(`pages/       ${pages.size} pages for ${plan.pages.length - 1} routes without a parameter${shared ? ` (${shared} share a page)` : ''}${stale.length ? `; ${stale.length} stale removed` : ''}`);
    console.log(`vercel.json  ${rewrites.length} rewrites (${plan.params.length} parameter routes to index.html)  csp ${cspHash.slice(0, 19)}…`);
    Object.entries(versions).forEach(([f, v]) => console.log(`  data/${f.padEnd(18)} v=${v}`));
    if (problems.length) {
      problems.forEach(p => console.error(`WARNING  ${p}`));
      console.error('`node build.mjs --check` fails until these are resolved.');
    }
  }
}
