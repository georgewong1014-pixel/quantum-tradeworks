/* ==========================================================================
   METRIC REGISTRY — one row per measure, and everything else a projection

   A measure used to be described in five objects across three files: its
   formula and missing-data text in FIELDS, its inputs in FIELD_INPUTS, its
   kind in FIELD_PROVENANCE, whether a business model can carry it in
   INAPPLICABLE, and its plain-language definition in METRIC_HELP — which
   covered ten of the thirty-four. Nothing held them together, so a measure
   could be screenable with no definition, or listed as needing lines it did
   not read, and no check would notice. Net margin was computed by the engine
   and published nowhere, because publishing meant editing five places.

   Each row below is the single statement of one measure: what it is at three
   depths, the arithmetic, the stored lines it reads, the unit, the period,
   the kind of figure it produces, the business models it does not apply to,
   and why it can be absent. FIELDS (the screener and the drawer),
   FIELD_INPUTS, FIELD_PROVENANCE, FIELD_SPAN, NM_WHY, INAPPLICABLE,
   ALSO_INAPPLICABLE, COVERAGE_KEYS, METRIC_HELP and the Learn dictionary are
   all built from it, so they cannot drift apart; equity-test checks that
   they agree with it key by key.

   What a row does not do is compute. derive() stays the one place a value
   is produced, and the registry says what that value is. A row for a measure
   the stored statements cannot support is still a row — marked blocked,
   with the line it needs — so the dictionary can say it is missing rather
   than leave a reader to wonder whether it was forgotten.

   Loaded after the formatting helpers (00-core) and before the engine
   (15-derivation), which reads INAPPLICABLE and COVERAGE_KEYS from here.
   ========================================================================== */

/* The seven categories the ratio library is organised by, then four the
   screener carries that a ratio library does not: payout and share-count
   measures, variability, price history and the composite scores. Order is
   display order on Learn. */
const METRIC_CATEGORIES = [
  { id: 'profitability', label: 'Profitability', note: 'What is left of revenue at each stage of the income statement.' },
  { id: 'returns',       label: 'Returns',       note: 'Profit against the capital that produced it.' },
  { id: 'liquidity',     label: 'Liquidity',     note: 'Whether short-term obligations are covered by short-term assets.' },
  { id: 'leverage',      label: 'Leverage',      note: 'What is owed, against what supports it.' },
  { id: 'growth',        label: 'Growth',        note: 'How the whole-company and per-share lines have moved.' },
  { id: 'cashflow',      label: 'Cash flow',     note: 'Whether reported profit arrives as cash, and what the business spends to keep going.' },
  { id: 'valuation',     label: 'Valuation',     note: 'The price against what the company earns, owns and generates. Every one needs a price.' },
  { id: 'income',        label: 'Income and capital return', note: 'Dividends and the share count.' },
  { id: 'stability',     label: 'Stability',     note: 'How steady the history is.' },
  { id: 'market',        label: 'Price history', note: 'Computed from observed closes only — imported or captured by you.' },
  { id: 'scores',        label: 'Composite scores', note: 'Outputs of the published scoring and valuation models, not statement lines.' },
];

/* The windows derive() reads, in words. */
const METRIC_PERIOD = {
  latest:  'Latest fiscal year, as reported',
  latestPx:'Latest fiscal year, against the price held',
  avgEq:   'Latest fiscal year, over the average of the latest two year-end equity balances',
  w5:      'Four-year window: the latest five reported years',
  yoy:     'Latest fiscal year against the one before it',
  w5count: 'Up to the latest five reported years',
  series:  'Every stored year of the share count',
  closes:  'Trailing twelve months of observed closes',
  sma:     'The latest 200 observed closes',
  model:   'Latest fiscal year, through the scoring or valuation model',
};

/* How each unit prints, and what the Learn dictionary calls it. */
const METRIC_UNIT = {
  pct:   { label: 'percent',   fmt: (dp) => (v) => fmtPct(v, dp) },
  x:     { label: 'multiple',  fmt: (dp) => (v) => fmtX(v, dp) },
  money: { label: 'billions, in the company’s reporting currency', fmt: () => (v, r) => r?.c ? fmtCap(v, r.c.ccy) : `${fmtNum(v, 1)}bn` },
  score: { label: 'score, 0–100', fmt: () => (v) => fmtNum(v, 0) },
  sd:    { label: 'percentage points (standard deviation)', fmt: () => (v) => fmtNum(v) },
  count: { label: 'years',     fmt: () => (v) => fmtNum(v, 0) },
};

/* The lines a blocked measure needs, named once so the dictionary, the
   drawer and the Learn data page say the same thing. None is in the
   ten-column statement tuple; ca, cl and intExp are resolved by the ingest
   but dropped before the tuple is written, and the rest are not ingested at
   all. Either way the shipped file cannot supply them until the ingest is
   widened and data/us.json regenerated. */
const TUPLE_BLOCK = 'The stored statements are ten lines wide — revenue, EBIT, net income, operating cash flow, capital expenditure, equity, debt, cash, shares and dividend per share — and this measure needs a line outside them. It is listed so its absence is visible, not computed from a stand-in.';

