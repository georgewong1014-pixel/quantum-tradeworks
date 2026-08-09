#!/usr/bin/env node
/**
 * QT Trading Index — screenshot extraction assistant (specification §15, §22 phase 2)
 *
 *   ANTHROPIC_API_KEY=... node qtti/extract.mjs
 *   node qtti/extract.mjs --file qtti/screenshots/btc.png
 *   node qtti/extract.mjs --model claude-sonnet-5      cheaper for bulk runs
 *   node qtti/extract.mjs --dry-run                    show the plan, call nothing
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT PRODUCES A DRAFT. IT DOES NOT PRODUCE A SCORE.
 *
 * §22 puts extraction in phase 2 and §6 is explicit about the relationship: the
 * model may SUGGEST a state, and a person must be able to correct it before the
 * run is finalised. So this writes qtti/observations.draft.json with every asset
 * marked `"confirmed": false`, and batch.mjs refuses to score an unconfirmed
 * asset. Reading a chart badly and reading it well produce equally confident
 * JSON, and the only thing standing between the two is a person looking.
 *
 * That refusal is the whole design. An extraction pipeline that flowed straight
 * into a score would let a misread candle become a trend regime, and the trend
 * regime is what the tranche gate reads.
 *
 * ORDINAL STATES ONLY
 *
 * The model returns one of the five states, or unknown. It never returns the
 * analyst numbers §14 uses — those are a human refinement within the scale, and
 * a model emitting 65 rather than "bullish" would be inventing precision the
 * image cannot support.
 *
 * WHAT IT REFUSES TO GUESS
 *
 * Unknown is a first-class answer here, not a failure. An indicator whose name
 * and settings are not visible is listed and ignored rather than inferred from
 * its colour; a benchmark that is not on the chart makes relative strength
 * unknown rather than neutral. Unknown costs coverage in the engine, which is
 * the correct price — §6 forbids reweighting it away precisely so a partly
 * legible chart cannot look decisive.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

/* Chart reading is a visual discrimination task whose output feeds a scoring
   model, so the default is the most capable model rather than the cheapest.
   --model claude-sonnet-5 is the sensible trade for a large weekly batch. */
const MODEL   = flag('model', 'claude-opus-5');
const SHOTS   = resolve(ROOT, flag('dir', 'qtti/screenshots'));
const OUT     = resolve(ROOT, flag('out', 'qtti/observations.draft.json'));
const ONE     = flag('file', null);
const LIMIT   = Number(flag('concurrency', 3));
const DRY     = has('dry-run');

const MEDIA = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                '.webp':'image/webp', '.gif':'image/gif' };

/* ------------------------------------------------------------ the contract -- */

/* §15.2 verbatim, then the vocabulary the engine actually consumes. The
   specification wrote this prompt; it is not paraphrased here, because the
   instruction not to call oversold bullish and the instruction not to infer an
   indicator from colour are the two failure modes that matter most. */
