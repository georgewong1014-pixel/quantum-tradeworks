/* ==========================================================================
   THE INVESTMENT POLICY STATEMENT — THE GOVERNING DOCUMENT
   --------------------------------------------------------------------------
   Until now this product had several methodology backbones and no master. The
   property grade, the research composite, the wheel fit and the trading index
   each carried their own idea of what a gate was, what evidence meant and what
   a refusal was for. They mostly agreed, which is worse than disagreeing — it
   meant nobody had to check.

   This is the spine. Every asset is assessed against the SAME eight gates in
   the same order, and each asset's own engine supplies the answers. When the
   property calculator and the equity scorecard both say "capital requirement",
   they now mean the same question.

   ONE DEVIATION FROM THE IPS AS WRITTEN, AND IT IS DELIBERATE.

   Section 8 of the IPS requires every decision to state "Buy, Watch/Hold or
   Reject", and section 10 calls the output a recommendation. This product
   cannot publish either. It is research only: it holds no licence to advise, it
   asks no suitability question, and the disclosure on every page, the pricing
   page and the product-boundaries page all rest on that. A Buy button would
   make those pages false.

   The SUBSTANCE is kept in full and only the verb changes:

     IPS "Reject"       -> a hard gate that refuses to produce an assessment.
                           Already how this product works. Refusing to answer is
                           not advice; it is the absence of one.
     IPS "Buy"          -> "Meets every condition in the methodology." A
                           statement about the analysis, not an instruction to
                           the reader. Same information, no directive.
     IPS "Watch/Hold"   -> "Conditions not yet met — N outstanding", naming them.

   Nothing is softened. A reader learns exactly what the IPS would have told
   them; they are simply told it about the evidence rather than about
   themselves, which is the only form this product is entitled to use.
   ========================================================================== */

const IPS_VERSION = 'IPS 1.0 · 20 August 2026';

/* ---- §2 core philosophy, in the order the IPS states it ---- */
const IPS_PRINCIPLES = [
  { n: 1, t: 'Capital preservation before return maximisation',
    d: 'Avoid permanent impairment before pursuing upside.' },
  { n: 2, t: 'Evidence before narrative',
    d: 'Claims must rest on financial statements, filings, market data, verified transactions or authoritative public data.' },
  { n: 3, t: 'Value is future economics, not a previous high price',
    d: 'A large historical decline does not by itself create a bargain.' },
  { n: 4, t: 'Cash flow is net of realistic costs',
    d: 'Headline yield and gross profit are insufficient.' },
  { n: 5, t: 'Real demand must exist',
    d: 'Durable customer demand and business economics for equities; occupier, tenant and resale demand for property.' },
  { n: 6, t: 'Entry price matters',
    d: 'A good asset can be a poor investment bought without a margin of safety.' },
  { n: 7, t: 'Liquidity and exit are analysed before entry',
    d: 'Who the future buyer may be, and what would trigger a sale.' },
  { n: 8, t: 'Risk is managed by rejection, sizing, tranches and diversification',
    d: 'Not by confidence.' },
  { n: 9, t: 'Every position requires an invalidation condition',
    d: 'If the thesis breaks, it is reassessed.' },
  { n: 10, t: 'All investments compete for capital',
    d: 'Property is compared with equities and cash on risk-adjusted, after-cost returns.' },
];

/* ---- §3 the universal decision process ----
   Eight gates, one order, every asset. `ask` is the question in the reader's
   words; an asset engine answers it with a verdict, not a score. */
