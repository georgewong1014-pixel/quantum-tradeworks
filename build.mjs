#!/usr/bin/env node
/**
 * Assembles index.html from src/. The shipped artefact is still exactly one
 * self-contained file — that has not changed, and must not.
 *
 *   node build.mjs            write index.html
 *   node build.mjs --check    build to memory, fail if the committed file differs
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
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(ROOT, 'src', ...p);
const OUT = join(ROOT, 'index.html');

const STYLE_MARKER = '/*@INJECT:styles*/\n';
const SCRIPT_MARKER = '//@INJECT:scripts\n';
const VERSIONS_MARKER = '/*@INJECT:dataversions*/';
const CSP_MARKER = '@CSP_HASH';

/* Data files that ship WITH the repo, and may therefore be cached forever under
   a content-addressed URL. The licensed lane is deliberately absent: those files
   are git-ignored, exist only on the reader's own machine, and publishing a hash
   of them in a public repo would leak a fingerprint of licensed data. They keep
   plain URLs and no-store, which is what fetchJson falls back to. */
const VERSIONED = ['us.json', 'instruments.json', 'sarawak-geo.json'];

function dataVersions() {
  const out = {};
  for (const f of VERSIONED) {
    const path = join(ROOT, 'data', f);
    if (!existsSync(path)) throw new Error(`data/${f} is missing — it is committed, so this is a broken checkout`);
    out[f] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  }
  return out;
}

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

  const html = template
    .replace(STYLE_MARKER, () => css)
    .replace(SCRIPT_MARKER, () => js);

  /* The CSP hash covers the inline script EXACTLY as the browser will see it —
     taken back out of the assembled document rather than from the pieces, so a
     templating slip can never produce a header that describes something other
     than what shipped. */
  const inline = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const cspHash = 'sha256-' + createHash('sha256').update(inline, 'utf8').digest('base64');

  const cfgTemplate = lf(readFileSync(src('vercel.template.json'), 'utf8'));
  if (!cfgTemplate.includes(CSP_MARKER)) throw new Error('vercel template lost its CSP marker');
  const vercel = cfgTemplate.replace(CSP_MARKER, () => cspHash);
  JSON.parse(vercel);                       /* refuse to emit config that will not parse */

  return { html, vercel, modules, versions, cspHash };
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

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  const { html, vercel, modules, versions, cspHash } = build();
  const CFG = join(ROOT, 'vercel.json');
  const kb = (n) => `${(n / 1024).toFixed(0)}kB`;

  if (process.argv.includes('--check')) {
    const drift = [];
    for (const [label, path, built] of [['index.html', OUT, html], ['vercel.json', CFG, vercel]]) {
      const committed = lf(readFileSync(path, 'utf8'));
      if (sha(committed) !== sha(built)) drift.push([label, sha(committed), sha(built)]);
    }
    if (!drift.length) {
      console.log(`index.html and vercel.json match src/ (${modules.length} modules, ${kb(html.length)}).`);
    } else {
      drift.forEach(([label, was, now]) =>
        console.error(`${label} DOES NOT match src/  committed ${was.slice(0, 12)}  from src ${now.slice(0, 12)}`));
      console.error('\nRun `node build.mjs` and commit the result.');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, html);
    writeFileSync(CFG, vercel);
    console.log(`index.html   ${modules.length} modules  ${kb(html.length)}  ${sha(html).slice(0, 12)}`);
    console.log(`vercel.json  csp ${cspHash.slice(0, 19)}…`);
    Object.entries(versions).forEach(([f, v]) => console.log(`  data/${f.padEnd(18)} v=${v}`));
  }
}