const SYSTEM = `You are extracting technical evidence, not recommending a trade.

For each visible panel:
1. Read the exact symbol, instrument, venue, quote currency and timeframe.
2. Read the visible OHLC and candle timestamp when legible.
3. Identify each indicator only when its name/settings are visible or supplied.
4. Classify price structure, trend location, momentum, volume and conflicts.
5. Return Unknown for anything not clearly supported.
6. Do not infer numeric indicator values from colour alone.
7. Do not call oversold bullish without price and momentum confirmation.
8. Record visual support/resistance only as estimated ranges.
9. State every reason confidence is reduced.
10. Produce structured JSON only; no buy/sell instruction.

THE SIX EVIDENCE GROUPS, per timeframe. Each takes one ordinal state.

  priceStructure   Higher highs and higher lows, lower highs and lower lows, a
                   range, or a break? Do not score the still-open candle as a
                   completed swing.
  trendReferences  Where is price against the major moving averages or cloud,
                   and are those rising or falling? A cloud observation must not
                   be counted again as a second moving-average signal.
  momentum         Positive or negative, improving or deteriorating, and is
                   there a divergence? Completed bars only. Oversold alone is
                   not bullish.
  volume           Does participation confirm the move, or warn of weak
                   conviction or distribution? Without a readable volume average
                   you cannot claim a ratio.
  relativeStrength Is it outperforming a benchmark VISIBLE ON THE CHART? If no
                   benchmark comparison is shown, this is unknown — never infer
                   it from the asset's own chart.
  confirmation     How many of the other groups actually agree with each other?

STATES: strong_bearish, bearish, neutral, bullish, strong_bullish, unknown.
Direction is stated for a LONG reading throughout; a short case mirrors it and
is not your concern here.

Unknown is a correct and expected answer. It costs coverage in the scoring model
rather than being reweighted away, which is deliberate — a partly legible chart
must not be able to look decisive. Prefer unknown to a guess, every time.

CONFIDENCE, 0-100, describes how much of the result THIS IMAGE can support. It
is extraction reliability, never market predictability:
  metadata    symbol, instrument, venue and currency legibility
  panels      are all three of daily, weekly and monthly present and complete
  indicators  are the indicators named with their settings, or anonymous shapes
  legibility  price and indicator scales readable
  recency     candle time and capture time establishable and consistent

You are never asked whether this is a good trade, and you must not say.`;

const STATE_ENUM = ['strong_bearish', 'bearish', 'neutral', 'bullish', 'strong_bullish', 'unknown'];

const group = (name) => ({
  type: 'object',
  required: ['state', 'why', 'confidence'],
  additionalProperties: false,
  properties: {
    state: { type: 'string', enum: STATE_ENUM, description: `The ${name} state.` },
    why: { type: 'string', description: 'What in the image supports this, in one sentence. If unknown, what was missing.' },
    confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'How legible this particular reading was.' },
  },
});

const panel = (tf) => ({
  type: 'object',
  required: ['present', 'priceStructure', 'trendReferences', 'momentum', 'volume', 'relativeStrength', 'confirmation'],
  additionalProperties: false,
  properties: {
    present: { type: 'boolean', description: `Is a ${tf} panel visible and readable at all?` },
    latestBarAt: { type: ['string', 'null'], description: 'Date/time of the latest COMPLETED bar, if legible.' },
    priceStructure: group('price structure'),
    trendReferences: group('trend reference'),
    momentum: group('momentum'),
    volume: group('volume and participation'),
    relativeStrength: group('relative strength'),
    confirmation: group('confirmation or conflict'),
    estimatedSupport: { type: 'string', description: 'Visually estimated support as a RANGE, or empty if not readable.' },
    estimatedResistance: { type: 'string', description: 'Visually estimated resistance as a RANGE, or empty if not readable.' },
  },
});