const IPS_GATES = [
  { id: 'eligibility', n: 1, label: 'Eligibility and investability',
    ask: 'Is the asset lawful, understandable, financeable and practically investable?' },
  { id: 'capital', n: 2, label: 'Capital requirement',
    ask: 'How much cash, financing capacity and liquidity buffer does it need?' },
  { id: 'demand', n: 3, label: 'Demand and quality',
    ask: 'What produces durable demand, revenue, rent or resale interest?' },
  { id: 'engine', n: 4, label: 'Return engine',
    ask: 'What actually generates the return?' },
  { id: 'net', n: 5, label: 'Net economics',
    ask: 'What is left after financing, tax, vacancy, fees, maintenance and dilution?' },
  { id: 'margin', n: 6, label: 'Valuation and margin of safety',
    ask: 'Is the entry price sufficiently below a conservatively estimated value?' },
  { id: 'execution', n: 7, label: 'Execution plan',
    ask: 'Entry level, tranches, position size, risk limit and monitoring conditions?' },
  { id: 'exit', n: 8, label: 'Exit and liquidity',
    ask: 'Who may buy later, how liquid is the market, and what triggers a change?' },
];
const IPS_GATE_BY_ID = Object.fromEntries(IPS_GATES.map(g => [g.id, g]));

/* A gate verdict. Four states and no fifth, because "probably fine" is the
   state that lets an unexamined asset through. */
const IPS_VERDICTS = {
  pass:      { id: 'pass',      label: 'Answered',      tone: 'chip chip-ok',     rank: 3 },
  partial:   { id: 'partial',   label: 'Partly answered', tone: 'chip',           rank: 2 },
  unknown:   { id: 'unknown',   label: 'Not established', tone: 'chip chip-bronze', rank: 1 },
  fail:      { id: 'fail',      label: 'Fails',         tone: 'chip chip-critical',     rank: 0 },
};

/* Build one gate's answer. `why` must always be present: a verdict without a
   reason is a rating, and this product does not publish those. */
const ipsAnswer = (id, verdict, why, detail) =>
  ({ gate: IPS_GATE_BY_ID[id], id, verdict: IPS_VERDICTS[verdict] || IPS_VERDICTS.unknown, why, detail: detail || null });

/* THE ASSESSMENT. Not a score, and deliberately not a recommendation.

   `state` is the IPS section 8 decision expressed in this product's vocabulary:
     refused   — a hard gate failed. The IPS calls this Reject.
     met       — every gate answered, none failing. The IPS calls this Buy.
     open      — gates outstanding. The IPS calls this Watch/Hold.

   The count of unanswered gates is the headline rather than a total, because a
   total lets four unanswered questions average away against four answered ones. */
function ipsAssess(answers) {
  const list = IPS_GATES.map(g => answers.find(a => a.id === g.id)
    || ipsAnswer(g.id, 'unknown', 'No engine supplied an answer to this gate for this asset.'));
  const failing = list.filter(a => a.verdict.id === 'fail');
  const open = list.filter(a => a.verdict.id === 'unknown' || a.verdict.id === 'partial');

  const state = failing.length ? 'refused' : (open.length ? 'open' : 'met');
  const sentence = failing.length
    ? `Refused at ${failing.length === 1 ? 'one gate' : `${failing.length} gates`}: `
      + `${failing.map(f => f.gate.label.toLowerCase()).join(', ')}. `
      + 'A failing gate is not a deduction. No assessment is produced while it stands.'
    : open.length
      ? `${8 - open.length} of 8 gates answered. Outstanding: `
        + `${open.map(o => o.gate.label.toLowerCase()).join(', ')}.`
      : 'All eight gates answered and none failing. This asset meets every condition in the methodology.';

  return {
    answers: list, failing, open, state, sentence,
    answered: list.filter(a => a.verdict.id === 'pass').length,
    /* Deliberately NOT a 0-100 number. See the file header. */
  };
}

/* ---- §4 the evidence hierarchy, and how this product's ladder maps onto it ----
   The IPS names five tiers. This product already grades every figure it holds;
   this states which IPS tier each of its grades belongs to, so a reader can
   check the mapping rather than take it on trust. */
