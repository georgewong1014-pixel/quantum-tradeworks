#!/usr/bin/env node
/**
 * Claims to review — a list for a person, never a failure.
 *
 *   node claims-review.mjs                 the report; exits 0 whatever it finds
 *   node claims-review.mjs --strict        exits 1 only where a Tier 1 (forbidden) phrase is used as a claim
 *   node claims-review.mjs --json          the report as JSON
 *   node claims-review.mjs --root <dir>    another tree (a clean copy, a fixture)
 *   node claims-review.mjs --self-test     its fixtures: what must be flagged, what must not, the
 *                                          allowlist, and the exit codes
 *
 * Exit 2: an input it reads is missing — the file is named.
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (the claims audit of 11 Oct 2026, rank 17;
 * CROSS-BUSINESS-CLAIMS-TESTS.md in the owner's handoff folder)
 *
 * wording-check fails on phrase lists, each scoped to one area: the property
 * landing, the Lab, the scanner, the property verdicts, the verified total.
 * Nothing read the rest of the site for the four things the owner's
 * "no overpromising" standard asks about — an absolute claim no check
 * supports, a scope left out (a market, a price, a dataset the page does not
 * hold), two pages that disagree, and a past or modelled figure worded as an
 * expectation. The audit found them by hand: "history is never overwritten"
 * beside "a restatement overwrites", "AAPL · illustrative" on /methodology
 * for a filed company, one meta description on five pages, "Cash required
 * upfront" without the reserve, "a buyer will pay for at exit".
 *
 * Most categorical sentences on this site are true and deliberate — "a match
 * is recorded, never sent", "nothing here is ranked" — and a check that
 * fails them would be switched off. So this one lists, it does not block:
 *   Tier 1  forbidden: guaranteed returns, risk-free (but the risk-free
 *           rate), "can't lose", "buy now", "top pick", "will make you", "#1",
 *           testimonials, user counts. Under --strict a Tier 1 hit exits 1.
 *   Tier 2  flag: absolute words (every, always, all of, complete, exact,
 *           perfect, certain), accuracy and proof (accurate, proven, true),
 *           real / live / safe / real-time, "market price" and "current
 *           price", valuation verdicts (discount to, undervalued, cheap),
 *           suitability (eligible), ratings (rating, risk grade), "will" or
 *           "should" with an outcome verb, and "most … tools" comparisons.
 *   Tier 3  consistency: a retired reference served outside its section,
 *           a filed company labelled illustrative, two pages with one meta
 *           description, "cash required" without the reserve.
 * A sentence that denies its own claim ("not", "no", "never sent",
 * "nothing", "cannot" …) is not flagged for Tier 1 or 2: the unit is the
 * sentence, so a claim beside a disclaimer is still a claim. A sentence a
 * person has reviewed is in claims-reviewed.json, by the hash of its
 * normalised text: a changed word drops it out and it is flagged again.
 *
 * WHAT IT READS — the text a reader is served, and the copy it comes from:
 *   - every render under prerender/ (its visible text; a chart's svg left
 *     out), the company pages by three filers, as the audit read them;
 *   - every page's <meta name="description"> under pages/ (not the 138
 *     company pages, whose description one function composes);
 *   - the string literals of src/js/*.js, comments left out — for Tier 1,
 *     and for the Tier 2 families that are not absolute words (those are
 *     read where they are served);
 *   - data/us.json, for which companies are filed.
 * It changes no page, and the CI step that runs it does not fail a build.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const ALLOWLIST = 'claims-reviewed.json';
/* The filed company pages read, as the audit read them. */
const COMPANY_SAMPLE = ['aapl-apple-inc', 'jpm-jpmorgan-chase', 'o-realty-income'];

/* ─── THE TIERS ─────────────────────────────────────────────────────────── */
/* Each family: its name, its tier, a pattern, and where it is read —
   'served' (renders and metas) or 'all' (the modules' strings too). */