const TOOL = {
  name: 'record_chart_evidence',
  description: 'Record what is visible in the chart screenshot. Ordinal states only, unknown wherever the image does not support a reading.',
  input_schema: {
    type: 'object',
    required: ['identity', 'daily', 'weekly', 'monthly', 'confidence', 'unknownIndicators', 'reducedConfidenceBecause'],
    additionalProperties: false,
    properties: {
      identity: {
        type: 'object',
        required: ['symbol', 'instrumentType', 'priceBasis', 'panelsSameInstrument', 'panelsCropped'],
        additionalProperties: false,
        properties: {
          symbol: { type: ['string', 'null'], description: 'Exactly as printed on the chart.' },
          instrumentType: { type: 'string', enum: ['ordinary_share', 'etf', 'spot_asset', 'option', 'future', 'perpetual', 'unknown'] },
          venue: { type: ['string', 'null'] },
          quoteCurrency: { type: ['string', 'null'] },
          priceBasis: { type: 'string', enum: ['close', 'last', 'mark', 'index', 'unknown'] },
          capturedAt: { type: ['string', 'null'], description: 'Screenshot capture time if a clock is visible, ISO-like.' },
          panelsSameInstrument: { type: 'boolean', description: 'Do all visible panels show the SAME instrument and the same price basis? False if you cannot confirm it.' },
          panelsCropped: { type: 'boolean', description: 'Is any panel cut off before the latest price or the indicator scale?' },
        },
      },
      daily: panel('daily'),
      weekly: panel('weekly'),
      monthly: panel('monthly'),
      confidence: {
        type: 'object',
        required: ['metadata', 'panels', 'indicators', 'legibility', 'recency'],
        additionalProperties: false,
        properties: {
          metadata: { type: 'integer', minimum: 0, maximum: 100 },
          panels: { type: 'integer', minimum: 0, maximum: 100 },
          indicators: { type: 'integer', minimum: 0, maximum: 100 },
          legibility: { type: 'integer', minimum: 0, maximum: 100 },
          recency: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
      unknownIndicators: {
        type: 'array', items: { type: 'string' },
        description: 'Every indicator or shape whose identity and settings you could NOT establish. These are listed and ignored, never scored.',
      },
      reducedConfidenceBecause: {
        type: 'array', items: { type: 'string' },
        description: 'Every reason confidence is below 100. Required by §15.2 rule 9.',
      },
    },
  },
};

/* ----------------------------------------------------------------- the API -- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildRequest(imgB64, mediaType, hint) {
  return {
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_chart_evidence' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imgB64 } },
        { type: 'text', text:
          `Extract the technical evidence visible in this chart screenshot.\n\n`
          + `File name, as a hint only — trust the image over it: ${hint}\n\n`
          + `Return unknown for anything the image does not clearly support. If a panel for a `
          + `timeframe is absent, set its present to false and leave every group unknown.` },
      ],
    }],
  };
}

/* A canned response in the tool's own shape. --simulate runs the whole pipeline
   with this instead of an API call, which is how the draft format and the
   batch runner's refusal were verified without spending one, and how anyone
   without a key can see exactly what they will get. It is deliberately a
   partly-unreadable chart: two unknowns and a middling confidence, because the
   interesting path is the one where the model declines to guess. */
function simulatedResponse(hint) {
  const g = (state, why, confidence) => ({ state, why, confidence });
  return {
    data: {
      identity: {
        symbol: 'SIMULATED / NOT A REAL EXTRACTION', instrumentType: 'spot_asset',
        venue: 'simulated', quoteCurrency: 'USD', priceBasis: 'unknown',
        capturedAt: null, panelsSameInstrument: true, panelsCropped: false,
      },
      daily: { present: true, latestBarAt: null,
        priceStructure: g('bullish', 'Higher low formed against the prior swing.', 75),
        trendReferences: g('neutral', 'Price sits between two averages whose slope is unclear.', 55),
        momentum: g('bullish', 'Oscillator rising through its midline on completed bars.', 70),
        volume: g('neutral', 'No volume average is printed, so no ratio can be claimed.', 40),
        relativeStrength: g('unknown', 'No benchmark comparison is shown on the chart.', 0),
        confirmation: g('neutral', 'Structure and momentum agree; volume does not confirm.', 60),
        estimatedSupport: '62,200–63,000', estimatedResistance: '66,500–67,000' },
      weekly: { present: true, latestBarAt: null,
        priceStructure: g('bearish', 'Lower high remains intact after the peak.', 70),
        trendReferences: g('bearish', 'Price under overhead cloud resistance.', 65),
        momentum: g('neutral', 'Momentum below midline but curling upward.', 60),
        volume: g('bearish', 'Recoveries occur on lighter volume than declines.', 55),
        relativeStrength: g('unknown', 'No benchmark comparison is shown.', 0),
        confirmation: g('bearish', 'Stabilising, but bullish evidence is not aligned.', 60),
        estimatedSupport: '', estimatedResistance: '' },
      monthly: { present: false, latestBarAt: null,
        priceStructure: g('unknown', 'No monthly panel is visible in this image.', 0),
        trendReferences: g('unknown', 'No monthly panel is visible.', 0),
        momentum: g('unknown', 'No monthly panel is visible.', 0),
        volume: g('unknown', 'No monthly panel is visible.', 0),
        relativeStrength: g('unknown', 'No monthly panel is visible.', 0),
        confirmation: g('unknown', 'No monthly panel is visible.', 0),
        estimatedSupport: '', estimatedResistance: '' },
      confidence: { metadata: 70, panels: 55, indicators: 35, legibility: 75, recency: 30 },
      unknownIndicators: ['An unnamed purple band overlay', 'Two coloured markers with no legend'],
      reducedConfidenceBecause: [
        'No monthly panel is present, so the structural regime cannot be read.',
        'Several indicators are unnamed and their settings are not printed.',
        'No capture time or candle timestamp is legible.',
        'No benchmark is shown, so relative strength is unknown on every timeframe.',
      ],
    },
    usage: { input_tokens: 0, output_tokens: 0, simulated: true },
  };
}

async function callModel(imgB64, mediaType, hint) {
  if (has('simulate')) return simulatedResponse(hint);
  const body = buildRequest(imgB64, mediaType, hint);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });

    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(60, 2 ** attempt) * 1000;
      if (attempt === 5) throw new Error(`${res.status} after 5 attempts: ${(await res.text()).slice(0, 200)}`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);

    const json = await res.json();
    const block = (json.content || []).find(c => c.type === 'tool_use');
    if (!block) throw new Error('model returned no tool_use block');
    return { data: block.input, usage: json.usage || {} };
  }
}