const IPS_EVIDENCE_TIERS = [
  { tier: 1, label: 'Regulatory filings, audited statements, official transaction data, legal documents',
    maps: ['verified'], note: 'In this product: SEC-filed statements, and a transacted price or signed tenancy you have seen.' },
  { tier: 2, label: 'Authoritative sources — Bursa, SEC, investor relations, BNM, NAPIC, JPPH',
    maps: ['public'], note: 'Published by an authority or a listed source. NAPIC and JPPH transaction data is named in the IPS and is not licensed to this product — see the data-sources page.' },
  { tier: 3, label: 'Reputable market-data providers and independently verified industry data',
    maps: [], note: 'No provider is licensed to this product. This tier is empty here, and saying so is more useful than implying it is full.' },
  { tier: 4, label: 'Agent, developer, management or channel checks — only with verification',
    maps: ['developer', 'user'], note: 'Quoted by a seller or their agent, or entered from your own knowledge.' },
  { tier: 5, label: 'Social media, promotional content, anecdote — leads, not proof',
    maps: ['estimated', 'assumed', 'illustrative_default'], note: 'Derived, defaulted or carried by this tool. Never evidence.' },
];

/* ---- §6.1 the mandatory property screening order ----
   The order is the control. An attractive price cannot hide an unfinanceable
   asset if financeability is answered first, and the whole point of fixing the
   sequence is that a reader cannot skip to the yield. */
const IPS_PROPERTY_ORDER = [
  { n: 1, id: 'loanability', label: 'Loanability and bank valuation',
    why: 'An asset a bank will not lend against at the price agreed is not cheap; it is unfinanceable. This is first because everything below is void if it fails.' },
  { n: 2, id: 'budget', label: 'Cash budget and financing capacity',
    why: 'What must actually be found in cash, and whether the borrower can carry it.' },
  { n: 3, id: 'demand', label: 'Real location demand',
    why: 'Who has a recurring reason to occupy or buy here.' },
  { n: 4, id: 'yield', label: 'Rental yield',
    why: 'Gross first, so the gap to net is visible rather than assumed away.' },
  { n: 5, id: 'netcash', label: 'Net cash flow',
    why: 'After every cost that actually recurs.' },
  { n: 6, id: 'discount', label: 'Buy-in discount and margin of safety',
    why: 'How far below a conservative value the entry price sits.' },
  { n: 7, id: 'valueadd', label: 'Renovation or value-add feasibility',
    why: 'Only value-add if the rent or resale benefit exceeds its full cost and risk.' },
  { n: 8, id: 'exit', label: 'Exit strategy and subsale liquidity',
    why: 'Who buys it next, and how long that takes.' },
];

/* ---- §6.9 the auto-reject conditions, verbatim in substance ----
   Held here rather than inside the property engine so the published list and
   the enforced list are one list. */
const IPS_PROPERTY_REJECTS = [
  { id: 'negcash', label: 'Severe or persistent negative cash flow' },
  { id: 'nodemand', label: 'Weak real tenant and owner-occupier demand' },
  { id: 'oversupply', label: 'Severe oversupply or excessive substitutability' },
  { id: 'management', label: 'Poor management or deteriorating common property' },
  { id: 'legal', label: 'Material legal, title or compliance complexity' },
  { id: 'valuation', label: 'Insufficient bank valuation or weak loanability' },
  { id: 'noexit', label: 'No credible exit market' },
  { id: 'apprec', label: 'Dependence on unsupported appreciation assumptions' },
  { id: 'promo', label: 'A promotional yield that cannot be independently verified' },
];

/* ---- §11 ---- */
/* The IPS states this as an imperative — "Buy only when…". Published here as
   the condition it describes rather than the instruction it gives, for the same
   reason section 8's decision is: this product may state what is true of an
   asset and may not tell a reader what to do about it. Every one of the five
   requirements survives the change; only the mood does. */
const IPS_ONE_SENTENCE =
  'An asset meets this methodology only when verified quality and real demand, conservative net economics, '
  + 'a sufficient margin of safety, manageable downside and a credible exit all exist at the same time.';
