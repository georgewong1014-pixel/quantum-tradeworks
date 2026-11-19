#!/usr/bin/env node
/* Vercel ignoreCommand. Exit 0 skips the build. Exit 1 builds.
   A commit message that contains [vercel skip] or [skip ci] is a skip.
   Option A, George 18 Nov 02:24 MYT: a health-record commit is not a release.
   Skip when the commit message says [vercel skip] or [skip ci], or when the
   author is github-actions[bot] and the diff since VERCEL_GIT_PREVIOUS_SHA
   touches only health/** or the generated status island page. If that SHA
   is missing or the diff cannot be listed, build. */
import { execFileSync } from 'node:child_process';

const ISLAND = new Set(['pages/status.html', 'prerender/status.html', 'prerender/status.tabs.html']);
const SKIP = /\[(?:vercel skip|skip ci)\]/i;

export function healthRecordOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every(f => f.startsWith('health/') || ISLAND.has(f));
}

/* skip true means exit 0. previousKnown is false when the SHA is missing
   or git cannot diff it: that builds, unless the message itself says skip. */
export function ignoreBuild({ message = '', author = '', files = null, previousKnown = false } = {}) {
  if (SKIP.test(message)) return true;
  if (!previousKnown) return false;
  return author === 'github-actions[bot]' && healthRecordOnly(files);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fromGit() {
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA || '';
  const previousKnown = /^[0-9a-f]{7,40}$/i.test(previous) && !/^0+$/.test(previous);
  let message = '';
  let author = '';
  try {
    message = git(['log', '-1', '--format=%B']);
    author = git(['log', '-1', '--format=%an']);
  } catch {
    return { message: '', author: '', files: null, previousKnown: false };
  }
  if (!previousKnown) return { message, author, files: null, previousKnown: false };
  try {
    const files = git(['diff', '--name-only', previous, 'HEAD']).split('\n').filter(Boolean);
    return { message, author, files, previousKnown: true };
  } catch {
    return { message, author, files: null, previousKnown: false };
  }
}

function selfTest() {
  let bad = 0;
  const t = (ok, what) => { if (ok) console.log(`ok    ${what}`); else { bad++; console.error(`FAIL  ${what}`); } };
  const files = ['health/journeys.json', 'health/checks.json', 'pages/status.html'];
  t(ignoreBuild({ message: 'chore(health): record\n\n[vercel skip]', previousKnown: false }) === true, '[vercel skip] skips even when the previous SHA is unknown');
  t(ignoreBuild({ message: 'release [skip ci]', previousKnown: true, author: 'MCD', files: ['pages/about.html'] }) === true, '[skip ci] skips');
  t(ignoreBuild({ message: 'a real page', previousKnown: false, author: 'github-actions[bot]', files }) === false, 'an unknown previous SHA builds');
  t(ignoreBuild({ message: 'a real page', previousKnown: true, author: 'github-actions[bot]', files }) === true, 'a bot commit of only the health records and the status island page skips');
  t(ignoreBuild({ message: 'a real page', previousKnown: true, author: 'github-actions[bot]', files: ['prerender/status.html'] }) === true, 'the generated status prerender counts as an island page');
  t(ignoreBuild({ message: 'a real page', previousKnown: true, author: 'github-actions[bot]', files: [...files, 'src/js/91-health.js'] }) === false, 'a bot commit that also changes the app builds');
  t(ignoreBuild({ message: 'a real page', previousKnown: true, author: 'MCD', files }) === false, 'the same files from a person build');
  t(ignoreBuild({ message: 'a real page', previousKnown: true, author: 'github-actions[bot]', files: [] }) === false, 'an empty diff builds');
  t(ignoreBuild({ message: 'a real page', previousKnown: false }) === false, 'a content change with no previous SHA builds');
  console.log(bad ? `\n${bad} self-test check(s) failed` : '\nself-test: [vercel skip] and [skip ci] skip; a bot health-record diff skips; an unknown previous SHA builds');
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();
process.exit(ignoreBuild(fromGit()) ? 0 : 1);