/* kind: 'calculated' — arithmetic on statement lines; 'market' — needs a
   price or price history; 'modelled' — an output of assumptions.
   counted: in the data-coverage denominator (COVERAGE_KEYS). Adding a key
   changes every company's coverage figure, so the new measures published in
   metrics 1.7.0 are deliberately not counted.
   na: business models the measure does not apply to. For a counted measure
   this is INAPPLICABLE (derive nulls the value and the denominator excludes
   it); for an uncounted one ALSO_INAPPLICABLE, and derive nulls it itself.
   span / spanLine: how many of the latest stored rows it reads, where more
   than one — metricStatus names a gap in any of them. */
const METRICS = [
  /* ---------------------------------------------------------- Business quality */
  { k: 'roic', g: 'Business quality', cat: 'returns', label: 'Return on invested capital',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, na: ['bank', 'insurer', 'early'],
    formula: 'EBIT × (1 − tax rate) ÷ (equity + debt − cash)', inputs: ['ebit', 'eq', 'debt', 'cash'], period: 'latest',
    miss: 'Not meaningful for banks — excluded rather than imputed.',
    nmWhy: 'Invested capital (equity plus debt less cash) is zero or negative.',
    help: { simple: 'How much profit the business earns from all the money in it — both shareholders’ and borrowed.',
      context: 'The cleanest single measure of whether a business is good, because it ignores how the company chose to finance itself. Not meaningful for banks, where borrowing is the raw material rather than the funding.',
      technical: 'Operating profit after tax ÷ (total debt + equity − cash). Excluded for deposit-taking institutions.' } },
  { k: 'om', g: 'Business quality', cat: 'profitability', label: 'Operating margin',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true,
    formula: 'EBIT ÷ revenue', inputs: ['ebit', 'rev'], period: 'latest',
    miss: 'Withheld where operating profit exceeds revenue — the two lines disagree.',
    nmWhy: 'Revenue is zero or negative.',
    help: { simple: 'Out of every ringgit of sales, how much is left after the costs of running the business.',
      context: 'Compare it only within an industry. A supermarket at 4% can be excellent and a software company at 20% can be poor — the cost structures are not alike.',
      technical: 'Operating profit ÷ revenue for the reported period.' } },
  { k: 'nm', g: 'Business quality', cat: 'profitability', label: 'Net margin',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true,
    formula: 'net income ÷ revenue', inputs: ['ni', 'rev'], period: 'latest',
    miss: 'Withheld where operating profit exceeds revenue, or where earnings and the dividend sit on different scales.',
    nmWhy: 'Revenue is zero or negative.',
    help: { simple: 'Out of every dollar or ringgit of sales, how much is left as profit for shareholders after every cost, interest and tax.',
      context: 'Lower than the operating margin by whatever interest, tax and one-off items take. A net margin far above the operating margin usually means a gain outside the business — a disposal, a tax credit — rather than a better business.',
      technical: 'Net income attributable to the company ÷ revenue, latest fiscal year. Withheld when EBIT exceeds revenue or the per-share figures disagree in scale.' } },
  { k: 'fcfm', g: 'Business quality', cat: 'cashflow', label: 'Free cash flow margin',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, na: ['bank'],
    formula: '(operating cash flow − capex) ÷ revenue', inputs: ['ocf', 'capex', 'rev'], period: 'latest',
    miss: 'Not computed for banks.',
    nmWhy: 'Revenue is zero or negative.',
    help: { simple: 'Out of every ringgit of sales, how much becomes cash the company can actually use.',
      context: 'Profit is an opinion, cash is a fact. A company reporting rising profit with falling free cash flow is the single most common warning sign in fundamental analysis.',
      technical: 'Operating cash flow less capital expenditure, ÷ revenue.' } },
  { k: 'ocfm', g: 'Business quality', cat: 'cashflow', label: 'Operating cash flow margin',
    unit: 'pct', dp: 1, kind: 'calculated', counted: false, na: ['bank'],
    formula: 'operating cash flow ÷ revenue', inputs: ['ocf', 'rev'], period: 'latest',
    miss: 'Not computed for banks, whose operating cash flow carries deposit and lending flows. Elsewhere withheld where operating profit exceeds revenue.',
    nmWhy: 'Revenue is zero or negative.',
    help: { simple: 'Out of every dollar or ringgit of sales, how much comes in as cash from running the business, before any spending on equipment or buildings.',
      context: 'Sits between the operating margin and the free cash flow margin. Well above the operating margin often means heavy depreciation or customers paying in advance; well below it, money tied up in stock and unpaid invoices.',
      technical: 'Net cash from operating activities ÷ revenue, latest fiscal year. Not computed for banks.' } },
  { k: 'fcf', g: 'Business quality', cat: 'cashflow', label: 'Free cash flow',
    unit: 'money', kind: 'calculated', counted: false, na: ['bank'], money: true,
    formula: 'operating cash flow − capital expenditure', inputs: ['ocf', 'capex'], period: 'latest',
    miss: 'Not computed for banks. Elsewhere it needs both lines — a missing capital-expenditure line leaves it unknown, never equal to operating cash flow.',
    help: { simple: 'The cash the business produced in the year after paying for the equipment and buildings it needs to keep going.',
      context: 'The money actually available for dividends, buybacks, debt repayment or acquisitions. Negative in a year of heavy investment is not by itself a warning; negative year after year is.',
      technical: 'Net cash from operating activities less payments for property, plant and equipment, latest fiscal year, in billions of the reporting currency. Not computed for banks.' } },
  { k: 'roe', g: 'Business quality', cat: 'returns', label: 'Return on equity',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, spanLine: { eq: 2 },
    formula: 'net income ÷ average shareholders’ equity', inputs: ['ni', 'eq'], period: 'avgEq',
    miss: 'Withheld where average equity is under 5% of revenue or changes sign, and where earnings and the dividend sit on different scales.',
    nmWhy: 'Average shareholders’ equity over the last two years is zero or negative, so a return on it has no meaning.',
    help: { simple: 'How much profit the company earns from the money shareholders have put in and left in.',
      context: 'Most useful for banks and insurers, where equity is the constraint on how much business can be written. Comparing a bank against an industrial company on this measure is comparing two different things — bank balance sheets are structured completely differently.',
      technical: 'Net income ÷ average shareholders’ equity, using opening and closing equity for the period.' } },
  { k: 'cashconv', g: 'Business quality', cat: 'cashflow', label: 'Cash conversion',
    unit: 'pct', dp: 0, kind: 'calculated', counted: true, na: ['bank'],
    formula: 'operating cash flow ÷ net income', inputs: ['ocf', 'ni'], period: 'latest',
    nmWhy: 'Net income is zero or negative, or operating cash flow exceeds fifteen times it — a ratio that measures a one-off, not conversion.',
    help: { simple: 'How much of the reported profit arrived as cash.',
      context: 'Persistently under 100% means profit is being booked faster than cash is collected — the pattern that precedes most earnings disappointments. Far above 100% is common for businesses with heavy depreciation.',
      technical: 'Operating cash flow ÷ net income, latest fiscal year. Not computed where net income is zero or negative, or the ratio exceeds 15×.' } },

  /* -------------------------------------------------- Growth and profitability */
  { k: 'rev5', g: 'Growth and profitability', cat: 'growth', label: 'Revenue CAGR (4y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, span: 5,
    formula: '(latest ÷ earliest)^(1/n) − 1', inputs: ['rev'], period: 'w5',
    miss: 'Null when the base period is non-positive.',
    nmWhy: 'The starting year’s revenue is zero or negative, so a compound growth rate has no meaning.',
    help: { simple: 'How fast sales have grown each year, on average, over the last four years.',
      context: 'A compound rate describes the two ends of the window and nothing between them — a company that fell and recovered can show the same rate as one that grew steadily. Read it beside the revenue drawdown.',
      technical: '(Latest revenue ÷ revenue four years earlier)^(1/4) − 1. Both endpoints must be reported and positive.' } },
  { k: 'revYoY', g: 'Growth and profitability', cat: 'growth', label: 'Revenue growth (1y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: false, span: 2,
    formula: 'latest revenue ÷ prior-year revenue − 1', inputs: ['rev'], period: 'yoy',
    miss: 'Needs both years reported.',
    nmWhy: 'The prior year’s revenue is zero or negative, so a percentage change from it has no meaning.',
    help: { simple: 'How much sales changed in the latest year compared with the year before.',
      context: 'One year is one observation: an acquisition, a disposal or a currency move can dominate it. The four-year rate is the steadier read; this one shows where the latest year sits against it.',
      technical: '(Revenue in the latest fiscal year ÷ revenue in the prior fiscal year) − 1. The prior year must be positive.' } },
  { k: 'eps5', g: 'Growth and profitability', cat: 'growth', label: 'Earnings CAGR (4y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, span: 5,
    formula: 'compound growth of earnings per share', inputs: ['ni', 'sh'], period: 'w5',
    miss: 'Per share, so withheld where a stock split sits inside the window. The whole-company rate beside it is not affected by a split.',
    nmWhy: 'The starting year’s earnings per share are zero or negative, so a compound growth rate has no meaning.',
    help: { simple: 'How fast profit per share has grown each year, on average, over the last four years.',
      context: 'What a shareholder actually receives, so buybacks raise it and share issuance lowers it. Share counts here are not adjusted for splits, so the rate is withheld across one rather than reporting the split as a collapse in earnings.',
      technical: '(Latest EPS ÷ EPS four years earlier)^(1/4) − 1, EPS = net income ÷ shares in issue. Withheld when the share count moves by more than 1.5× or less than 0.67× in a year.' } },
  { k: 'ni5', g: 'Growth and profitability', cat: 'growth', label: 'Net income CAGR (4y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: false, span: 5,
    formula: 'compound growth of net income', inputs: ['ni'], period: 'w5',
    miss: 'Whole-company earnings, so a stock split does not touch it — unlike the per-share rate. Withheld where earnings and the dividend sit on different scales.',
    nmWhy: 'The starting or latest year’s net income is zero or negative, so a compound growth rate has no meaning.',
    help: { simple: 'How fast the company’s total profit has grown each year, on average, over the last four years.',
      context: 'The earnings line before it is divided among shares. Where it grows faster than earnings per share, new shares have been issued; slower, shares have been bought back. It survives a stock split, which the per-share rate cannot.',
      technical: '(Latest net income ÷ net income four years earlier)^(1/4) − 1. Both endpoints must be reported and positive.' } },
  { k: 'niYoY', g: 'Growth and profitability', cat: 'growth', label: 'Net income growth (1y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: false, span: 2,
    formula: 'latest net income ÷ prior-year net income − 1', inputs: ['ni'], period: 'yoy',
    miss: 'Needs both years reported. Withheld where earnings and the dividend sit on different scales.',
    nmWhy: 'The prior year’s net income is zero or negative, so a percentage change from it has no meaning.',
    help: { simple: 'How much total profit changed in the latest year compared with the year before.',
      context: 'Net income carries one-off gains, write-downs and tax items, so a single year can swing far more than the business did. Read it beside the operating margin, which excludes most of them.',
      technical: '(Net income in the latest fiscal year ÷ net income in the prior fiscal year) − 1. The prior year must be positive.' } },
  { k: 'fcf5', g: 'Growth and profitability', cat: 'growth', label: 'Free cash flow CAGR (4y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, na: ['bank'], span: 5,
    formula: 'compound growth of free cash flow', inputs: ['ocf', 'capex'], period: 'w5',
    nmWhy: 'The starting year’s free cash flow is zero or negative, so a compound growth rate has no meaning.',
    help: { simple: 'How fast the cash left after investment has grown each year, on average, over the last four years.',
      context: 'Free cash flow is lumpy — one large project moves it more than a year of trading — so a compound rate over it is more sensitive to the choice of endpoints than revenue growth is.',
      technical: '(Latest free cash flow ÷ free cash flow four years earlier)^(1/4) − 1. Both endpoints must be reported and positive. Not computed for banks.' } },
  { k: 'dps5', g: 'Growth and profitability', cat: 'growth', label: 'Dividend CAGR (4y)',
    unit: 'pct', dp: 1, kind: 'calculated', counted: true, na: ['early'], span: 5,
    formula: 'compound growth of dividend per share', inputs: ['dps'], period: 'w5',
    miss: 'Per share, so withheld where a stock split sits inside the window.',
    nmWhy: 'No dividend was paid in the starting year, so a compound growth rate has no meaning.',
    help: { simple: 'How fast the dividend per share has grown each year, on average, over the last four years.',
      context: 'A rising dividend is a statement by the board about what it expects to sustain. It says nothing about whether the dividend is covered — read the payout ratio beside it.',
      technical: '(Latest dividend per share ÷ dividend four years earlier)^(1/4) − 1. Needs a dividend in the starting year; withheld across a stock split.' } },

  /* ------------------------------------------------------------- Financial risk */
  { k: 'ndEbit', g: 'Financial risk', cat: 'leverage', label: 'Net debt / EBIT',
    unit: 'x', dp: 1, kind: 'calculated', counted: true, na: ['bank', 'insurer'],
    formula: '(debt − cash) ÷ EBIT', inputs: ['debt', 'cash', 'ebit'], period: 'latest',
    miss: 'Not applicable to banks.',
    nmWhy: 'Operating profit (EBIT) is zero or negative, so debt cannot be expressed as years of it.',
    help: { simple: 'How many years of operating profit it would take to repay the borrowings.',
      context: 'The most direct measure of whether debt is a problem. Above roughly 3×, a downturn stops being uncomfortable and starts being dangerous. Not applicable to banks.',
      technical: '(Total debt − cash) ÷ operating profit.' } },
  { k: 'de', g: 'Financial risk', cat: 'leverage', label: 'Debt / equity',
    unit: 'x', dp: 2, kind: 'calculated', counted: true, na: ['bank'],
    formula: 'total debt ÷ shareholders’ equity', inputs: ['debt', 'eq'], period: 'latest',
    nmWhy: 'Shareholders’ equity is zero or negative, so debt cannot be expressed against it.',
    help: { simple: 'How much the company has borrowed for every ringgit shareholders have put in.',
      context: 'Read alongside the stability of earnings. Steady utilities safely carry debt that would sink a cyclical manufacturer.',
      technical: 'Total debt ÷ shareholders’ equity.' } },
  { k: 'icov', g: 'Financial risk', cat: 'leverage', label: 'Interest cover',
    unit: 'x', dp: 1, kind: 'calculated', counted: true,
    formula: 'EBIT ÷ net interest expense', inputs: ['ebit'], needs: ['interest expense'], period: 'latest',
    blocked: 'Interest expense is resolved by the SEC ingest but has no column in the stored statements, so interest cover is reported missing for every company, never estimated.',
    miss: 'Interest expense is not carried in the statement tuple, filed or illustrative — reported missing, never estimated.',
    help: { simple: 'How many times over operating profit pays the interest on the company’s debt.',
      context: 'The first test of whether borrowing is affordable: below about 2×, a modest fall in profit leaves interest unpaid. Not computed anywhere in this build — the interest line is not stored.',
      technical: 'EBIT ÷ interest expense. Blocked: interest expense is not a column of the stored statements.' } },

  /* ------------------------------------------------------- Valuation and income */
  { k: 'pe', g: 'Valuation and income', cat: 'valuation', label: 'Price / earnings',
    unit: 'x', dp: 1, kind: 'market', counted: true, na: ['early'],
    formula: 'price ÷ earnings per share', inputs: ['price', 'ni', 'sh'], period: 'latestPx',
    miss: 'Null when earnings are negative.',
    nmWhy: 'Earnings per share are zero or negative, so a price-to-earnings multiple has no meaning.',
    help: { simple: 'How many years of current profit you are paying for the shares.',
      context: 'Low is not automatically cheap. A cyclical company looks cheapest at the top of its cycle, when earnings are at their peak and about to fall.',
      technical: 'Market price per share ÷ earnings per share for the latest reported year.' } },
  { k: 'pb', g: 'Valuation and income', cat: 'valuation', label: 'Price / book',
    unit: 'x', dp: 2, kind: 'market', counted: true,
    formula: 'price ÷ book value per share', inputs: ['price', 'eq', 'sh'], period: 'latestPx',
    nmWhy: 'Book value per share is zero or negative.',
    help: { simple: 'What you pay for the shares compared with the accounting value of what the company owns, less what it owes.',
      context: 'Central for banks and property companies, where the balance sheet is the business. Close to meaningless for a company whose value is people and brands, which the balance sheet does not record.',
      technical: 'Market price per share ÷ shareholders’ equity per share.' } },
  { k: 'evebit', g: 'Valuation and income', cat: 'valuation', label: 'EV / EBIT',
    unit: 'x', dp: 1, kind: 'market', counted: true, na: ['bank', 'insurer', 'early'],
    formula: '(market cap + net debt) ÷ EBIT', inputs: ['price', 'sh', 'debt', 'cash', 'ebit'], period: 'latestPx',
    miss: 'Enterprise value is not meaningful for banks.',
    nmWhy: 'Operating profit (EBIT) is zero or negative, so enterprise value cannot be expressed as a multiple of it.',
    help: { simple: 'What the whole business costs — shares plus debt, less cash — compared with its operating profit.',
      context: 'Fairer than price-to-earnings when comparing companies with very different borrowings, because it prices the debt as part of what you are buying.',
      technical: '(Market capitalisation + total debt − cash) ÷ operating profit.' } },
  { k: 'pfcf', g: 'Valuation and income', cat: 'valuation', label: 'Price / free cash flow',
    unit: 'x', dp: 1, kind: 'market', counted: true, na: ['bank', 'early'],
    formula: 'price ÷ free cash flow per share', inputs: ['price', 'ocf', 'capex', 'sh'], period: 'latestPx',
    nmWhy: 'Free cash flow per share is zero or negative.',
    help: { simple: 'How many years of current free cash flow you are paying for the shares.',
      context: 'Harder to flatter than price-to-earnings, because cash is harder to book early than profit. A single heavy investment year can make it look expensive.',
      technical: 'Market price per share ÷ (operating cash flow − capital expenditure) per share, latest fiscal year.' } },
  { k: 'dy', g: 'Valuation and income', cat: 'income', label: 'Dividend yield',
    unit: 'pct', dp: 2, kind: 'market', counted: true, na: ['early'],
    formula: 'dividend per share ÷ price', inputs: ['price', 'dps'], period: 'latestPx',
    help: { simple: 'The cash paid out per year as a percentage of the share price.',
      context: 'A high yield is sometimes generosity and sometimes a falling share price. Always read it beside whether earnings and cash flow actually cover the payment.',
      technical: 'Dividend per share for the trailing year ÷ current price. Shown gross, before any withholding.' } },
  { k: 'fcfy', g: 'Valuation and income', cat: 'valuation', label: 'Free cash flow yield',
    unit: 'pct', dp: 2, kind: 'market', counted: true, na: ['bank'],
    formula: 'free cash flow ÷ market capitalisation', inputs: ['price', 'sh', 'ocf', 'capex'], period: 'latestPx',
    nmWhy: 'Market capitalisation could not be formed, so there is nothing to divide free cash flow by.',
    help: { simple: 'The cash left after investment, as a percentage of what the whole company costs in the market.',
      context: 'The inverse of price to free cash flow, and easier to set beside a bond yield or a deposit rate. It says nothing about whether that cash is paid out.',
      technical: '(Operating cash flow − capital expenditure) ÷ (price × shares in issue), latest fiscal year.' } },
  { k: 'buyback', g: 'Valuation and income', cat: 'income', label: 'Net buyback yield',
    unit: 'pct', dp: 2, kind: 'calculated', counted: false, span: Infinity,
    formula: 'negative of the share-count CAGR', inputs: ['sh'], period: 'series',
    miss: 'Withheld where a stock split sits inside the series.',
    nmWhy: 'The first share count in the window is zero or absent.',
    help: { simple: 'How fast the number of shares has been shrinking each year — the part of each shareholder’s slice that grows without buying more.',
      context: 'Positive when buybacks outpace new shares issued to staff and for acquisitions. The dollar amount spent is not a stored line, so this is the net effect on the count, not the cost.',
      technical: '−1 × compound annual growth of shares in issue over the stored series. Withheld when a year-on-year move exceeds 1.5× or falls below 0.67× (a split).' } },
  { k: 'payout', g: 'Valuation and income', cat: 'income', label: 'Payout ratio',
    unit: 'pct', dp: 0, kind: 'calculated', counted: true, na: ['early'],
    formula: 'dividend per share ÷ earnings per share', inputs: ['dps', 'ni', 'sh'], period: 'latest',
    nmWhy: 'Earnings per share are zero or negative, so a payout ratio has no meaning.',
    help: { simple: 'The share of profit paid out as dividends.',
      context: 'Near or above 100% leaves nothing for reinvestment or a bad year. Banks and utilities run higher ratios than growing companies by design.',
      technical: 'Dividend per share ÷ earnings per share, latest fiscal year.' } },
  { k: 'cashPayout', g: 'Valuation and income', cat: 'income', label: 'Dividend as % of FCF',
    unit: 'pct', dp: 0, kind: 'calculated', counted: true, na: ['bank', 'early'],
    formula: 'total dividends paid ÷ free cash flow', inputs: ['dps', 'sh', 'ocf', 'capex'], period: 'latest',
    nmWhy: 'Free cash flow is zero or negative, so dividends cannot be expressed as a share of it.',
    help: { simple: 'The share of the cash left after investment that goes out as dividends.',
      context: 'The cash version of the payout ratio. Above 100% the dividend is being paid from borrowing or savings rather than from the year’s cash.',
      technical: '(Dividend per share × shares in issue) ÷ (operating cash flow − capital expenditure), latest fiscal year.' } },
  { k: 'reinv', g: 'Valuation and income', cat: 'cashflow', label: 'Reinvestment rate',
    unit: 'pct', dp: 0, kind: 'calculated', counted: true, na: ['bank'],
    formula: 'capex ÷ operating cash flow', inputs: ['capex', 'ocf'], period: 'latest',
    nmWhy: 'Operating cash flow is zero or negative.',
    help: { simple: 'The share of cash from operations spent on equipment and buildings.',
      context: 'High for a utility, a miner or a business building capacity; low for software. The question is what the spending earns, which the return on invested capital answers.',
      technical: 'Capital expenditure ÷ operating cash flow, latest fiscal year.' } },

  /* ----------------------------------------------------- Financial risk, cont. */
  { k: 'epsVol', g: 'Financial risk', cat: 'stability', label: 'Earnings variability',
    unit: 'sd', kind: 'calculated', counted: false, span: 5,
    formula: 'standard deviation of year-on-year net income growth', inputs: ['ni'], period: 'w5',
    nmWhy: 'Fewer than two year-on-year changes in net income can be measured.',
    help: { simple: 'How much the yearly change in profit jumps around.',
      context: 'A steady compounder and a cyclical business can show the same four-year growth rate; this separates them. High variability makes any single year a poor guide.',
      technical: 'Population standard deviation of year-on-year net income growth, in percentage points, over the latest five reported years.' } },
  { k: 'revDD', g: 'Financial risk', cat: 'stability', label: 'Revenue drawdown',
    unit: 'pct', dp: 0, kind: 'calculated', counted: false, span: 5,
    formula: 'largest peak-to-trough fall in revenue', inputs: ['rev'], period: 'w5',
    nmWhy: 'Fewer than two years of revenue are held.',
    help: { simple: 'The biggest fall in sales from a high point to a later low within the window.',
      context: 'The simplest measure of cyclicality. Zero means sales never fell below an earlier year in the window.',
      technical: 'max over the window of (running peak − revenue) ÷ running peak, latest five reported years.' } },
  { k: 'dilution', g: 'Financial risk', cat: 'income', label: 'Share count growth',
    unit: 'pct', dp: 2, kind: 'calculated', counted: true, span: Infinity,
    formula: 'CAGR of shares in issue', inputs: ['sh'], period: 'series',
    miss: 'Withheld where a stock split sits inside the series.',
    nmWhy: 'The first share count in the window is zero or absent.',
    help: { simple: 'How fast the number of shares has been growing each year, which shrinks each existing shareholder’s slice.',
      context: 'Share-based pay, acquisitions paid in shares and capital raises all push it up. Splits are not issuance, so the rate is withheld across one rather than reported.',
      technical: 'Compound annual growth of shares in issue over the stored series. Withheld when a year-on-year move exceeds 1.5× or falls below 0.67×.' } },
  { k: 'netGearing', g: 'Financial risk', cat: 'leverage', label: 'Net gearing',
    unit: 'pct', dp: 0, kind: 'calculated', counted: false, na: ['bank'],
    formula: '(total debt − cash) ÷ shareholders’ equity', inputs: ['debt', 'cash', 'eq'], period: 'latest',
    miss: 'Not applicable to a bank balance sheet.',
    note: 'Cash here is cash and equivalents only. A company holding short-term investments will look more indebted than it is.',
    nmWhy: 'Shareholders’ equity is zero or negative, so gearing against it has no meaning.',
    help: { simple: 'Borrowings less cash, as a share of what shareholders have in the business.',
      context: 'Unlike debt to equity, it nets off cash — so a company holding as much cash as it owes reads near zero here and levered there. Negative means net cash.',
      technical: '(Total debt − cash and equivalents) ÷ shareholders’ equity, latest fiscal year.' } },
  { k: 'ocfPosYears', g: 'Financial risk', cat: 'cashflow', label: 'Years of positive operating cash flow',
    unit: 'count', kind: 'calculated', counted: false, span: 5,
    fmt: (v, r) => `${fmtNum(v, 0)} of ${r?.m?.ocfYearsSeen ?? 5}`,
    formula: 'count of the reported years, up to the last five, with operating cash flow above zero', inputs: ['ocf'], period: 'w5count',
    nmWhy: 'No year of operating cash flow is held.',
    help: { simple: 'In how many of the last five years the business brought in more cash than it spent running itself.',
      context: 'A screen for durability rather than size. Four of five is the usual bar; a gap in the reported years is counted as not examined, never as a pass.',
      technical: 'Count of reported years among the latest five with operating cash flow above zero, shown against how many were reported.' } },

  /* ---------------------------------------------------- Market and eligibility */
  { k: 'rs12', g: 'Market and eligibility', cat: 'market', label: '12-month price change',
    unit: 'pct', dp: 1, kind: 'market', counted: true,
    formula: 'price change over the trailing twelve months', inputs: ['history'], period: 'closes',
    help: { simple: 'How much the share price has moved over the last year.',
      context: 'Describes what happened to the price, not why. Computed only from closes you imported or captured; with none, it is absent.',
      technical: 'Latest close ÷ close 252 trading sessions earlier − 1.' } },
  { k: 'from52', g: 'Market and eligibility', cat: 'market', label: 'Distance from 52-week high',
    unit: 'pct', dp: 1, kind: 'market', counted: false,
    formula: '(price − 52-week high) ÷ 52-week high', inputs: ['history'], period: 'closes',
    help: { simple: 'How far the share price sits below its highest close of the last year.',
      context: 'Zero means it closed at a one-year high. A large distance is a fact about the price path, not a sign that it will recover.',
      technical: '(Latest close − highest close over 252 sessions) ÷ that high.' } },
  { k: 'sma200d', g: 'Market and eligibility', cat: 'market', label: 'Distance from 200-day average',
    unit: 'pct', dp: 1, kind: 'market', counted: false,
    formula: '(price − 200-day simple moving average) ÷ 200-day average', inputs: ['history'], period: 'sma',
    note: 'Needs 200 observed closes. Computed from imported or captured history only.',
    help: { simple: 'How far the share price sits above or below its average over roughly the last ten months.',
      context: 'A description of trend, used on the price surfaces only. It is weighted zero in every research score.',
      technical: '(Latest close − mean of the latest 200 closes) ÷ that mean.' } },

  /* ---------------------------------------------------------- Composite scores */
  { k: 'qscore', g: 'Composite scores', cat: 'scores', label: 'Business quality score',
    unit: 'score', kind: 'modelled', counted: false,
    formula: 'weighted pillar score, 0–100', inputs: ['rev', 'ebit', 'ni', 'ocf', 'capex', 'eq', 'debt', 'cash', 'sh'], period: 'model',
    nmWhy: 'Too few of the quality pillar’s inputs are computable to score it.',
    help: { simple: 'A 0–100 summary of how profitable and cash-generative the business is, from the published pillar weights.',
      context: 'A score is an ordering against published anchors, not a verdict. Read the pillar table behind it on the company page.',
      technical: 'Weighted mean of the quality pillar’s inputs, each mapped to 0–100 between published anchors, re-based over the inputs that could be computed.' } },
  { k: 'vscore', g: 'Composite scores', cat: 'scores', label: 'Valuation evidence score',
    unit: 'score', kind: 'modelled', counted: false,
    formula: 'weighted valuation score, 0–100', inputs: ['price', 'ni', 'ocf', 'capex', 'eq', 'sh'], period: 'model',
    nmWhy: 'Too few of the valuation inputs are computable to score them — every one of them needs a price.',
    help: { simple: 'A 0–100 summary of how the price compares with the model estimate and the cash and dividend yields.',
      context: 'Every input needs a price, so without one there is no score. It is evidence about the price, not a signal.',
      technical: 'Difference to the base-case model 60%, free cash flow yield 20%, dividend yield 20%, each mapped between published anchors, re-based over those computable.' } },
  { k: 'mosBase', g: 'Composite scores', cat: 'scores', label: 'Difference to base-case model',
    unit: 'pct', dp: 0, kind: 'modelled', counted: false,
    formula: '(base-case model estimate − price) ÷ price', inputs: ['price'], period: 'model',
    nmWhy: 'The base-case model produced no estimate for this company — its model pack needs inputs that are absent — so there is no difference to a price.',
    help: { simple: 'How far today’s price sits from what this model estimates, given the assumptions shown.',
      context: 'A large difference means the model and the market disagree. That is a reason to examine the assumptions, not a signal — the market may be right and the model wrong.',
      technical: '(Base-case model estimate − price) ÷ price. The base case is an output of the assumptions listed beside it.' } },
  /* The one field here denominated in money besides free cash flow. Every
     other column is a ratio, a multiple or a percentage, and therefore reads
     the same whichever currency the company reports in. Flagged so the
     screener can convert and label it rather than printing a Bursa figure in
     ringgit beside a US figure in dollars as though they were the same unit.
     Formatted in the company's own currency when the row is known. */
  { k: 'mcap', g: 'Market and eligibility', cat: 'valuation', label: 'Market capitalisation',
    unit: 'money', kind: 'market', counted: false, money: true,
    formula: 'price × shares in issue', inputs: ['price', 'sh'], period: 'latestPx',
    nmWhy: 'The share count is zero or absent, so a price cannot be turned into a market capitalisation.',
    help: { simple: 'What all the company’s shares are worth together at the price held.',
      context: 'A size measure, not a value measure. It excludes debt, which enterprise value adds back.',
      technical: 'Price × shares in issue at the latest fiscal year-end.' } },

  /* ---------------------------------------------- Blocked: lines not stored */
  /* Named in the ratio library and not computable from the stored lines.
     Rows so the dictionary lists them as blocked; not screener fields, so no
     column offers a figure that can never arrive. */
  { k: 'gm', cat: 'profitability', label: 'Gross margin', unit: 'pct', kind: 'calculated', screener: false,
    formula: '(revenue − cost of revenue) ÷ revenue', inputs: ['rev'], needs: ['gross profit or cost of revenue'], period: 'latest',
    blocked: 'Neither gross profit nor cost of revenue is ingested, so gross margin cannot be computed for any company.',
    help: { simple: 'Out of every dollar or ringgit of sales, how much is left after the direct cost of the goods or services sold.',
      context: 'The first line of pricing power. Not available here: the stored statements carry no cost-of-revenue line.',
      technical: '(Revenue − cost of revenue) ÷ revenue. Blocked: no gross profit or cost of revenue line is stored.' } },
  { k: 'roa', cat: 'returns', label: 'Return on assets', unit: 'pct', kind: 'calculated', screener: false,
    formula: 'net income ÷ average total assets', inputs: ['ni'], needs: ['total assets'], period: 'latest',
    blocked: 'Total assets are not ingested, so return on assets cannot be computed for any company.',
    help: { simple: 'How much profit the company earns on everything it owns.',
      context: 'The natural return measure for banks and insurers. Not available here: the stored statements carry no total-assets line.',
      technical: 'Net income ÷ average total assets. Blocked: total assets are not stored.' } },
  { k: 'cr', cat: 'liquidity', label: 'Current ratio', unit: 'x', kind: 'calculated', screener: false,
    formula: 'current assets ÷ current liabilities', inputs: [], needs: ['current assets', 'current liabilities'], period: 'latest',
    blocked: 'Current assets and current liabilities are resolved by the SEC ingest but have no column in the stored statements, and the shipped file predates them.',
    help: { simple: 'Whether what the company will turn into cash within a year covers what it must pay within a year.',
      context: 'Below 1× short-term bills exceed short-term assets. Not available here: the two lines are not stored.',
      technical: 'Current assets ÷ current liabilities. Blocked: neither line is a column of the stored statements.' } },
  { k: 'qr', cat: 'liquidity', label: 'Quick ratio', unit: 'x', kind: 'calculated', screener: false,
    formula: '(current assets − inventory) ÷ current liabilities', inputs: [], needs: ['current assets', 'inventory', 'current liabilities'], period: 'latest',
    blocked: 'Current assets, inventory and current liabilities are not in the stored statements, and no ingest chain names inventory.',
    help: { simple: 'The current ratio without stock, which can be slow or impossible to sell quickly.',
      context: 'A stricter test of short-term cover. Not available here: the lines are not stored.',
      technical: '(Current assets − inventory) ÷ current liabilities. Blocked: none of the three lines is stored.' } },
  { k: 'evebitda', cat: 'valuation', label: 'EV / EBITDA', unit: 'x', kind: 'market', screener: false,
    formula: '(market cap + net debt) ÷ (EBIT + depreciation and amortisation)', inputs: ['price', 'sh', 'debt', 'cash', 'ebit'], needs: ['depreciation and amortisation'], period: 'latestPx',
    blocked: 'Depreciation and amortisation are not ingested, so EBITDA cannot be formed. EV / EBIT, which needs no such line, stands in the screener.',
    help: { simple: 'What the whole business costs compared with its operating profit before depreciation.',
      context: 'Common in deal work because it ignores how assets are depreciated. Not available here: no depreciation line is stored; EV / EBIT is published instead.',
      technical: '(Market capitalisation + total debt − cash) ÷ (EBIT + D&A). Blocked: depreciation and amortisation are not stored.' } },
];