/* -------------------------------------------------------------- draft build -- */

const GROUPS = ['priceStructure', 'trendReferences', 'momentum', 'volume', 'relativeStrength', 'confirmation'];

/* The engine's observation shape, plus the extraction record beside it. Every
   asset lands confirmed:false; batch.mjs will not score it until a person has
   read it and changed that. */
function toDraft(x, meta) {
  const id = x.identity || {};
  const panelOut = (p) => {
    if (!p) return { present: false };
    const o = { present: !!p.present };
    GROUPS.forEach(g => { o[g] = (p[g] && p[g].state) || 'unknown'; });
    return o;
  };
  const why = (p) => {
    if (!p) return {};
    const o = {};
    GROUPS.forEach(g => { if (p[g]) o[g] = `${p[g].state} (${p[g].confidence}) — ${p[g].why}`; });
    if (p.estimatedSupport) o.support = p.estimatedSupport;
    if (p.estimatedResistance) o.resistance = p.estimatedResistance;
    return o;
  };

  return {
    confirmed: false,
    symbol: id.symbol || meta.file,
    instrumentType: id.instrumentType && id.instrumentType !== 'unknown' ? id.instrumentType : 'spot_asset',
    venue: id.venue || '',
    quoteCurrency: id.quoteCurrency || '',
    priceBasis: id.priceBasis || 'unknown',
    capturedAt: id.capturedAt || '',
    screenshot: meta.file,
    screenshotHash: meta.hash,
    /* Never true from extraction. §5.4 makes panel identity a rejection gate, and
       a model saying the panels match is not a person having checked. */
    identityConsistent: false,
    panelsCropped: !!id.panelsCropped,
    unknownIndicators: (x.unknownIndicators || []).join('; '),
    template: 'trend_continuation',
    entryLocation: 'unknown',
    daily: panelOut(x.daily),
    weekly: panelOut(x.weekly),
    monthly: panelOut(x.monthly),
    confidence: x.confidence || {},
    _extraction: {
      model: MODEL,
      extractedAt: new Date().toISOString(),
      modelSaysPanelsMatch: !!id.panelsSameInstrument,
      reducedConfidenceBecause: x.reducedConfidenceBecause || [],
      reasoning: { daily: why(x.daily), weekly: why(x.weekly), monthly: why(x.monthly) },
      usage: meta.usage,
    },
    _confirmBeforeScoring: [
      'Read each state against the image yourself and correct what is wrong.',
      'Set identityConsistent true only once YOU have checked all three panels show the same instrument and price basis.',
      'Set tradingStatusClear, and the assetThesis or equityThesisStatus gate.',
      'Set entryLocation, triggerComplete, and your own plan figures.',
      'Then set confirmed: true. batch.mjs will not score this asset until you do.',
    ],
  };
}

