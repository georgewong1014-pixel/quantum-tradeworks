#!/usr/bin/env node
// Minimal zero-dependency static server for local preview + screenshotting.
//   node serve.mjs [--port 8123] [--root .]
//
// It answers every request the way Vercel answers it, from the same
// vercel.json: a trailing slash is redirected, then the redirects apply, a
// file is served as itself, then the rewrites are tried in order, and
// anything left is 404.html with status 404. Every harness runs against this server, so what they test is
// what production serves — not a friendlier local imitation of it.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { join, extname, resolve, normalize, sep } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/* 8123, the port every harness, npm script and CI step targets. The default
   was 3000, which is another project's server on the development machine, so
   `npm run dev` followed by `npm run sweep` found nothing to test. */
const PORT = Number(arg('port', process.env.PORT || 8123));
/* The root as the file system spells it, so that a file's real name can be
   compared with the address asked for (fileAt, below). */
const ROOT = realpathSync.native(resolve(arg('root', '.')));

/* The production configuration, applied locally. Without this the Content-
   Security-Policy only ever ran in production — and a CSP that blocks the
   app's own inline script does not degrade, it shows a blank page. The whole
   point of the generated policy is that it can be wrong; it has to be wrong
   HERE first. The same holds for the rewrites since they became one per route:
   a route the build forgot must 404 here, not only on Vercel. The site's own
   vercel.json, beside the files it describes. */
const CONFIG = join(ROOT, 'vercel.json');

/* A vercel.json source is path-to-regexp (v6, the version Vercel compiles
   with: case-sensitive, and strict, so /pricing does not match /pricing/).
   This implements the part of it this site uses — literal characters,
   whole-segment :params, :params+ (one or more segments), and (regex) groups
   — and refuses the rest by name, so a template that starts using more fails
   here, loudly, instead of meaning one thing locally and another in
   production. A parameter is a named group, which is how a redirect's
   destination is filled in. */
function sourceRegExp(source) {
  let re = '';
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (ch === ':') {
      const m = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(i));
      if (!m) throw new Error(`a ":" that is not a parameter in ${source}`);
      i += m[0].length;
      const repeat = source[i] === '+';
      if (repeat) i++;
      if (source[i] === '(' || '*+?'.includes(source[i] || ' ')) throw new Error(`serve.mjs does not implement this parameter's pattern or modifier: ${source}`);
      re += repeat ? `(?<${m[1]}>[^\\/#\\?]+?(?:\\/[^\\/#\\?]+?)*)` : `(?<${m[1]}>[^\\/#\\?]+?)`;
      continue;
    }
    if (ch === '(') {
      let depth = 0, j = i;
      for (; j < source.length; j++) {
        if (source[j] === '\\') { j++; continue; }
        if (source[j] === '(') depth++;
        else if (source[j] === ')' && --depth === 0) break;
      }
      if (depth !== 0) throw new Error(`an unclosed group in ${source}`);
      re += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if ('*+?{}'.includes(ch)) throw new Error(`serve.mjs does not implement "${ch}" in a vercel.json source: ${source}`);
    re += ch.replace(/[.^$|[\]\\/]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}$`);
}

/* Re-read when it changes rather than at startup. The CSP hash is derived from
   the built script, so every `node build.mjs` changes it — and a server
   holding the previous hash serves a policy that blocks the app it is serving.
   That looks exactly like a code bug: a blank page, one console line, and a
   build that passes every check. Rebuilding is the common case during
   development, so the config has to be as fresh as the file. A stat per
   request is nothing next to reading a 3MB page off disk. */
const IMPLEMENTED = new Set(['headers', 'rewrites', 'redirects', 'trailingSlash']);
let cachedMtime = 0, refusedMtime = 0, cfg = { headers: [], rewrites: [], redirects: [], trailingSlash: undefined };
function config() {
  let m = 0;
  try {
    m = statSync(CONFIG).mtimeMs;
    if (m !== cachedMtime && m !== refusedMtime) {
      const raw = JSON.parse(readFileSync(CONFIG, 'utf8'));
      const next = {
        headers: (raw.headers || []).map(g => ({ re: sourceRegExp(g.source), headers: g.headers })),
        rewrites: (raw.rewrites || []).map(r => {
          if (/[:$]/.test(r.destination)) throw new Error(`serve.mjs does not substitute parameters into a destination: ${r.destination}`);
          return { re: sourceRegExp(r.source), destination: r.destination };
        }),
        /* permanent (the default) is 308, temporary 307, as Vercel sends them. */
        redirects: (raw.redirects || []).map(r => {
          if (r.has || r.missing) throw new Error(`serve.mjs does not implement a redirect's has/missing: ${r.source}`);
          return { re: sourceRegExp(r.source), destination: r.destination,
            status: r.statusCode || (r.permanent === false ? 307 : 308) };
        }),
        trailingSlash: raw.trailingSlash,
      };
      /* What this server would silently serve differently, said once per
         version of the file. */
      const missing = Object.keys(raw).filter(k => !IMPLEMENTED.has(k));
      if (raw.trailingSlash === true) missing.push('trailingSlash: true');
      if (missing.length) console.error(`serve.mjs does not implement vercel.json's ${missing.join(', ')} — what it serves differs from Vercel`);
      cfg = next;
      cachedMtime = m;
    }
  } catch (err) {
    /* No config, or mid-write: keep the last good one. A config that parses
       but cannot be served is said, not swallowed — once, not per request. */
    if (!(err instanceof SyntaxError) && err.code !== 'ENOENT') {
      refusedMtime = m;
      console.error(`vercel.json cannot be served as Vercel would: ${err.message} — keeping the last good configuration`);
    }
  }
  return cfg;
}
const configuredHeaders = (pathname) => {
  const out = {};
  for (const rule of config().headers) {
    if (rule.re.test(pathname)) rule.headers.forEach(h => { out[h.key.toLowerCase()] = h.value; });
  }
  return out;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* The file at an address, as a static host has it: a file is itself, a folder
   is its index.html. Nothing else — no /about for about.html, which Vercel
   does not do without cleanUrls, and no fallback to the app: that is the
   rewrites' job now, and only for the addresses they name. */
async function fileAt(pathname) {
  // Contain every request inside ROOT. A malformed percent sequence (/%zz, or
  // a link truncated mid-escape) used to throw here, outside any handler, and
  // take the whole server down for every other tab — now it is a plain miss.
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const candidate = normalize(join(ROOT, decoded));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  /* Spelled as the file is spelled. Vercel's file system is case-sensitive;
     Windows' and macOS's are not, so /INDEX.HTML, /Data/us.json and
     /PAGES/PRICING.HTML answered 200 here and 404 in production — a link in
     the wrong case passed every local check. A name that differs from the
     real one only in case is a miss, as it is there. */
  const exact = (p) => { try { const real = realpathSync.native(p); return real === p || real.toLowerCase() !== p.toLowerCase(); } catch { return false; } };
  try {
    const info = await stat(candidate);
    if (info.isFile()) return exact(candidate) ? candidate : null;
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      if ((await stat(index)).isFile() && exact(index)) return index;
    }
  } catch { /* nothing there */ }
  return null;
}