const FAMILIES = [
  /* Tier 1 — forbidden as a claim. "risk-free" in a formula (the
     risk-free rate) is a term, not a promise. */
  { id: 'guarantee', tier: 1, where: 'all', re: /\bguarantee[ds]?\b/gi },
  { id: 'risk-free', tier: 1, where: 'all', re: /\brisk[- ]free\b(?![- ]rates?\b)|\b(?:no|zero)[- ]risk\b(?=\s*(?:[.,;:!)]|$|of loss|involved|at all|whatsoever))/gi },
  { id: 'cannot-lose', tier: 1, where: 'all', re: /\b(?:can[’']?t lose|cannot lose|sure win|sure thing)\b/gi },
  { id: 'pick', tier: 1, where: 'all', re: /\b(?:best investment|top picks?|buy now|hot stocks?)\b/gi },
  { id: 'will-make', tier: 1, where: 'all', re: /\bwill (?:make you|double your|guarantee)\b/gi },
  { id: 'predicts', tier: 1, where: 'all', re: /\bAI (?:predicts|prediction)|\baccurate to\b|(?:^|\s)#1\b|\bnumber one\b/gi },
  { id: 'social-proof', tier: 1, where: 'all', re: /\btestimonials?\b|\b\d[\d,]*\+? (?:users|investors|customers|subscribers) (?:trust|use|rely)\b/gi },
  /* Tier 2 — read by a person. */
  /* Absolute words where they claim: "every" with a completeness verb
     ("every filter explained", "every line is verified"), "never" as a
     promise about the data ("is never overwritten"), and the words that
     claim on their own. "Every version kept", "a bar never confirms a
     match" describe what the code does, and are left to the tests that
     hold them. */
  { id: 'absolute', tier: 2, where: 'served', re: /\b(?:always|anywhere|all of|perfect(?:ly)?|flawless|certain(?:ly|ty)?|completely|exactly)\b|(?<!(?:to|\d%|\d) )\bcomplete\b(?!\s+(?:the|a|it|your|purchases?|at all|journeys?)\b)|\bevery\s+(?:[\w’'-]+,?\s+){0,4}?(?:is\s+|are\s+)?(?:published|verified|explained|sourced|labelled|cited|reconciled|accurate|correct|covered)\b|\b(?:is|are|was|were)\s+never\s+(?!(?:sent|ranked|blended|deployed|shared|uploaded|collected|recommended|ordered|sold|counted)\b)[a-z]+/gi },
  { id: 'accuracy', tier: 2, where: 'all', re: /\b(?:accura(?:te|cy)|proven|proves?(?! you wrong)|true acquisition|true discount|the true)\b/gi },
  { id: 'real-live-safe', tier: 2, where: 'served', re: /\b(?:real[- ]?time|realtime|real (?:monthly|cash|figures|prices?|returns?|data)|safe(?:ly|st)?|live (?:data|prices?|quotes?|feed))\b/gi },
  { id: 'market-price', tier: 2, where: 'all', re: /\b(?:market price|current price|live quote)s?\b/gi },
  { id: 'valuation-verdict', tier: 2, where: 'all', re: /\b(?:discount to|undervalued|overvalued|cheap(?:er|est)?|bargain|mispriced)\b/gi },
  { id: 'suitability', tier: 2, where: 'all', re: /\b(?:eligib(?:le|ility)|suitab(?:le|ility))\b/gi },
  { id: 'rating', tier: 2, where: 'all', re: /\b(?:risk grade|ratings?|rated)\b/gi },
  { id: 'will-outcome', tier: 2, where: 'all', re: /\b(?:will|should|is going to)\s+(?:\w+\s+){0,2}?(?:return|earn|grow|rise|increase|make|deliver|pay|sustain|outperform|beat|double|recover|appreciate)s?\b/gi },
  /* The claims audit's own finds, each a family so it cannot come back
     unseen: what to spend on (R-14), a release promised with no plan
     behind it (R-20), monitoring where nothing runs without prices (F-18),
     a finding about named companies the page has not made (F-08), and a
     provenance the data does not have (F-09). */
  { id: 'advice', tier: 2, where: 'all', re: /\bworth (?:paying|buying|the money)\b|\byou should (?:buy|sell|hold|offer|pay|invest)\b/gi },
  { id: 'roadmap', tier: 2, where: 'all', re: /\b(?:is|are) (?:next|coming next)\b/gi },
  { id: 'monitor', tier: 2, where: 'all', re: /\bmonitor(?:s|ing)? (?:my|your|the reader's) (?:existing |own )?(?:portfolio|setups|holdings)\b/gi },
  { id: 'exposure', tier: 2, where: 'all', denied: false, re: /\bmaterial exposure\b/gi },
  { id: 'provenance', tier: 2, where: 'all', denied: false, re: /\bcarried from the source\b/gi },
  { id: 'comparative', tier: 2, where: 'all', re:/\bmost (?:other )?(?:property )?(?:tools|products|platforms|sites|apps|services)\b|\b(?:better|cheaper|faster|more accurate) than (?:other|any|most)\b/gi },
];
/* A sentence that denies the claim it names: wording-check's DENIAL and
   the plain negatives. "Never" denies only what this site promises never
   to do — "never sent", "never ranked", "never blended", "never a market
   figure" — and is otherwise an absolute word like any other: "history is
   never overwritten" is a promise, and the audit found it false. */
const DENIAL = /\b(?:not|no|nothing|none|neither|nor|without|cannot|can[’']?t|won[’']?t|isn[’']?t|aren[’']?t|doesn[’']?t|don[’']?t|unavailable|refus\w*|absent|instead of|rather than|was called|replaces|the name was|banned|do not use)\b|\bnever (?:\w+ ){0,2}?(?:sent|ranked|blended|deployed|shared|uploaded|collected|recommended|ordered|sold|leaves?|a market figure|a recommendation|chosen for you)\b/i;

/* ─── TEXT ───────────────────────────────────────────────────────────────── */
const lf = (s) => s.split('\r\n').join('\n');
const unEntity = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const BLOCK = /<\/?(?:p|li|h[1-6]|td|th|dt|dd|div|section|article|header|footer|figcaption|caption|summary|details|ul|ol|table|tr|label|button|nav|aside|blockquote|br)\b[^>]*>/gi;
/* A render's visible text as blocks: an svg's words, a script's and a
   style's left out; a block element ends a block. */
function renderBlocks(html) {
  const t = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, '\n').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(BLOCK, '\n').replace(/<[^>]*>/g, ' ');
  return unEntity(t).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /\p{L}/u.test(s));
}
const sentencesOf = (block) => block.split(/(?<=[.!?])\s+(?=[“"‘(]?[A-Z0-9])/).map(s => s.trim()).filter(Boolean);
/* A module's text with its comments left out (block comments, and line
   comments on lines of their own — a URL in a string keeps its //). */
const uncommented = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
/* Its string literals with at least three words: copy, not code. A
   template's ${…} reads as an ellipsis. */
function literalsOf(text) {
  const out = [];
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  for (const m of uncommented(text).matchAll(re)) {
    const s = m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, '…').replace(/\\n/g, ' ').replace(/\\(['"`])/g, '$1').replace(/\s+/g, ' ').trim();
    /* Three words or more, and not a list of class names, selectors or
       identifiers ("btn btn-ghost pub-btn"). */
    const words = (s.match(/\p{L}{2,}/gu) || []).length;
    const codeish = /^[\w.#:[\]=>()-]+(?:\s+[\w.#:[\]=>()-]+)*$/.test(s) && !/\s(?:a|an|the|of|to|is|and|or|in|on|for|with|by)\s/i.test(` ${s} `);
    if (words >= 3 && !codeish) out.push(s);
  }
  return out;
}
const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
export const hashOf = (s) => createHash('sha256').update(norm(s), 'utf8').digest('hex').slice(0, 16);

/* ─── THE TREE ───────────────────────────────────────────────────────────── */
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
/* Everything the review reads from a tree; a missing input throws with
   its name (exit 2). */
export function readTree(root) {
  const need = (p, what) => { if (!existsSync(join(root, p))) { const e = new Error(`${p} is missing — ${what}`); e.missing = p; throw e; } return join(root, p); };
  const pr = need('prerender', 'the renders a reader is served');
  const pg = need('pages', 'the pages whose heads carry each meta description');
  const js = need('src/js', 'the copy the pages are drawn from');
  const us = JSON.parse(readFileSync(need('data/us.json', 'which companies are filed with the SEC'), 'utf8'));
  const allow = JSON.parse(readFileSync(need(ALLOWLIST, 'the sentences a person has reviewed'), 'utf8'));
  const rel = (p) => relative(root, p).split('\\').join('/');
  const renders = walk(pr).filter(f => f.endsWith('.html'))
    .filter(f => !/[\\/]company[\\/]/.test(f) || COMPANY_SAMPLE.some(c => f.endsWith(`${c}.html`)))
    .map(f => ({ file: rel(f), html: lf(readFileSync(f, 'utf8')) }));
  /* Not the generic page a parameter address is served (generic.app.html):
     its head is the site's until the script names the page. */
  const metas = walk(pg).filter(f => f.endsWith('.html') && !/[\\/]company[\\/]/.test(f) && !/generic\.app\.html$/.test(f)).map(f => {
    const h = readFileSync(f, 'utf8');
    const d = /<meta name="description" content="([^"]*)">/.exec(h)?.[1];
    const c = /<link rel="canonical" href="([^"]*)">/.exec(h)?.[1];
    return d == null ? null : { file: rel(f), description: unEntity(d), canonical: c || null };
  }).filter(Boolean);
  const modules = readdirSync(js).filter(f => f.endsWith('.js')).sort().map(f => ({ file: `src/js/${f}`, text: lf(readFileSync(join(js, f), 'utf8')) }));
  return { renders, metas, modules, filers: new Set((us.results || []).map(r => String(r.id).toUpperCase())), allow: Array.isArray(allow.reviewed) ? allow.reviewed : [] };
}

/* ─── THE REVIEW ─────────────────────────────────────────────────────────── */
export function review({ renders, metas, modules, filers, allow }) {
  const reviewed = new Map(allow.map(a => [a.hash, a]));
  const items = new Map();   /* one entry per sentence and family */
  let reviewedHits = 0;
  const seenReviewed = new Set();
  const add = (tier, family, where, text, why = null) => {
    const h = hashOf(text);
    if (tier !== 3 && reviewed.has(h)) { if (!seenReviewed.has(h)) { seenReviewed.add(h); reviewedHits++; } return; }
    const key = `${family}|${h}`;
    const it = items.get(key);
    if (it) { if (!it.also.includes(where) && it.where !== where) it.also.push(where); return; }
    items.set(key, { tier, family, where, text: text.length > 240 ? `${text.slice(0, 237)}…` : text, hash: h, why, also: [] });
  };
  const scan = (where, sentence, served) => {
    for (const f of FAMILIES) {
      if (f.where === 'served' && !served) continue;
      f.re.lastIndex = 0;
      if (!f.re.test(sentence)) continue;
      /* Denied by the rest of the sentence: a Tier 1 phrase's own
         negative ("can't lose", "no risk") denies nothing. */
      f.re.lastIndex = 0;
      /* A family whose phrase is the claim whatever else the sentence
         denies ("carried from the source, not assessed here"). */
      if (f.denied !== false && DENIAL.test(f.tier === 1 ? sentence.replace(f.re, ' ') : sentence)) continue;
      add(f.tier, f.id, where, sentence);
    }
  };
  for (const r of renders) for (const b of renderBlocks(r.html)) for (const s of sentencesOf(b)) scan(r.file, s, true);
  for (const m of metas) for (const s of sentencesOf(m.description)) scan(`${m.file} (meta description)`, s, true);
  for (const m of modules) for (const lit of literalsOf(m.text)) for (const s of sentencesOf(lit)) scan(m.file, s, false);

  /* Tier 3. */
  const servedText = renders.map(r => ({ file: r.file, blocks: renderBlocks(r.html) }));
  /* A retired reference: the Solicitors' Remuneration Order 2023 is
     another jurisdiction's rule, which the fee rulebook on /data-sources
     names to say it is not applied (its "Held for reference", the Sarawak
     scale's note, what could not be verified); anywhere else it reads as
     the rule this product applies. "Seven fee lines" was rulebook
     0.1.0's count. */
  for (const r of servedText) {
    const isRulebook = /(^|\/)data-sources\.html$/.test(r.file);
    r.blocks.forEach((b) => {
      if (/Solicitors[’'] Remuneration Order/i.test(b) && !isRulebook)
        add(3, 'retired-reference', r.file, b, 'the Solicitors’ Remuneration Order 2023 is named only by the fee rulebook on /data-sources, as a rule not applied');
      if (/\bseven fee lines\b/i.test(b)) add(3, 'retired-reference', r.file, b, '"seven fee lines" was rulebook 0.1.0’s count');
      /* A definition: cash required is the model's total with the reserve. */
      if (/\bcash required upfront\b/i.test(b)) add(3, 'definition', r.file, b, '"cash required" everywhere else includes the reserve');
      /* A filed company labelled illustrative. */
      for (const m of b.matchAll(/\b([A-Z][A-Z0-9.-]{0,9}) · illustrative\b/g)) if (filers.has(m[1])) add(3, 'label-agreement', r.file, m[0], `${m[1]} is filed in data/us.json`);
      const il = /\bIllustrative:\s*([A-Z0-9., -]+)/.exec(b);
      if (il) for (const tk of il[1].split(/,\s*/).map(x => x.trim()).filter(Boolean)) if (filers.has(tk)) add(3, 'label-agreement', r.file, `${tk} under "Illustrative:"`, `${tk} is filed in data/us.json`);
    });
  }
  /* One meta description, one page: two canonical addresses with the same
     description are two pages a search snippet cannot tell apart. */
  const byDesc = new Map();
  for (const m of metas) { if (!byDesc.has(m.description)) byDesc.set(m.description, []); byDesc.get(m.description).push(m); }
  for (const [d, ms] of byDesc) {
    const canon = new Set(ms.map(m => m.canonical || m.file));
    if (canon.size > 1) add(3, 'meta-unique', ms.map(m => m.file).join(', '), d, `one description on ${canon.size} canonical pages`);
  }
  const list = [...items.values()].sort((a, b) => a.tier - b.tier || a.family.localeCompare(b.family) || a.where.localeCompare(b.where));
  const count = (t) => list.filter(x => x.tier === t).length;
  return { items: list, tiers: { 1: count(1), 2: count(2), 3: count(3) }, reviewed: reviewedHits, allowlisted: allow.length };
}

function print(rep) {
  console.log(`claims-review: ${rep.items.length} to review (Tier 1: ${rep.tiers[1]} · Tier 2: ${rep.tiers[2]} · Tier 3: ${rep.tiers[3]}), ${rep.reviewed} reviewed and unchanged (claims-reviewed.json holds ${rep.allowlisted})`);
  for (const it of rep.items) {
    console.log(`T${it.tier} ${it.family.padEnd(18)} ${it.where}${it.also.length ? ` (+${it.also.length} more)` : ''}  "${it.text}"${it.why ? `  (${it.why})` : ''}  [${it.hash}]`);
  }
}

/* ─── SELF-TEST ──────────────────────────────────────────────────────────── */
function selfTest() {
  let bad = 0;
  const t = (cond, what) => { if (cond) console.log(`ok    ${what}`); else { bad++; console.error(`FAIL  ${what}`); } };
  const page = (...ps) => `<div class="view">${ps.map(p => `<p>${p}</p>`).join('')}</div>`;
  const MUST = {
    'Returns are guaranteed.': 'guarantee',
    'PCHEM sits at a 69% discount to its base-case model estimate.': 'valuation-verdict',
    'Largest differences between market price and model estimate': 'market-price',
    'Amended filings create a new version; history is never overwritten.': 'absolute',
    'Share of the renovation a buyer will pay for at exit (%)': 'will-outcome',
    'Most property tools show you what things sold for.': 'comparative',
    'This models true acquisition cost, financing and tax.': 'accuracy',
    'The ones at the top are where a valuer or a rental appraisal is worth paying for.': 'advice',
    'Business planning is next.': 'roadmap',
    'Monitor my existing portfolio': 'monitor',
    'Companies with material exposure to the Sarawak economy': 'exposure',
    'The flag is carried from the source, not assessed here.': 'provenance',
  };
  const NOT = [
    'a match is recorded, never sent',
    'nothing here is ranked',
    'never a market figure',
    'No licensed transactions or listings ship here',
    'Four rents kept apart, never blended',
    'Risk-free rate plus beta times the equity risk premium',
    'A journey proves that the path works on the live site, not that any figure on it is accurate',
    'None of this is a guarantee, and no indicator here is claimed to work',
  ];
  const tree = (extra = {}) => ({
    renders: [
      { file: 'prerender/a.html', html: page(...Object.keys(MUST), ...NOT, 'Every formula used anywhere in this prototype is published here.', 'AAPL · illustrative, TENAGA · illustrative', 'Cash required upfront RM107,211') },
      { file: 'prerender/status.html', html: page('Seven fee lines carry placeholder values pending verification against the Solicitors’ Remuneration Order 2023.') },
      { file: 'prerender/data-sources.html', html: '<h3>Held for reference: another jurisdiction’s rule</h3><p>Solicitors’ Remuneration Order 2023 — Not applied.</p>' },
    ],
    metas: [{ file: 'pages/learn.html', description: 'How the metrics are defined.', canonical: 'https://x/learn' },
            { file: 'pages/corrections.html', description: 'How the metrics are defined.', canonical: 'https://x/corrections' },
            { file: 'pages/wheel.html', description: 'A wheel.', canonical: 'https://x/us-options/wheel' },
            { file: 'pages/cash-wheel.html', description: 'A wheel.', canonical: 'https://x/us-options/wheel' }],
    modules: [{ file: 'src/js/x.js', text: "/* Returns are guaranteed in a comment. */\nconst a = 'You can’t lose with this.';\nconst b = 'Every figure shows its formula.';" }],
    filers: new Set(['AAPL']),
    allow: [],
    ...extra,
  });
  const rep = review(tree());
  const has = (fam, re) => rep.items.some(x => x.family === fam && re.test(x.text));
  for (const [s, fam] of Object.entries(MUST)) if (fam) t(has(fam, new RegExp(s.slice(0, 20).replace(/[.*+?^${}()|[\]\\%]/g, '\\$&'))), `flags "${s}" as ${fam}`);
  t(has('absolute', /anywhere in this prototype/), 'flags "Every formula used anywhere in this prototype is published here." (absolute)');
  t(rep.items.some(x => x.family === 'retired-reference' && /Seven fee lines/.test(x.text)), 'flags "Seven fee lines … Solicitors’ Remuneration Order 2023" outside the rulebook (Tier 3)');
  t(!rep.items.some(x => x.family === 'retired-reference' && x.where === 'prerender/data-sources.html'), 'keeps the Order in the fee rulebook on /data-sources, which says it is not applied');
  t(rep.items.some(x => x.family === 'label-agreement' && /AAPL/.test(x.text)) && !rep.items.some(x => x.family === 'label-agreement' && /TENAGA/.test(x.text)), 'flags "AAPL · illustrative" where us.json holds AAPL, and not TENAGA');
  t(rep.items.some(x => x.family === 'meta-unique' && /learn/.test(x.where)) && !rep.items.some(x => x.family === 'meta-unique' && /wheel/.test(x.where)), 'flags one description on two canonical pages, not on two addresses of one page');
  t(rep.items.some(x => x.family === 'definition'), 'flags "Cash required upfront" (Tier 3 definition)');
  t(has('cannot-lose', /can’t lose/) && !rep.items.some(x => x.where === 'src/js/x.js' && x.family === 'guarantee'), 'reads a module’s strings, not its comments');
  t(!has('absolute', /^Every figure shows/), 'reads absolute words where they are served, not in a module’s strings');
  for (const s of NOT) t(!rep.items.some(x => x.text === s || x.text.startsWith(s)), `does not flag "${s}"`);
  /* The allowlist: a reviewed sentence is not flagged; one word changed, it is. */
  const s = 'Every formula used anywhere in this prototype is published here.';
  const rep2 = review(tree({ allow: [{ hash: hashOf(s), text: s, reason: 'fixture', reviewer: 'self-test', date: '2026-10-12' }] }));
  t(!rep2.items.some(x => x.text === s) && rep2.reviewed >= 1, 'a reviewed sentence is not flagged again');
  const changed = tree({ allow: [{ hash: hashOf(s), text: s, reason: 'fixture', reviewer: 'self-test', date: '2026-10-12' }] });
  changed.renders[0].html = changed.renders[0].html.replace(s, 'Every formula used anywhere in this product is published here.');
  t(review(changed).items.some(x => /anywhere in this product is published/.test(x.text)), 'one word changed, it is flagged again');
  /* The exit codes, on a tree on disk. */
  const dir = mkdtempSync(join(tmpdir(), 'qt-claims-'));
  try {
    const put = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
    put('prerender/a.html', page('Every formula used anywhere in this prototype is published here.'));
    put('pages/a.html', '<meta name="description" content="A page."><link rel="canonical" href="https://x/a">');
    put('src/js/a.js', "const a = 'Nothing here is ranked.';");
    put('data/us.json', JSON.stringify({ results: [{ id: 'AAPL' }] }));
    put(ALLOWLIST, JSON.stringify({ reviewed: [] }));
    const run = (...a) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', dir, ...a], { encoding: 'utf8' });
    const r0 = run();
    t(r0.status === 0 && /1 to review/.test(r0.stdout), `a run with a flag exits 0 (${r0.status}): "${(r0.stdout.split('\n')[0] || '').slice(0, 80)}"`);
    const r1 = run('--strict');
    t(r1.status === 0, `--strict with no Tier 1 hit exits 0 (${r1.status})`);
    put('prerender/b.html', page('Returns are guaranteed.'));
    const r2 = run('--strict');
    t(r2.status === 1, `--strict with a Tier 1 hit exits 1 (${r2.status})`);
    rmSync(join(dir, 'data'), { recursive: true, force: true });
    const r3 = run();
    t(r3.status === 2 && /data\/us\.json is missing/.test(r3.stderr), `a missing input exits 2 and is named (${r3.status}: ${(r3.stderr || '').trim().slice(0, 70)})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(bad ? `\n${bad} self-test check(s) failed` : '\nself-test: what must be flagged is, the truthful denials are not, the allowlist holds by sentence, and the exit codes are 0, 1 only on Tier 1 under --strict, and 2 on a missing input');
  return bad ? 1 : 0;
}

/* ─── MAIN ───────────────────────────────────────────────────────────────── */
if (argv.includes('--self-test')) process.exit(selfTest());
let tree;
try { tree = readTree(flag('root') || HERE); }
catch (e) { if (e.missing) { console.error(`claims-review: ${e.message}`); process.exit(2); } throw e; }
const rep = review(tree);
if (argv.includes('--json')) console.log(JSON.stringify(rep, null, 2)); else print(rep);
process.exit(argv.includes('--strict') && rep.tiers[1] > 0 ? 1 : 0);