/* -------------------------------------------------------------------- main -- */

let files = [];
if (ONE) files = [resolve(ROOT, ONE)];
else {
  if (!existsSync(SHOTS)) {
    console.error(`No screenshot directory at ${SHOTS}`);
    console.error('Create it and drop your chart images in. It is git-ignored.');
    process.exit(1);
  }
  files = (await readdir(SHOTS)).filter(f => MEDIA[extname(f).toLowerCase()]).map(f => join(SHOTS, f)).sort();
}
if (!files.length) { console.error('No images found.'); process.exit(1); }

/* Before the banner, so stdout carries only the JSON and the dump can be piped. */
if (has('print-request')) {
  console.log(JSON.stringify(buildRequest('<base64 image omitted>', 'image/png', basename(files[0])), null, 2));
  process.exit(0);
}

console.log(`model      ${MODEL}`);
console.log(`images     ${files.length}`);
console.log(`output     ${OUT}`);
console.log(`\nExtraction produces a DRAFT. batch.mjs will refuse to score any asset until you`);
console.log(`have read it against the image and set confirmed: true.\n`);

if (DRY) { files.forEach(f => console.log(`  would send ${basename(f)}`)); process.exit(0); }


if (has('simulate')) console.log('SIMULATE — no API call. Canned response, to show the shape.\n');
else if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  console.error('Put it in .env (git-ignored) and export it, or pass it inline for one run.');
  process.exit(1);
}

const results = [];
let done = 0, failed = 0;

async function work(path) {
  const file = basename(path);
  try {
    const buf = await readFile(path);
    if (buf.length > 5 * 1024 * 1024)
      throw new Error(`${(buf.length / 1048576).toFixed(1)}MB exceeds the 5MB image limit — downscale it`);
    const hash = createHash('sha256').update(buf).digest('hex');
    const media = MEDIA[extname(file).toLowerCase()];
    const { data, usage } = await callModel(buf.toString('base64'), media, file);
    results.push(toDraft(data, { file, hash, usage }));
    done++;
    const conf = data.confidence || {};
    const avg = Math.round((conf.metadata + conf.panels + conf.indicators + conf.legibility + conf.recency) / 5);
    console.log(`  ok    ${file}  ${data.identity?.symbol || '(no symbol read)'}  ~conf ${avg}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${file}  ${e.message}`);
  }
}

/* A small pool. Fifty images at once would rate-limit and tell you nothing
   useful about which one failed. */
const queue = [...files];
await Promise.all(Array.from({ length: Math.min(LIMIT, queue.length) }, async () => {
  while (queue.length) await work(queue.shift());
}));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  _draft: true,
  _readme: [
    'DRAFT — extracted by a model, not confirmed by a person.',
    'batch.mjs refuses to score any asset whose confirmed flag is not true.',
    'Read each asset against its screenshot, correct the states, complete the gate',
    'fields listed in _confirmBeforeScoring, then set confirmed: true.',
    '_extraction holds the model reasoning and is ignored by the scorer.',
  ],
  extractedAt: new Date().toISOString(),
  model: MODEL,
  assets: results,
}, null, 2), 'utf8');

const tok = results.reduce((a, r) => a + (r._extraction.usage?.input_tokens || 0), 0);
const otok = results.reduce((a, r) => a + (r._extraction.usage?.output_tokens || 0), 0);
console.log(`\n${done} extracted, ${failed} failed · ${tok} input / ${otok} output tokens`);
console.log(`wrote ${OUT}`);
console.log(`\nNothing is scored yet. Every asset is confirmed: false.`);
process.exit(failed && !done ? 1 : 0);