const METRIC_BY_K = Object.fromEntries(METRICS.map(x => [x.k, x]));

/* ------------------------------------------------------------- projections */
/* The formatter a row prints with: its own where it has one (the count of
   positive years reads "4 of 5"), otherwise its unit's. */
const metricFmt = (x) => x.fmt || METRIC_UNIT[x.unit].fmt(x.dp ?? 1);

/* A screener field, as FIELDS has always shaped one, plus the registry's
   unit, period and category so the drawer and the export can read them. */
function metricField(x) {
  const f = { g: x.g, k: x.k, label: x.label, fmt: metricFmt(x), formula: x.formula,
              unit: x.unit, period: METRIC_PERIOD[x.period] || x.period, cat: x.cat };
  if (x.miss) f.miss = x.miss;
  if (x.note) f.note = x.note;
  if (x.money) f.money = true;
  return f;
}

/* Applicability, split the way the coverage figure needs it: counted
   measures that do not apply are INAPPLICABLE (excluded from the denominator
   and nulled by derive), uncounted ones ALSO_INAPPLICABLE. */
function metricApplicability(counted) {
  const out = { bank: [], insurer: [], early: [], reit: [] };
  METRICS.filter(x => !!x.counted === counted && !x.blocked).forEach(x => (x.na || []).forEach(t => (out[t] = out[t] || []).push(x.k)));
  return out;
}

/* METRIC_HELP (00-core) keeps the explanations for things that are not
   screener measures — data completeness, the difference to a model estimate
   the valuation page shows, and the property yields. Every registry row
   supplies its own, so a screener field can no longer lack a definition. */
METRICS.forEach(x => { if (x.help) METRIC_HELP[x.k] = { label: x.label, ...x.help }; });
