#!/usr/bin/env node
/* Parses the inline <script> out of index.html and syntax-checks it.
   ---------------------------------------------------------------------------
   A syntax error in a single-file app is total: nothing renders, on every
   route. The route sweep does catch it — as "page is nearly empty" on all 45 —
   but that takes four minutes and describes the symptom. This takes half a
   second and names the line.

   Run it before the sweep, not instead of it. */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dirname, join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE = process.argv[2] || pjoin(dirname(fileURLToPath(import.meta.url)), 'index.html');
const html = await readFile(FILE, 'utf8');

/* Every inline script, largest first — the app is one big one, but a stray
   small one still has to parse. */
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(html))) {
  blocks.push({ code: m[1], line: html.slice(0, m.index).split('\n').length });
}
if (!blocks.length) { console.error('no inline <script> found'); process.exit(1); }

let bad = 0;
for (const [i, b] of blocks.entries()) {
  const tmp = join(tmpdir(), `qt-syntax-${process.pid}-${i}.js`);
  await writeFile(tmp, b.code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`ok    inline script #${i + 1} (html line ${b.line}, ${b.code.split('\n').length} lines)`);
  } catch (e) {
    bad++;
    const err = String(e.stderr || e.message);
    /* Translate the temp-file line number back to a line in index.html. */
    const hit = err.match(/qt-syntax-\d+-\d+\.js:(\d+)/);
    console.error(`FAIL  inline script #${i + 1}`);
    if (hit) console.error(`      index.html line ~${b.line + Number(hit[1]) - 1}`);
    console.error(err.split('\n').slice(0, 6).map(l => '      ' + l).join('\n'));
  }
}
console.log(bad ? `\n${bad} script(s) failed to parse` : `\nall ${blocks.length} inline script(s) parse`);
process.exit(bad ? 1 : 0);