/* Every request is contained. An async handler that throws is an unhandled
   rejection, and on Node 22+ that ends the process — one bad request (a
   malformed Host header, an unreadable vercel.json mid-edit) took the server
   down for every open tab and every test harness using it. */
const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    try {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`500 ${err?.message || err}`);
    } catch { /* the socket is already gone */ }
  });
});

async function handle(req, res) {
  /* The path as it was sent. Resolved against a base, "//" and "//x/" read as
     an address on another host and failed (400); Vercel reads them as paths.
     Only the path and the query are used, so the Host header plays no part. */
  let url;
  try { url = new URL(req.url.startsWith('/') ? `http://localhost${req.url}` : req.url); }
  catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('400 Bad Request'); return; }
  const { rewrites, redirects, trailingSlash } = config();
  const path = url.pathname;
  const redirect = (status, location) => {
    res.writeHead(status, { location, 'content-type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : `Redirecting to ${location}`);
  };

  /* trailingSlash: false. Vercel answers /pricing/ with a 308 to /pricing —
     the site root excepted, and the query kept — before it looks at a file or
     a rewrite. The pattern is the one Vercel compiles for it
     (@vercel/routing-utils, convertTrailingSlash: ^/(.*)\/$ to /$1), so one
     slash comes off per redirect: /pricing// goes to /pricing/ and then to
     /pricing. This server answered /pricing// with a 404 on a narrower
     pattern, which is not what production does.
     One deliberate difference: a Location that would start "//" names
     another host to a browser (//example.com/ would be sent to
     example.com), so here it keeps a single slash. served-check.mjs holds
     production to the same rule, so it is checked, not assumed. */
  if (trailingSlash === false) {
    const m = /^\/(.*)\/$/.exec(path);
    if (m) { redirect(308, `/${m[1]}`.replace(/^\/+/, '/') + url.search); return; }
  }
  /* Then the redirects, the first match deciding, its parameters filled into
     the destination and the query carried unless the destination has one. */
  for (const r of redirects) {
    const m = r.re.exec(path);
    if (!m) continue;
    const to = r.destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)\+?/g, (_, n) => m.groups?.[n] ?? '');
    redirect(r.status, to.includes('?') ? to : `${to}${url.search}`);
    return;
  }

  /* Files first, as Vercel does; then the rewrites, in order, the first whose
     source matches deciding (the query plays no part in either); then the 404
     page, with its status. Headers are chosen by the address that was asked
     for, not the file that answers it — the order Vercel applies them in. */
  let file = await fileAt(path);
  let status = 200;
  if (!file) {
    const hit = rewrites.find(r => r.re.test(path));
    if (hit) file = await fileAt(hit.destination);
  }
  if (!file) {
    status = 404;
    file = await fileAt('/404.html');
  }
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...configuredHeaders(path) });
    res.end(`404 Not Found: ${path}`);
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(status, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'content-length': body.length,
      ...configuredHeaders(path),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 ${err.message}`);
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — a dev server is probably already running. Reuse it.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const c = config();
  console.log(`serving ${ROOT}`);
  console.log(`http://localhost:${PORT}`);
  console.log(`applying ${c.headers.length} header rule(s), ${c.redirects.length} redirect(s) and ${c.rewrites.length} rewrite(s) from vercel.json${c.trailingSlash === false ? ', trailing slashes redirected' : ''}, re-read on change`);
});
