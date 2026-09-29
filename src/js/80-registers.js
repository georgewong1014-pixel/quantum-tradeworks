/* ==========================================================================
   VIEW — PLANS
   ========================================================================== */
/* The scope statement. It exists because the boundary between research and
   advice is a product decision that has to be legible to a user, a regulator
   and the team building the next feature — not a paragraph in a terms page. */
/* The boundary argument in full, on its own page. It was the first thing on the
   pricing page and is now the whole of this one — the same content, reached by
   someone who has decided they want it rather than imposed on someone who came
   to read a price. */
/* ==========================================================================
   FEATURE STATUS REGISTER — execution directive 2.3, 3 and 9.3

   The directive's central rule is that nothing is deleted. A capability may be
   gated, limited or queued, but "deleted", "abandoned" and "hidden
   indefinitely" are not valid states — and 9.3 requires every release to prove
   that no capability silently disappeared.

   That proof needs somewhere to live, so it lives here, publicly. A status
   register kept in a private document is a claim; one a reader can open is a
   commitment. Each row names what the capability is, what state it is in, and
   for anything gated, the specific thing that is holding it and who clears it —
   because "coming soon" is what a roadmap says when nobody has decided.
   ========================================================================== */
const FEATURE_STATUS = [
  { id:'active-core', label:'Active Core Build', note:'Receiving current build capacity.' },
  { id:'maintenance', label:'Active Maintenance', note:'Available and supported; reliability work continues.' },
  { id:'beta',        label:'Beta', note:'Available with a stated limitation.' },
  /* THE PHASE 2 BRIEF'S RELEASE RULE: a P1 surface that is not finished is
     feature-flagged or states its limits, and nothing unfinished is shown as
     operational. Before this state existed the register could only call a
     partial surface Beta — "available" — or Queued — "not built" — and a
     compare page that works but cannot yet say when two companies report on
     different years is neither. Flagged is reachable, marked partial on the
     page itself (flagNoticeFor below reads this row), and never counted as
     operational. */
  { id:'flagged',     label:'Feature-flagged', note:'Partial. Reachable at its address and marked partial on the page itself; not counted as operational until what it lacks is built and a named check covers it.' },
  { id:'data-gated',  label:'Data Gated', note:'Interface and model retained; investable output waits on authorised data.' },
  { id:'compliance',  label:'Compliance Gated', note:'Capability retained; activation waits on legal approval or licence.' },
  { id:'queued',      label:'Expansion Queue', note:'In the roadmap, sequenced after core quality gates.' },
];
/* The states a reader may take to mean "this works". register-check.mjs holds
   every row in one of them to a real route, and every prioritised row in one
   of them to a named check. */
const OPERATIONAL_STATUSES = new Set(['active-core', 'maintenance', 'beta']);

/* PRIORITY, FROM THE PHASE 2 BRIEF — never invented per row.
   ---------------------------------------------------------------------------
   A row that answers an item of the Phase 2 equities brief names it in
   `brief`, and carries that item's priority from docs/phase2-plan.md §1;
   register-check.mjs reads the table there and fails a row whose priority
   disagrees, and fails the build if any item of the brief is answered by no
   row at all — the same "nothing silently disappears" rule, applied to the
   brief. Rows outside the brief (property, the wheel) carry no priority,
   because giving them one would be ranking work nobody has ranked.

   `complete` is false unless stated, and every Phase 2 row is partial today.
   `checks` names the harness checks that cover the row — a file and a phrase
   from the check's own ok() line, which the static check finds in that file.
   A P1 row with a surface that is not complete must be 'flagged'. */
const PRIORITY_NOTE = {
  P0: 'Phase 2 must-have. Not marked complete until its checks pass.',
  P1: 'Phase 2 should-have. While partial it is feature-flagged, or has no surface yet.',
};
/* THE PHASE 3 BRIEF — the Quantum Scanner. Its items are SC-301…SC-319 and
   SC-NAV (the plan's "NAV" row, renamed so it cannot merge with Phase 2's),
   with priorities from docs/phase3-plan.md §1. It adds P2: the later
   live-scanning release, which is never shown as available — a P2 row has
   no path and is neither operational nor flagged. */
const PRIORITY_NOTE_P3 = {
  P0: 'Phase 3 daily-scanner release. Not marked complete until its checks pass; blocked items say on what.',
  P1: 'Phase 3 extension. While partial it is feature-flagged, or has no surface yet.',
  P2: 'Phase 3 later live-scanning release. Never shown as available.',
};
/* Which brief a row answers — Phase 3 when it cites an SC item. */
const registerPhase = (c) => ((c.brief || []).some(b => /^SC-/.test(b)) ? 3 : 2);
const priorityNoteOf = (c) => (registerPhase(c) === 3 ? PRIORITY_NOTE_P3 : PRIORITY_NOTE)[c.priority] || '';

const CAPABILITY_REGISTER = [
  { name:'Sarawak property underwriting', status:'active-core', path:'/property/calculator',
    now:'Capital ledger, valuation gap, grade, downside and plain-language result.' },
  { name:'True capital ledger', status:'active-core', path:'/property/calculator',
    now:'Every completion, rent-ready and reserve line, reconciled.',
    gate:'Seven fee lines carry placeholder values pending verification against the Solicitors’ Remuneration Order 2023 and the current rate orders.' },
  { name:'Borrower Loan Readiness', status:'active-core', path:'/property/calculator',
    now:'Income, debts, disposable income, credit conduct and documents, as a diagnostic score.' },
  { name:'Property Financeability', status:'active-core', path:'/property/calculator',
    now:'Title, valuation gap, tenure, condition and marketability, scored separately from the borrower.' },
  { name:'Property underwriting grade', status:'active-core', path:'/property/calculator',
    now:'A/B/C/D/U with hard gates and evidence caps.' },
  { name:'Property opportunity register', status:'active-core', path:'/property/opportunities',
    now:'Records real candidates with source, availability date, four separate prices, grade and a next action with an owner.',
    gate:'Holds nothing until you add cases. This product sources no listings and republishes none.' },
  { name:'Sarawak comparables register', status:'data-gated', path:'/property/comparables',
    now:'The structure: address, district, title, built-up area, asking and achieved kept apart, date, evidence class, source reference and a reviewer.',
    gate:'Ships empty, and stays empty until a person records evidence. No source publishes Sarawak transacted prices or achieved rents this product may redistribute.' },
  { name:'Loan comparison across lenders', status:'queued', path:null,
    gate:'Needs the offer-status workflow. Financing scenarios at 70/80/90% exist today; named lender offers do not.' },
  { name:'Operations Excellence handoff', status:'queued', path:null,
    gate:'Book 2. Generated from Book 1 once acquisition underwriting is settled.' },
  { name:'Property map and area observations', status:'maintenance', path:'/property/calculator',
    now:'Cached coordinates under ODbL with per-area match confidence.' },
  { name:'Discover and screener', status:'maintenance', path:'/discover/screener',
    now:'Reproducible filters, cohort medians and a reporting-currency selector.' },
  /* The explorer and the brief's paths were a row of their own in the brief
     and nowhere here; the company page's row said "/research", which is the
     explorer's address, not the page's. */
  { name:'Company explorer and the equities paths', status:'maintenance', path:'/app/equities/explore',
    brief:['NAV', 'EQ-204'], priority:'P0',
    now:'Search by name, ticker, listing code, CIK or any older id the instrument registry holds, ranked by how the term matched and never by any measure of the company; market and coverage filters. The brief’s /app/equities and /app/watchlists addresses open the existing pages.',
    gate:'SEC filings carry no listing venue, so a US filer cannot be found or filtered by exchange until the statements are regenerated. The search covers the loaded universe, not every listing on either market.',
    checks:[{ file:'equity-test.mjs', name:'one identity per listed thing' },
            { file:'equity-test.mjs', name:'/app/equities and /app/watchlists paths open the existing pages' },
            { file:'equity-test.mjs', name:'the keyboard reaches the search' }] },
  { name:'Company research', status:'maintenance', path:'/company/AAPL-SEC',
    brief:['EQ-205', 'EQ-206', 'EQ-207', 'EQ-209'], priority:'P0',
    now:'Statements, scorecards, valuation router and risk flags. Every figure opens the drawer that names its source, period and kind; every absence names its reason.',
    gate:'Annual figures only — no quarterly line is held for any filer. Gross margin, return on assets, current and quick ratios, interest cover and EV/EBITDA need statement lines the shipped file does not carry.',
    checks:[{ file:'equity-test.mjs', name:'every research tab labels MSFT-SEC with its own fiscal years' },
            { file:'equity-test.mjs', name:'every filed company’s statement table reconciles with data/us.json' },
            { file:'equity-test.mjs', name:'ratios match figures recomputed by hand from the filings' }] },
  /* The statements explorer and per-figure lineage. Active, with the parts
     the shipped data cannot fill stated as the gate rather than hidden. */
  { name:'Statements and figure lineage', status:'active-core', path:'/company/MSFT-SEC?tab=financials',
    brief:['EQ-206', 'EQ-209'], priority:'P0',
    checks:[{ file:'equity-test.mjs', name:'the statements table is three statements whose every cell opens its source' },
            { file:'equity-test.mjs', name:'the statements CSV round-trips the table' },
            { file:'equity-test.mjs', name:'the source drawer states unit, transformation, filing and EDGAR, and Compare opens it' }],
    now:'Latest-year tiles and a statements table grouped into income statement, balance sheet and cash flow, with year-on-year changes on request. Every figure opens its source: the XBRL concept for that year, the original unit, what the ingest did to it and the EDGAR record. CSV of every line and year.',
    gate:'Filing date, form and period end per figure, and a link to the exact filing, wait on regenerating data/us.json. Annual only — no quarterly statements are held. CSV is an Equities Research feature, and personal-lane statements are never exported.' },
  /* Was listed as queued with no route while it had been live on every company
     page for weeks. One row was describing two things — the classifier that
     ships and the saved strategy plan that does not — so shipping half of it
     left the row wrong about both. Split. */
  { name:'Equity Strategy Lens', status:'active-core', path:'/research',
    now:'On every company page: instrument type, business archetype, return role, and eight fit grades that separate graded from unassessed, not applicable, not built and illustrative.',
    gate:'Grades describe how far the evidence meets a strategy’s requirements. They are not an entry plan and imply no allocation.' },
  { name:'Saved strategy plans and leverage stress', status:'queued', path:null,
    gate:'P1. Staged entry tranches, invalidation conditions, leverage stress and outcome review, saved against a company and a model version. The Lens grades the underlying; it does not record what you decided to do about it.' },
  { name:'Bursa universe', status:'data-gated', path:'/research',
    brief:['EQ-202'], priority:'P0',
    gate:() => covText(k => `${k.illustrative} companies carry illustrative figures — ${k.my} Bursa`
       + (k.usIllustrative ? ` and ${k.usIllustrativeNames.join(', ')} on the US side` : '')
       + '. No investable grade is offered for any of them.',
       `${COVERAGE_PENDING} — how many companies carry illustrative figures is not known until the audited set has loaded. No investable grade is offered for any of them either way.`) },
  { name:'US equities', status:'maintenance', path:'/research',
    brief:['EQ-201', 'EQ-202', 'EQ-203'], priority:'P0',
    now:() => covText(k => `${k.usFiled} US companies with audited SEC filings, of ${k.us} US listings held.`,
      `${COVERAGE_PENDING} — the audited US set is still loading. This row states a count only once it can state the right one.`),
    gate:'The shipped statements predate the corrected ingest and cannot be regenerated until the SEC’s required contact address is supplied; figures the old rules assembled wrongly are withheld with the reason until then.',
    checks:[{ file:'equity-test.mjs', name:'filed companies loaded, all' },
            { file:'equity-test.mjs', name:'canonical ids are one per instrument' },
            { file:'ingest-test.mjs', name:'ingest rules hold' }] },
  { name:'US Options Cash Wheel', status:'data-gated', path:'/us-options/wheel',
    now:'Cash-secured put and covered-call arithmetic, collateral gates, downside scenarios and the full risk card, from figures you enter.',
    gate:'No authorised option-chain data, so contracts are entered by hand. Live chains, any recommended contract, broker routing and execution stay Compliance Gated and are not built.' },
  { name:'QT Trading Index', status:'active-core', path:'/research/trading-index',
    now:'Multi-timeframe trend regime, first-tranche readiness against your own rules, screenshot confidence, template and derivative hard gates, from chart evidence you record.',
    gate:'Phase 1 only. It does not read your screenshot — OCR and vision extraction are phase 2. No indicator here has been backtested on point-in-time data, so no rule is claimed to be effective.' },
  { name:'Trade-setup scanner', status:'data-gated', path:'/app/scanner',
    brief:['EQ-214'], priority:'P0',
    now:'Conditions you write — price, volume, moving averages, RSI, MACD; above, below, crossing, between — evaluated on your own daily history by a worker that records which held on the last daily bar your history holds. A watchlist can be its universe, snapshotted into the setup. Never ranked, never delivered, never claimed to work.',
    gate:'Personal lane only: it reads the price history you built under your own subscription, so the deployed site has nothing to scan. Offering it to anyone else needs a licensed end-of-day feed and written classification, and neither exists.' },
  /* Computed at render, like the US equities row. It was a sentence — "11
     companies identified with price history" — and the history is git-ignored
     personal-lane data, so the deployed site, which ships none, stated a local
     machine's state as a fact about the product while its own Sarawak page
     said no history was loaded. */
  { name:'Sarawak Economy Watch', status:'data-gated', path:'/discover/sarawak',
    gate:() => {
      const tail = 'Exposure evidence, filings and coverage are not yet recorded, so no fit grade is shown.';
      if (!instruments) return `How many companies are identified is not stated until the instrument registry has loaded. ${tail}`;
      const flagged = (instruments.instruments || []).filter(i => i.sarawak);
      const withHistory = flagged.filter(i => trackedHistory?.series?.[i.symbol]).length;
      return `${flagged.length} compan${flagged.length === 1 ? 'y' : 'ies'} identified; `
        + (withHistory ? `${withHistory} with price history held locally, none of which ships with this site. `
                       : 'no price history is held here, and this site ships none. ')
        + tail;
    } },
  { name:'Portfolio and My Investments', status:'maintenance', path:'/my/portfolio',
    now:'Holdings, weights, currency attribution and thesis links.' },
  { name:'Thesis, catalysts and invalidation', status:'maintenance', path:'/my/theses',
    now:'User-authored conditions evaluated against current data, with the proximity rule published.' },
  { name:'Watchlists', status:'active-core', path:'/my/watchlists',
    brief:['EQ-208', 'EQ-214'], priority:'P0',
    checks:[{ file:'equity-test.mjs', name:'watchlists are one service' },
            { file:'equity-test.mjs', name:'a watchlist survives a reload' },
            { file:'equity-test.mjs', name:'the watchlist handoff keeps its contract' }],
    now:'Create, rename, delete, add by any name the registry knows, remove, export and import — one service every page calls. Each member carries its canonical instrument id, so a list can be handed to the scanner as its universe.',
    gate:'Stored in this browser only: there are no accounts, so no ownership to enforce and nothing follows you to another device.' },
  /* THE BRIEF'S P1 SURFACES. Two exist and work but lack what the brief
     requires of them, so they are flagged: the page says what is missing
     where it is read, and neither is counted as operational. Two have no
     surface yet — the pieces exist in four places, the page that gathers them
     does not — so there is nothing to flag, and they are queued. `flag` is
     what the surface's notice says; `checks` is what already covers it. */
  { name:'Company comparison', status:'flagged', path:'/compare',
    brief:['EQ-210'], priority:'P1',
    now:'Reporting period and accounting basis rows, absolute scale rows in the chosen currency, a stated reason for every absent cell, a banner when periods, bases or illustrative and filed figures are mixed, and named comparisons that say what moved.',
    flag:'Period-end months cannot be aligned until the SEC dataset is regenerated with period ends, and no line-level accounting reconciliation (leases, minorities, associates) is possible from the statements held.',
    checks:[{ file:'equity-test.mjs', name:'the comparison states each column' },
            { file:'equity-test.mjs', name:'compare and onboarding do what their labels say' }] },
  { name:'Valuation models', status:'flagged', path:'/company/AAPL-SEC?tab=valuation',
    brief:['EQ-211'], priority:'P1',
    now:'In the Valuation Studio: net debt, the share count and a signed adjustment are inputs, labelled as yours once changed; edits are kept per company across reloads; the sensitivity grid takes any two inputs and steps; the calculation and the confidence score are explained with your figures.',
    flag:'Editing sits behind the local plan switch in this prototype — no payment exists. Lease, minority and associate adjustments are not pre-filled from any filing; the adjustment is your figure.',
    checks:[{ file:'equity-test.mjs', name:'the DCF bridge is equity = EV' },
            { file:'equity-test.mjs', name:'net debt and the adjustment are the reader' },
            { file:'equity-test.mjs', name:'the sensitivity grid takes the reader' },
            { file:'equity-test.mjs', name:'the Valuation Studio states what it computed' }] },
  { name:'Research workspace', status:'flagged', path:'/my/workspace',
    brief:['EQ-212'], priority:'P1',
    now:'Every saved valuation run, comparison, screen, investment case and tool snapshot in one list, each with the model and data version it was saved against and whether either has moved since. One export on Your data carries every kind.',
    flag:'This browser only. There are no accounts, so nothing follows you to another device, nothing can be shared, and a cleared browser loses it all unless it was exported.',
    checks:[{ file:'equity-test.mjs', name:'one stamp on every saved item' },
            { file:'equity-test.mjs', name:'the workspace lists every saved kind with its stamp' }] },
  { name:'Research report (print or save as PDF)', status:'flagged', path:'/company/MSFT-SEC/report',
    brief:['EQ-213'], priority:'P1',
    now:'From the Report button on any company page: identification, data status with version stamps, statements, selected metrics with their status, your valuation assumptions marked edited or default, and the figure-kind legend — printable, or rendered from a saved run so it reproduces after the data moves.',
    flag:'PDF is your browser’s own print-to-PDF, not a server export: one company per report, no stored copy, no archive and no share link. Bursa companies print illustrative figures, and no filed company carries a licensed price.',
    checks:[{ file:'equity-test.mjs', name:'the research report identifies, legends and reproduces what it prints' }] },
  /* The checks are a capability too: the brief makes them one of its items,
     and this page is where their result is stated. */
  { name:'Research QA and the release rule', status:'active-core', path:'/status',
    brief:['EQ-215'], priority:'P0',
    now:'Each item of the brief’s eighteen-point research checklist is mapped to an automated check or to the reason it cannot have one (docs/phase2-qa.md in the repository). A static check fails the build when a row here claims a status its route or its checks do not support.',
    gate:'Two checklist items cannot be tested: there are no accounts, so no cross-user access to refuse, and no quarterly figures are held.',
    checks:[{ file:'register-check.mjs', name:'every operational row opens a real route' },
            { file:'equity-test.mjs', name:'a feature-flagged surface says so where it is read' },
            { file:'equity-test.mjs', name:'the skeleton holds the page while the filings load' },
            { file:'equity-test.mjs', name:'a failed load paints the sample, labelled' },
            { file:'mobile.mjs', name:'no horizontal overflow at any width' }] },
  /* THE PHASE 3 BRIEF — THE QUANTUM SCANNER. One row per item of
     docs/phase3-plan.md §1, in its order, each saying what exists in the
     static application and what is blocked. The server product the brief
     describes — accounts, email, an authorised feed, an administrator — is
     not built (docs/phase3-plan.md §0), so no row here is complete, the
     rows blocked by that decision are gated with no path, and the release
     check for Phase 3 stays red and names why. */
  { name:'Scanner routes and navigation', status:'beta', path:'/app/scanner',
    brief:['SC-NAV'], priority:'P0',
    now:'Scanner in the main navigation after Research, with the unread count; the dashboard at /app/scanner, with /my/scanner kept as its alias (a ?symbol= link still opens the builder); market screening, historical testing and the four /admin/scanner pages. Route parameters are never :id, so no scanner address is read as a company.',
    gate:'/admin/* is not restricted to anyone: there are no accounts, so the operations pages are read-only views that say so. Intraday timeframes appear nowhere as available.',
    checks:[{ file:'equity-test.mjs', name:'the scanner is in the header after Research, on every scanner address' },
            { file:'register-check.mjs', name:'robots.txt keeps the scanner and operations paths out of crawlers' },
            { file:'mobile.mjs', name:'no horizontal overflow at any width' }] },
  { name:'Market-data ingestion (scanner)', status:'data-gated', path:null,
    brief:['SC-301'], priority:'P0',
    gate:'An authorised end-of-day feed with redistribution rights does not exist for this product. The scanner reads only the reader’s own history — their screen capture, export or live reader, under their own subscription — through one store that validates and dates every bar by its market’s session. ingest/history-check.mjs reports series dated a day early and re-fetches them; the daily run’s ready gate holds back a market whose last session is not yet final by the clock, because no provider confirms it.' },
  { name:'OHLCV storage and validation', status:'beta', path:'/admin/scanner/data',
    brief:['SC-302'], priority:'P0',
    now:'Every bar validated (bad date, future, negative price or volume, high below or low above, non-session day) and listed with its code rather than dropped; a bar captured before its session closed and settled is provisional and never confirms; sessions inferred from the reader’s own series and labelled inferred; weekly bars derived with a completeness flag. Splits and consolidations the reader records in data/price-adjustments.json are applied on read, the history as held untouched. The data-health page shows all of it per market and per series, with series dated a day early and one session held under two dates.',
    gate:'The history holds closes and volumes; open, high and low only where a source of the reader’s supplies them. Nothing is adjusted but the splits and consolidations the reader records — never dividends — and a break nobody recorded is tagged, not corrected. No exchange calendar is held.',
    checks:[{ file:'scanner-test.mjs', name:'scanValidateBar: each of BAD_DATE' },
            { file:'scanner-test.mjs', name:'a provisional bar never confirms' },
            { file:'scanner-test.mjs', name:'readiness per market: READY when the expected session is held final' },
            { file:'scanner-test.mjs', name:'scanDataHealth: a zero close and a bad key counted as dropped' },
            { file:'equity-test.mjs', name:'the operations pages render the worker files read-only' },
            { file:'scanner-test.mjs', name:'round 3 data: once the split is recorded the same RSI is VALID' },
            { file:'equity-test.mjs', name:'round 3 data: the data page names a gap, a zero close, a split' }] },
  { name:'Technical indicator engine', status:'beta', path:'/app/scanner/backtest',
    brief:['SC-303'], priority:'P0',
    now:'One library — SMA, EMA, Wilder RSI, MACD, Bollinger, average and relative volume, ATR, rolling highs and lows, change — shared by the pages, the worker and historical testing, each with its formula, parameters and version; an indicator that cannot be computed says why and has no value, including a window across a price break nobody recorded. Values are printed at the series’ own quoted precision, beside every condition on the simulation and screening pages.',
    gate:'Checked against hand-worked values and a textbook reimplementation, not a committed reference library. ATR and true highs and lows need OHLC the history rarely holds.',
    checks:[{ file:'scanner-test.mjs', name:'every indicator equals a naive textbook implementation bar for bar' },
            { file:'scanner-test.mjs', name:'Wilder RSI14 on the StockCharts worksheet closes' },
            { file:'scanner-test.mjs', name:'an IndicatorResult carries value, valueText, status, reason' },
            { file:'scanner-test.mjs', name:'round 3 data: an RSI window across an unrecorded 4-for-1 split is INVALID_INPUT UNADJUSTED_BREAK' }] },
  { name:'Rule evaluation engine', status:'beta', path:'/app/scanner/market',
    brief:['SC-304'], priority:'P0',
    now:'Nested ALL/ANY groups with three-valued logic, the brief’s eight operators, crossings read only across consecutive completed bars, unit checks on every comparison, and limits on depth and conditions. One evaluator for the worker, the pages and historical testing.',
    gate:'No server validates a setup; the browser and the worker validate with the same function. Intraday timeframes are refused with the reason.',
    checks:[{ file:'scanner-test.mjs', name:'ALL and ANY follow Kleene' },
            { file:'scanner-test.mjs', name:'unit pairs × 8 operators — same units validate, different units are UNIT_MISMATCH' },
            { file:'scanner-test.mjs', name:'determinism: the engine sliced from index.html twice gives byte-identical runs' }] },
  { name:'Setup builder', status:'beta', path:'/app/scanner/setups/new',
    brief:['SC-305'], priority:'P0',
    now:'One group matching all or any of its conditions. Each condition takes any indicator on the left, one of the eight operators, and a right side offered only from the same unit, so a mismatched comparison cannot be built. Parameters carry their bounds, 1D and 1W are offered with the intraday timeframes shown disabled and why, and cooldown, expiry and a universe (a watchlist, a market, named symbols or every series held) are set here. It can start from a committed example, a copy of another setup, a market or an alert. Every problem the worker would refuse is shown at its place before saving, and nothing is stored on a refusal.',
    gate:'Saved in this browser — there are no accounts and no server validation; the worker reads the exported file. A nested tree from the file is shown read-only, to be replaced by one editable group. Intraday timeframes wait on SC-317.',
    checks:[{ file:'equity-test.mjs', name:'the scanner builder writes valid rules and refuses invalid ones' },
            { file:'equity-test.mjs', name:'the scanner builder works from the keyboard' },
            { file:'scanner-test.mjs', name:'unit pairs × 8 operators — same units validate, different units are UNIT_MISMATCH' },
            { file:'equity-test.mjs', name:'round 3 user: the builder starts from ?market=, ?from= and ?fromAlert=' }] },
  { name:'Setup persistence and versions', status:'beta', path:'/app/scanner/setups',
    brief:['SC-306'], priority:'P0',
    now:'Every setup keeps each version it has had, with the engine’s hash: a change to what it evaluates is a new version, a rename is not. Delete is a marker with Restore, because alerts name the versions. Export writes the worker’s file and round-trips with the same versions and hashes; each setup states whether the browser and the file are in step, and the file’s copy can be adopted. The worker keeps its own append-only ledger, so a setup edited in the file by hand takes the next version, and a version number reused for different content is refused.',
    gate:'Versions live in this browser’s storage and in the worker’s ledger on this machine: no ownership, no tables, no sync across devices. On the deployed site the file cannot be seen, and drift reads as not confirmed.',
    checks:[{ file:'equity-test.mjs', name:'scanner versions bump on evaluation fields only' },
            { file:'equity-test.mjs', name:'the scanner export round-trips' },
            { file:'equity-test.mjs', name:'the scanner setups page renders and evaluates on engine 0.3.0' },
            { file:'scanner-test.mjs', name:'SC-306 an unversioned setup gets v1 in the ledger' },
            { file:'scanner-test.mjs', name:'SC-306 a version number reused for different content is refused' }] },
  { name:'Daily scanner worker', status:'beta', path:'/admin/scanner/jobs',
    brief:['SC-307'], priority:'P0',
    now:'node scanner/scan.mjs runs after the daily capture, self-tests its engine first, evaluates each setup on each instrument’s final bars and exits 0, 1, 2 or 3 by outcome. A missed day is caught up on the next run, up to ten bars, each on the history as it stood; --as-of replays a date, narrowed by setup or market; the daily run holds back a market whose session is not yet final. The runs page lists every attempt it recorded, with duration, counts and errors, and the control log.',
    gate:'There is no scheduler service or job queue: your task scheduler starts it, a run in progress is only a lock file, and nothing is ever queued. Final data is judged by the clock, because no provider confirms it.',
    checks:[{ file:'scanner-test.mjs', name:'an unreadable alerts file is left alone and the run exits 1' },
            { file:'scanner-test.mjs', name:'a setup no instrument holds enough bars for exits 2' },
            { file:'equity-test.mjs', name:'the operations pages render the worker files read-only' },
            { file:'scanner-test.mjs', name:'SC-307 the worker catches up' },
            { file:'scanner-test.mjs', name:'SC-307 --as-of DATE --setup ID replays one setup' },
            { file:'scanner-test.mjs', name:'SC-301 --ready: a history whose MY last bar is PROVISIONAL' }] },
  { name:'Alert event engine', status:'beta', path:'/app/scanner',
    brief:['SC-308'], priority:'P0',
    now:'An alert is an immutable record keyed by setup, version, instrument, timeframe, bar and event: new-match or every-match, a cooldown in bars, the setup snapshot and every condition’s values. A retry or replay never records the same key twice. The dashboard lists the last scan’s matches under a date.',
    gate:'No user id — there are no users — and no authorised data source id: the source is the reader’s own history.',
    checks:[{ file:'scanner-test.mjs', name:'the same bar is not recorded twice' },
            { file:'scanner-test.mjs', name:'the V2 alert carries every contract field' },
            { file:'scanner-test.mjs', name:'five bars above 11: EVERY_MATCH records all five' }] },
  { name:'Email notifications', status:'compliance', path:'/app/scanner/settings',
    brief:['SC-309'], priority:'P0',
    now:'The in-app half is built: an alerts centre with an unread count (none shown, never “0”, when no alerts file is visible), per-setup muting, and a settings page that lists email, Telegram and push as not configured with the reason and no switch.',
    gate:'Sending email needs a server to send from, an operating entity to send as, and a contact address held under a PDPA privacy notice. None exists, so the in-app record is the only channel.',
    checks:[{ file:'equity-test.mjs', name:'scanner alert status persists across a reload' },
            { file:'equity-test.mjs', name:'the scanner pages state their empty cases' }] },
  { name:'Alert history and detail', status:'beta', path:'/app/scanner/alerts',
    brief:['SC-310'], priority:'P0',
    now:'Every recorded alert by candle date, then detection time — no column sorts by a value — filtered by setup, symbol, status and bar date held in the address, marked read, archived or new in bulk, paged, and downloaded as CSV in the same order. An alert’s page draws the closes up to its bar, states the bar, its volume and status, the setup version and hash, every condition’s unrounded values and reasons, the source and data version, and evaluates the setup again on the history cut at that bar, naming any close that has changed since.',
    gate:'Status is held in this browser, not shared across devices. Daily bars only; lineage stops at what the history file records.',
    checks:[{ file:'equity-test.mjs', name:'scanner alert status persists across a reload' },
            { file:'equity-test.mjs', name:'page resolves from its id — candle date' },
            { file:'scanner-test.mjs', name:'the V2 alert carries every contract field' },
            { file:'equity-test.mjs', name:'round 3 user: an alert is evaluated again on the history cut at its bar' },
            { file:'equity-test.mjs', name:'round 3 user: the alert history pages, filters and orders 250 injected records by date alone' }] },
  { name:'Watchlist integration (scanner)', status:'beta', path:'/app/scanner/watchlists',
    brief:['SC-311'], priority:'P0',
    now:'Each watchlist with its members and whether a series is held for each, the setups that scan it, what has been added or removed since each setup’s snapshot, and their latest matches. A setup scans its snapshot, or the list as last exported for the scanner, which the worker reads at run time and falls back from to the snapshot, saying so.',
    gate:'The watchlist lives in this browser and the worker cannot read it: a setup scans its snapshot or the list as last exported, never the list as it is now.',
    checks:[{ file:'equity-test.mjs', name:'the watchlist handoff keeps its contract' },
            { file:'scanner-test.mjs', name:'a watchlist universe evaluates the symbols it snapshotted' },
            { file:'scanner-test.mjs', name:'SC-311 the worker reads data/watchlists.json at run time' },
            { file:'equity-test.mjs', name:'round 3 user: a watchlist setup can resolve from the scanner export' }] },
  { name:'Scanner dashboard', status:'beta', path:'/app/scanner',
    brief:['SC-312'], priority:'P0',
    now:'The four questions — are my setups active, when did the last scan succeed, which setups matched, are notifications working — answered from the run log and the alerts file, with the state (current, behind, failed, paused, no run recorded) and every reason dated. An old scan’s matches sit under a heading that says they are not current.',
    gate:'Staleness is judged against the reader’s own history and a four-day rule, not an exchange calendar. “Notifications” is answered with “no channel”, because none exists. On the deployed site no run log exists, and the page says so.',
    checks:[{ file:'equity-test.mjs', name:'the dashboard answers from persisted records in every state' },
            { file:'scanner-test.mjs', name:'scanStatus: no runs and no last run is' },
            { file:'scanner-test.mjs', name:'behind after a setups edit; failed (not current) when a failure follows a success' },
            { file:'scanner-test.mjs', name:'latest matches come in setup order, not file or close order' }] },
  { name:'Scanner operations (local, read-only)', status:'beta', path:'/admin/scanner',
    brief:['SC-313'], priority:'P0',
    now:'Four read-only pages over the worker’s own files, read in the shape the worker writes them: data sources and the last ingestion, sessions per market, runs by status, the alert engine’s counts, markets held back, catch-up and the version ledger, delivery, usage and errors with their run ids; data health per market and series; every run with its error; the channels. Each control is shown as the command that performs it.',
    gate:'No administrator role, access control or operator identity: there are no accounts, so the pages are read-only and say so, and the control log is a local append-only file, not an audit trail. No provider to disable and no job queue.',
    checks:[{ file:'equity-test.mjs', name:'the operations pages render the worker files read-only' },
            { file:'equity-test.mjs', name:'the scanner pages state which file is absent' },
            { file:'equity-test.mjs', name:'ops pages read the worker' },
            { file:'scanner-test.mjs', name:'ops fixture vs the worker' }] },
  { name:'Historical matches — simulation', status:'flagged', path:'/app/scanner/backtest',
    brief:['SC-314'], priority:'P1',
    now:'One setup over its universe or one instrument, bounded to the last 600 bars in a date range: coverage and missing sessions per instrument, every bar the conditions held with their values, where a match began, and what the worker would have recorded.',
    flag:'A simulation of the dates on which your conditions held in your own captured closes — not a backtest. It shows no return or performance because it has no entries, exits or costs, the closes are adjusted only for the splits you recorded and never for dividends, and anything you stopped tracking is absent.',
    checks:[{ file:'equity-test.mjs', name:'historical testing is labelled a simulation and shows no look-ahead' },
            { file:'scanner-test.mjs', name:'no look-ahead: evaluating at bar i equals evaluating the history cut at i' },
            { file:'scanner-test.mjs', name:'recorded bars equal a day-by-day scanRun replay' },
            { file:'scanner-test.mjs', name:'integration: --backtest applies the splits recorded beside the history' }] },
  { name:'Telegram notifications', status:'compliance', path:null,
    brief:['SC-315'], priority:'P1',
    gate:'A bot token must live on a server, and binding a chat id is holding a contact identifier under a privacy notice; neither exists. Listed on the delivery page as not configured.' },
  { name:'Market screening over your own series', status:'flagged', path:'/app/scanner/market',
    brief:['SC-316'], priority:'P1',
    now:'One setup over a market’s instruments that hold a series in your history, each on its last final bar, as matched, not matched and untested with the values — now, or replayed as of a date. Recorded nowhere.',
    flag:'Screens only instruments with a series in your own history — not the market — and lists them in symbol order; no order by any value is offered, because a list ordered by strength is a pick list. Offering a screen to anyone else needs a licensed feed and legal classification.',
    checks:[{ file:'equity-test.mjs', name:'market screening lists your own series in symbol order, never by value' },
            { file:'scanner-test.mjs', name:'a market universe reads the instrument registry' },
            { file:'equity-test.mjs', name:'market screening hands the builder its market and setup' }] },
  { name:'Intraday scanner infrastructure', status:'queued', path:null,
    brief:['SC-317'], priority:'P2',
    gate:'Intraday data rights, streaming or polling infrastructure and legal review. The engine refuses 1H, 15M and 5M with the reason and no page offers them; bars reserve a timestamps field for them, which nothing fills.' },
  { name:'Live push notifications', status:'queued', path:null,
    brief:['SC-318'], priority:'P2',
    gate:'A push service and a server to hold subscriptions, for the later live-scanning release.' },
  { name:'Scanner QA and the Phase 3 release rule', status:'active-core', path:'/status',
    brief:['SC-319'], priority:'P0',
    now:'The brief’s 24-item scanner checklist mapped to automated checks or to the reason one cannot exist (docs/phase3-qa.md). The register check reads the Phase 3 plan as well, holds every scanner row to its priority, refuses a P2 row that looks available, and tests each of its own rules against a register built to break it.',
    gate:'Email failure, delivery retries and cross-user access cannot be tested: there is no email, no delivery and no users. register-check --release phase3 stays red while authorised data and email are blocked by decision.',
    checks:[{ file:'register-check.mjs', name:'every P2 row is out of reach' },
            { file:'scanner-test.mjs', name:'neither scanner data file is tracked by git' },
            { file:'sweep.mjs', name:'Phase 3 — the scanner' },
            { file:'mobile.mjs', name:'no horizontal overflow at any width' },
            { file:'register-check.mjs', name:'register-check self-test' }] },
  { name:'Alerts and monitoring', status:'beta', path:'/my/alerts',
    now:'Fact-change alerts.', gate:'Stale-data and duplicate controls are not yet implemented.' },
  { name:'Bring your own market data', status:'maintenance', path:'/my/data',
    now:'Paste closes; they stay in this browser and never reach the site.' },
  { name:'Multilingual property workflow', status:'beta', path:'/property/calculator',
    now:'Input labels, evidence grades and the ten risk questions in Bahasa Malaysia and Chinese.',
    gate:'The longer explanations remain English-only.' },
  { name:'Learn and methodology', status:'maintenance', path:'/learn',
    now:'Formulas, weights, anchor ranges and limitations.' },
  { name:'Plans and pricing', status:'maintenance', path:'/pricing',
    now:'Tiers and what each includes.',
    gate:'No payment is processed anywhere in this build, and none will be until the operating entity is registered.' },
  { name:'Brokerage connection and execution', status:'compliance', path:null,
    gate:'Not built and not activated. Requires licensing, suitability, custody and consent work well beyond this product’s current boundary.' },
  { name:'Personalised advice mode', status:'compliance', path:null,
    gate:'Would require written Malaysian legal classification and SC authorisation. The research boundary is a product design, not a disclaimer.' },
];

/* A FLAG THE READER CAN SEE.
   ---------------------------------------------------------------------------
   A flag recorded only on /status is a flag the reader of the flagged page
   never meets: they would use the compare table believing it complete. So the
   row is the switch, and the page reads it — render() asks which flagged row
   owns the view on screen and mounts that row's notice, so the register and
   the page cannot say different things, and lifting a flag is one edit here.
   A row owns a view when its path resolves to that view (and to its tab, when
   the path names one: the valuation row flags the valuation tab of every
   company, not the whole company page). Nothing is hidden; the notice states
   what is missing. */
function flagRowFor(view, tab) {
  return CAPABILITY_REGISTER.find(c => {
    if (c.status !== 'flagged' || !c.path) return false;
    const [p, q] = c.path.split('?');
    const rt = matchRoute(p);
    const want = new URLSearchParams(q || '').get('tab');
    return !!rt && rt.view === view && (!want || want === tab);
  }) || null;
}
function flagNoticeFor(row) {
  return el('div', { class: 'flag-notice', role: 'note', 'aria-label': `${row.name}: partial` }, [
    el('p', { class: 'flag-notice-hd' }, [el('span', { class: 'chip chip-bronze' }, `${row.priority || ''} · feature-flagged`.replace(/^ · /, '')),
      el('strong', {}, `${row.name} is partial.`)]),
    el('p', {}, row.flag),
    el('p', { class: 'metaline' }, [`Usable as it stands, and not counted as operational until that is built. `,
      el('a', { href: href('/status'), onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate('/status'); } }, 'Build status')]),
  ]);
}
/* Where the notice goes: under the page heading when the view has one, and on
   a company page above the tab panel it describes — the panel is the view's
   last child (45-views-research.js appends it last), and above the heading
   the notice would read as a statement about the whole company. */
function mountFlagNotice(node, view, tab) {
  const row = flagRowFor(view, tab);
  if (!row || !node?.children) return null;
  const notice = flagNoticeFor(row);
  const hd = [...node.children].find(n => n.classList?.contains('page-hd'));
  if (view === 'research' && node.lastElementChild) node.lastElementChild.before(notice);
  else if (hd) hd.after(notice);
  else node.prepend(notice);
  return row;
}

/* ==========================================================================
   PROPERTY OPPORTUNITY REGISTER — directive 6.7, specification 27.5

   A calculator answers "what would this deal do". A register answers "which
   deals exist, and what do we actually know about each" — and the second is
   the one that turns a tool into research.

   THE RULES THAT SHAPE IT

   A listing is not a recommendation, so nothing here is ordered by merit.
   Sorting is by recency or an explicit filter the reader chose, because a
   hidden merit rank is a recommendation wearing a sort order.

   "Available" is never shown unless availability was checked, and the date it
   was checked is shown beside it. A stale availability flag is worse than none:
   it sends someone to a property that sold weeks ago.

   Four prices are kept apart — asking, negotiated, bank valuation, registered
   valuer — because collapsing them is how a valuation gap disappears.

   A candidate with no verified rent, title or condition evidence stays U
   however good its yield looks. Yield on an unverified rent is arithmetic on a
   guess.

   Nothing is scraped. Each record carries where it came from, and the source is
   a reference the reader entered rather than content this product republished.
   ========================================================================== */
const CANDIDATE_STATES = [
  { id:'captured',           label:'Captured',              note:'Recorded from a listing or a conversation. Nothing verified.' },
  { id:'identity_verified',  label:'Identity verified',     note:'Address, title reference and attributes confirmed.' },
  { id:'evidence_gathering', label:'Gathering evidence',    note:'Rent, comparables, valuation and title evidence being collected.' },
  { id:'underwritten',       label:'Underwritten',          note:'Modelled and graded on the evidence held.' },
  { id:'conditional_dd',     label:'Conditional due diligence', note:'Proceeding subject to named verifications.' },
  { id:'finance_review',     label:'Finance review',        note:'With a lender or broker.' },
  { id:'closed',             label:'Acquired or closed',    note:'Concluded, either way.' },
  { id:'stale',              label:'Stale or withdrawn',    note:'No longer available, or not checked recently enough to say.' },
];

State.opportunities = store.read('opportunities', []);
const saveOpportunities = () => store.write('opportunities', State.opportunities);

/* Runs the underwriting engine over a candidate by layering its fields on the
   calculator's own defaults, so a register entry and a calculator run cannot
   diverge — one engine, two front doors. */
function candidateModel(o) {
  /* A record states what it states. Its checklist answers are its own — the
     calculator's answers used to be attributed to every record, raising their
     financeability — and a price it does not state is absent: a price of 0
     modelled a free property, with cash, cover and a rate of return off
     nothing. Without one the calculator's price stands in, as the table says. */
  const od = { ...(o.deal || {}) };
  const unpriced = !(num0(od.price) > 0);
  if (unpriced) delete od.price;
  if (!(num0(od.sqft) > 0)) delete od.sqft;
  const d = { ...State.deal, ...od, touched: o.touched || {}, evidence: o.evidence || {}, checks: o.checks || {} };
  const m = dealModel(d);
  return { d, m, grade: propertyGrade(d, m), finance: propertyFinanceability(d, m) };
}

const daysSince = (iso) => {
  if (!iso) return null;
  const n = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(n) ? n : null;
};

/* The figures typed for a cycle transition, until it is made, and the open
   leg they are for — see resolveInput. */
let wheelResolveDraft = { leg: null, figures: {} };
VIEWS.wheel = () => {
  /* Drawn again when the filings land — keepFocusThroughRedraw (70-property.js). */
  keepFocusThroughRedraw();
  const p = State.wheel;
  const m = wheelMath(p);
  const fit = wheelFit(p, m, null);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'US equities'),
    el('h1', {}, 'Options Cash Wheel'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'A fully collateralised cash-secured put and covered call cycle, modelled from figures you enter. Research and arithmetic — no chain data, no recommended contract, no execution.'),
  ])));

  /* "Fill in the identity" is gone once used, so focus goes to the banner's
     "Linked to …" heading rather than falling to <body>. */
  const wLink = workspaceLinkBanner('wheel', p, () => { saveWheel(); render(); focusAfterRedraw('#wheel-link h3'); });
  if (wLink) { wLink.id = 'wheel-link'; wrap.append(wLink); }

  /* Reset clears the figures on screen, and the cycle built from them: the
     contract, the legs, the cycle's state and basis, and the share count —
     which an assignment adds to, so leaving it would let the next covered
     call pass on shares that exist only in the cleared record. */
  wrap.append(workBar('wheel', () => {
    State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, ...WHEEL_BLANK_CYCLE, eligibleShares: 0, isWorkedExample: false };
    State.wheelLegs = [];
    saveWheel(); saveWheelLegs();
  }));

  /* NOTHING ENTERED YET IS A STATE, NOT AN ABSENCE.
     -----------------------------------------------------------------------
     The collateral bar and the expiry payoff are the two things this tool has
     that a spreadsheet does not, and both are computed from a contract — so
     until one is entered, neither exists. A first-time visitor therefore met a
     long empty form and no demonstration that anything would happen, which is
     how an external audit came to report the Cash Wheel as lacking the very
     graphics it contains. Checked on production: a fresh visit renders neither.

     Two named paths, because they are genuinely different intentions and the
     worked one must never be mistaken for the reader's own figures. It is
     stamped illustrative in the plan itself, not just in this copy. */
  if (!(num0(p.putStrike) > 0)) {
    const start = el('div', { class: 'card' });
    start.append(cardHead('Nothing entered yet',
      'This tool computes a collateral position and an expiry payoff from one contract. Enter yours, or load a worked one to see what it returns first.'));
    start.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
      /* This card goes once a contract is in, taking the button with it, and
         focus fell to <body>. It goes to the banner that replaces the card,
         on the control that undoes the load. */
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
        State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true };
        saveWheel(); render(); focusAfterRedraw('#wheel-clear-example');
        toast('Worked contract loaded — illustrative figures');
      } }, 'Load a worked contract'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
        const f = document.querySelector('#wheel-inputs input');
        if (f) { f.closest('.card')?.scrollIntoView({ block: 'start' }); f.focus(); }
      } }, 'Enter my own contract'),
    ]));
    start.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      'The worked contract uses round illustrative numbers on no particular company. It is not a quote, not a recommended contract, and no chain data is connected to this build.'));
    wrap.append(start);
  }

  /* Loaded sample figures that stop announcing themselves become the reader's
     figures by default, which is the failure this whole product is built
     against. The banner stays until they are replaced or cleared. */
  if (p.isWorkedExample) {
    const note = el('div', { class: 'card', style: 'border-left:3px solid var(--bronze)' });
    note.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:center' }, [
      el('span', { class: 'chip chip-bronze' }, 'Illustrative'),
      /* Precise rather than reassuring. The flag survives an edit on purpose:
         changing one field leaves the other five illustrative, and a banner
         that vanished on the first keystroke would certify a contract that is
         still mostly the example. */
      el('span', { style: 'font-size:14px' },
        'Loaded from the worked contract. Any field you have not changed is still an illustrative figure.'),
      /* A cycle run on the worked contract is illustrative too: its legs,
         state and basis were computed from the example's figures. Once this
         banner goes, nothing else would mark them, so they go with it — and
         so do the shares its assignments added, and only those. */
      /* It says "enter my own", and it left focus on <body> with the banner
         gone. It now does what "Enter my own contract" does: the contract
         card to the top, and the caret in its first field. */
      el('button', { class: 'btn btn-quiet btn-sm', id: 'wheel-clear-example', style: 'margin-left:auto', onclick: () => {
        const cycle = State.wheelLegs || [];
        const added = Math.max(0, wheelLedger(cycle).sharesHeld);
        State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, ...WHEEL_BLANK_CYCLE,
          eligibleShares: Math.max(0, num0(State.wheel.eligibleShares) - added), isWorkedExample: false };
        State.wheelLegs = [];
        saveWheel(); saveWheelLegs(); render();
        const f = document.querySelector('#wheel-inputs input');
        f?.closest('.card')?.scrollIntoView({ block: 'start' });
        focusAfterRedraw(f);
        toast(cycle.length ? 'Contract and its illustrative cycle cleared' : 'Contract cleared');
      } }, 'Clear and enter my own'),
    ]));
    wrap.append(note);
  }

  /* Fit and phase, then the two numbers 41A.15 requires above any yield. */
  const tone = { A:'--ok-text', B:'--bronze', C:'--bronze', D:'--dn-text', U:'--ink-2' }[fit.grade];
  const head = el('div', { class: 'card', style: `border-left:3px solid var(${tone})` });
  head.append(el('div', { class: 'row row-wrap', style: 'gap:12px;align-items:baseline' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'Wheel fit'),
      el('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, [
        el('span', { class: 'num', style: `font-size:32px;font-weight:700;color:var(${tone})` }, fit.grade),
        el('span', { style: 'font-size:14px;font-weight:500' },
          fit.grade === 'U' ? 'Not assessable' : 'Meets the criteria you selected'),
      ]),
    ]),
    el('div', { style: 'margin-left:auto;text-align:right' }, [
      el('div', { class: 'metaline' }, `Phase: ${p.phase === 'call' ? 'covered call' : 'cash-secured put'}`),
      el('div', { class: 'metaline' }, `Thesis: ${p.underlyingThesisStatus}`),
    ]),
  ]));

  /* THE CYCLE RAIL.
     Fourteen internal states drive the transitions; a reader needs to know
     which of six things is happening. The rail maps them, marks where the cycle
     actually is, and shows what has been passed — a lifecycle you can only
     infer from which buttons are enabled is one you have to reverse-engineer. */
  const STAGE = [
    { id:'thesis',     label:'Thesis',      states:['candidate'] },
    { id:'put',        label:'Put open',    states:['put_planned', 'put_open'] },
    { id:'assignment', label:'Assigned',    states:['put_assigned', 'shares_held'] },
    { id:'call',       label:'Call open',   states:['call_planned', 'call_open'] },
    { id:'resolve',    label:'Closed',      states:['put_expired', 'put_closed', 'call_expired', 'call_closed', 'called_away'] },
    { id:'done',       label:'Reconciled',  states:['complete'] },
  ];
  const atIdx = STAGE.findIndex(s => s.states.includes(p.state));
  const rail = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:var(--md)' });
  STAGE.forEach((s, i) => {
    const done = atIdx > -1 && i < atIdx;
    const here = i === atIdx;
    rail.append(el('span', {
      class: here ? 'chip chip-ok' : 'chip',
      style: `${done ? 'opacity:.55' : ''}${here ? ';font-weight:700' : ''}`,
      title: here ? `The cycle is here. Internal state: ${p.state}.` : (done ? 'Passed.' : 'Not reached.'),
    }, `${done ? '✓ ' : ''}${s.label}`));
    if (i < STAGE.length - 1) rail.append(el('span', { class: 'metaline', style: 'opacity:.4' }, '→'));
  });
  head.append(rail);
  if (p.state === 'paused') head.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
    'This cycle is paused. The rail shows where it stopped, not where it ended.'));

  /* COLLATERAL AGAINST THE OBLIGATION.
     -----------------------------------------------------------------------
     Cash-secured is a binary gate and the figure deciding it used to be a
     percentage in a sentence, then a div bar clamped with Math.min(100, …).
     Two problems with the clamp: someone holding $10,000 against a $5,000
     obligation saw exactly the same full bar as someone holding $5,000 to the
     cent, and the obligation itself was never drawn, so "how far short" was
     only ever readable from the caption.

     It also filled with --ok-text and --dn-text, which are text tokens doing a
     mark's job — and that specific green/rust pair measures ΔE 5.3 under
     deuteranopia, below the floor that any secondary encoding can rescue.

     Now the same threshold bar the property calculator uses: a real scale, so
     surplus is visible, the obligation drawn as the line to reach, and the
     measured polarity pair. */
  if (m.requiredAssignmentCash > 0) {
    const req = m.requiredAssignmentCash;
    const have = num0(p.eligibleCashUsd);
    const bar = el('div', { class: 'render-block', style: 'margin-top:var(--md)' });
    bar.append(el('span', { class: 'eyebrow' }, 'Collateral against the obligation'));
    const barHost = el('div', { style: 'margin-top:5px' });
    bar.append(barHost);
    thresholdBar(barHost, {
      value: have, valueLabel: 'cash reserved',
      threshold: req, thresholdLabel: 'obligation',
      ccy: 'USD',
      aria: (covers, gap) => `Cash reserved ${fmtMoney(have, 'USD')} against an assignment obligation of `
        + `${fmtMoney(req, 'USD')}. `
        + (covers ? `Fully secured, with ${fmtMoney(gap, 'USD')} beyond the obligation.`
                  : `Short by ${fmtMoney(gap, 'USD')}, so the put is not cash-secured.`),
    });
    bar.append(el('p', { class: 'metaline', style: 'margin-top:5px' },
      m.cashSecured
        ? `Fully secured, with ${fmtMoney(have - req, 'USD')} beyond the obligation. The premium is not part of this and never reduces it.`
        : `Short by ${fmtMoney(Math.max(0, req - have), 'USD')}. A put is not cash-secured below 100%, and the premium received does not count toward it.`));
    head.append(bar);
  }

  /* The shape of the obligation, once there is one to draw. */
  if (num0(p.putStrike) > 0 && m.deliverableShares > 0) {
    const pay = el('div', { class: 'card', style: 'margin-top:var(--md)' });
    pay.append(cardHead('What this pays, at expiry',
      'Arithmetic on the strike, premium and multiplier you entered. Not a forecast, and no probability is implied — the horizontal axis is the underlying price, not time.'));
    const host = el('div', { style: 'margin-top:var(--md)' });
    pay.append(host);
    /* payoffChart appends its own table view — the rows are derived beside the
       marks they describe, so they cannot drift from them. The copy that used to
       be built here rendered a second table of the same figures directly beneath
       the first, and computed the payoff a second time to fill it. */
    payoffChart(host, m, p);
    pay.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The flat section is every price at or above the strike, where the premium is the entire result. '
      + 'Everything left of the strike is the shares being put to you at a price the market has left behind.'));
    wrap.append(pay);
  }

  /* Obligation and downside first. Deliberately before any premium figure. */
  const risk = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
  risk.append(el('div', { class: 'panel' }, statTile('Full assignment cash',
    m.valid ? fmtMoney(m.requiredAssignmentCash, 'USD') : '—',
    { sub: m.valid ? `${m.deliverableShares} shares at ${fmtMoney(num0(p.putStrike), 'USD')}, plus fees` : 'Enter the contract first' })));
  risk.append(el('div', { class: 'panel' }, statTile('In ringgit, with your buffer',
    m.valid ? fmtAmount(m.safeAssignmentCashMyr, 'MYR') : '—',
    { sub: `${num0(p.fxBufferPct)}% FX buffer plus conversion cost` })));
  risk.append(el('div', { class: 'panel' }, statTile('Maximum modelled downside',
    m.valid ? fmtMoney(m.putMaxLossIfZero, 'USD') : '—',
    { sub: 'If the underlying went to zero, after the premium', tone: '--dn-text' })));
  head.append(risk);
  head.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'These appear before any premium figure deliberately. The obligation is the size of the decision; the premium is the smaller number beside it.'));
  wrap.append(head);

  if (fit.gates.length) {
    const g = el('div', { class: 'card', style: 'border-left:3px solid var(--dn-text)' });
    g.append(cardHead(`Not assessable — ${fit.gates.length} gate${fit.gates.length === 1 ? '' : 's'} open`,
      'These are refusals, not deductions. A gate cannot be offset by a good score elsewhere.'));
    const ul = el('ul', { class: 'ticklist blocklist' });
    fit.gates.forEach(x => ul.append(el('li', {}, x)));
    g.append(ul);
    wrap.append(g);
  }

  /* Inputs. */
  const inputs = el('div', { class: 'card', id: 'wheel-inputs' });
  inputs.append(cardHead('The contract and your cover', 'Entered by you. This build carries no option-chain data.'));
  const nf = (k, label, step) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `w-${k}` }, label));
    f.append(el('input', { class: 'input input-inline', id: `w-${k}`, type: 'number', step: step || 1,
      value: String(p[k] ?? 0), style: 'text-align:right',
      onchange: e => { p[k] = num0(e.target.value); saveWheel(); renderAfterTyping(); } }));
    return f;
  };
  const cb = (k, label) => {
    const l = el('label', { class: 'checkline', style: 'gap:8px;display:flex;margin-top:6px' });
    l.append(el('input', { type: 'checkbox', id: `w-${k}`, checked: p[k] ? '' : null,
      onchange: e => { p[k] = e.target.checked; saveWheel(); renderKeepFocus(); } }));
    l.append(el('span', {}, label));
    return l;
  };
  inputs.append(el('p', { class: 'eyebrow', style: 'margin:10px 0 6px' }, 'Contract'));
  [['contractMultiplier', 'Contract multiplier (shares per contract)', 1],
   ['contracts', 'Number of contracts', 1],
   ['putStrike', 'Put strike (USD)', 0.5],
   ['putCredit', 'Put credit per share (USD)', 0.01],
   ['openCommission', 'Opening commission (USD)', 1],
   ['openFees', 'Opening option fees (USD)', 0.01],
   ['assignmentFees', 'Estimated assignment fees (USD)', 1]].forEach(([k, l, s]) => inputs.append(nf(k, l, s)));
  inputs.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Your cover'));
  [['eligibleCashUsd', 'Eligible USD cash reserved', 100],
   ['eligibleShares', 'Unencumbered shares held', 1],
   ['myrPerUsd', 'MYR per USD (0 uses the site rate)', 0.01],
   ['fxBufferPct', 'FX buffer (%)', 1],
   ['calendarDaysOpen', 'Days the contract is open', 1]].forEach(([k, l, s]) => inputs.append(nf(k, l, s)));
  inputs.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Covered call, once shares are held'));
  [['callStrike', 'Call strike (USD)', 0.5],
   ['callCredit', 'Call credit per share (USD)', 0.01],
   ['callOpenCommission', 'Opening commission (USD)', 1]].forEach(([k, l, s]) => inputs.append(nf(k, l, s)));

  inputs.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Attestations'));
  inputs.append(cb('willingToOwnFull', `I am willing and able to buy all ${m.valid ? m.deliverableShares : '—'} shares at the strike, even if the market price is far below it`));
  inputs.append(cb('willingToSellAtStrike', 'I am willing to sell the entire covered quantity at the call strike'));
  inputs.append(cb('optionsApprovalAttested', 'I hold the broker options approval and US market access this would require'));
  inputs.append(cb('eventWindowClear', 'I have checked earnings, ex-dividend and corporate-action dates in the contract window'));
  inputs.append(cb('adjustedContract', 'This is an adjusted contract'));
  if (p.adjustedContract) inputs.append(cb('adjustmentVerified', 'I have verified the adjusted deliverable and multiplier from the contract terms'));
  const qt = el('div', { class: 'field', style: 'margin-top:8px' });
  qt.append(el('label', { for: 'w-qt' }, 'Quote timestamp'));
  qt.append(el('input', { class: 'input', id: 'w-qt', type: 'datetime-local', value: p.quoteTimestamp || '',
    onchange: e => { p.quoteTimestamp = e.target.value; saveWheel(); renderKeepFocus(); } }));
  inputs.append(qt);
  const th = el('div', { class: 'field', style: 'margin-top:8px' });
  th.append(el('label', { for: 'w-th' }, 'Underlying thesis status'));
  const ths = el('select', { class: 'select', id: 'w-th',
    onchange: e => { p.underlyingThesisStatus = e.target.value; saveWheel(); renderKeepFocus(); } });
  ['unknown', 'failed', 'review', 'pass'].forEach(v => ths.append(el('option', { value: v, selected: p.underlyingThesisStatus === v ? '' : null }, v)));
  th.append(ths);
  inputs.append(th);
  wrap.append(inputs);

  /* Cover checks — pass or refuse, never a partial score. */
  if (m.valid) {
    const cov = el('div', { class: 'card' });
    cov.append(cardHead('Collateral checks', 'Binary by design. Below 100% is a refusal, not a lower grade.'));
    const ct = el('table', { class: 'dt' });
    ct.append(el('thead', {}, el('tr', {}, ['Check', 'Required', 'You have', 'Coverage', 'Result'].map((h, i) =>
      el('th', { style: i === 0 ? 'text-align:left' : null }, h)))));
    const ctb = el('tbody');
    ctb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, 'Cash secures the put'),
      el('td', { class: 'num' }, fmtMoney(m.requiredAssignmentCash, 'USD')),
      el('td', { class: 'num' }, fmtMoney(num0(p.eligibleCashUsd), 'USD')),
      el('td', { class: 'num' }, isNum(m.cashCoveragePct) ? fmtPct(m.cashCoveragePct * 100, 1) : '—'),
      el('td', {}, m.cashSecured ? sevChip('good', 'Cash-secured') : sevChip('serious', 'Not cash-secured')),
    ]));
    ctb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, 'Shares cover the call'),
      el('td', { class: 'num' }, `${m.requiredCoveredShares}`),
      el('td', { class: 'num' }, `${num0(p.eligibleShares)}`),
      el('td', { class: 'num' }, isNum(m.shareCoveragePct) ? fmtPct(m.shareCoveragePct * 100, 1) : '—'),
      el('td', {}, m.covered ? sevChip('good', 'Covered') : sevChip('serious', 'Not covered')),
    ]));
    ct.append(ctb); cov.append(el('div', { class: 'tablewrap' }, ct));
    cov.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The premium is not deducted from the cash requirement. A broker’s treatment of unsettled premium, withdrawal rules and settlement state are not knowable here, and reserving less than the full exercise cost is how a cash-secured put stops being cash-secured.'));
    wrap.append(cov);

    /* Premium and the open obligation, side by side.
       The obligation row follows the cycle. It used to describe the put as
       open whatever had happened to it, so after an assignment this card said
       "an obligation to buy 100 shares" while the ledger below said "none". */
    const cycleLegs = State.wheelLegs || [];
    const putStillOpen = cycleLegs.some(l => l.phase === 'put' && l.status === 'open');
    const putOutcome = putStillOpen ? null
      : cycleLegs.some(l => l.action === 'assign') ? 'none — the put was assigned and the shares bought'
      : p.state === 'put_expired' ? 'none — the put expired'
      : p.state === 'put_closed' ? 'none — the put was bought back'
      : null;
    const prem = el('div', { class: 'card' });
    prem.append(cardHead('Premium, and what is still owed',
      'Cash received is not realised profit while the option is open.'));
    const pk = el('dl', { class: 'kv' });
    [['Premium cash received', fmtMoney(m.putPremiumCashReceived, 'USD')],
     ['Still open against it', putOutcome || `an obligation to buy ${m.deliverableShares} shares at ${fmtMoney(num0(p.putStrike), 'USD')}`],
     ['Period cash yield', isNum(m.putPeriodCashYield) ? fmtPct(m.putPeriodCashYield * 100, 2) : '—'],
     ['Simple annualised illustration', isNum(m.simpleAnnualisedPutYield) ? fmtPct(m.simpleAnnualisedPutYield * 100, 1) : '—'],
     ['Economic basis if assigned', isNum(m.economicShareBasis) ? fmtMoney(m.economicShareBasis, 'USD') : '—'],
     ['Break-even at expiry', isNum(m.putBreakEven) ? fmtMoney(m.putBreakEven, 'USD') : '—']]
      .forEach(([k, v]) => { pk.append(el('dt', {}, k)); pk.append(el('dd', {}, v)); });
    prem.append(pk);
    prem.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The annualised figure is a simple illustration from this single premium and holding period. It does not assume another contract can be sold on the same terms, it is not an expected annual return, and it is not comparable to a dividend yield — the denominators and the obligations are different.'));
    wrap.append(prem);

    /* Downside scenarios. */
    const sc = el('div', { class: 'card' });
    sc.append(cardHead('If the underlying falls', 'Put result at expiry, at the moves 41A.8 requires.'));
    const st = el('table', { class: 'dt' });
    st.append(el('thead', {}, el('tr', {}, ['Underlying move', 'Price at expiry', 'Put result'].map(h => el('th', {}, h)))));
    const stb = el('tbody');
    [0, -10, -20, -30, -50, -100].forEach(mv => {
      const px = num0(p.putStrike) * (1 + mv / 100);
      const s = wheelScenario(p, m, px);
      stb.append(el('tr', {}, [
        el('td', { class: 'ident' }, mv === 0 ? 'at the strike' : `${mv}%`),
        el('td', { class: 'num' }, fmtMoney(px, 'USD')),
        el('td', { class: 'num ' + signClass(s.shortPutPnl) }, fmtMoney(s.shortPutPnl, 'USD')),
      ]));
    });
    st.append(stb); sc.append(el('div', { class: 'tablewrap' }, st));
    wrap.append(sc);

    /* Covered call, including the case the premium hides. */
    if (num0(p.callStrike) > 0) {
      const cc = el('div', { class: 'card' });
      cc.append(cardHead('Covered call', 'What you receive, and what you give up.'));
      const ck = el('dl', { class: 'kv' });
      [['Premium cash received', fmtMoney(m.callPremiumCashReceived, 'USD')],
       ['Called-away value', fmtMoney(m.calledAwayGrossValue, 'USD')],
       ['Break-even', isNum(m.coveredCallBreakEven) ? fmtMoney(m.coveredCallBreakEven, 'USD') : '—'],
       ['Maximum profit on this call', isNum(m.coveredCallMaxProfit) ? fmtMoney(m.coveredCallMaxProfit, 'USD') : '—'],
       ['Maximum loss if it goes to zero', isNum(m.coveredCallMaxLoss) ? fmtMoney(m.coveredCallMaxLoss, 'USD') : '—']]
        .forEach(([k, v]) => { ck.append(el('dt', {}, k)); ck.append(el('dd', {}, v)); });
      cc.append(ck);
      if (m.callBelowBasis) cc.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px;color:var(--dn-text)' },
        `The call strike is below your economic basis. If assigned, this locks in a loss of ${fmtMoney(m.lockedInLossIfCalled, 'USD')} after the premium. The premium is not income in that case — it reduces a loss you have agreed to take.`));
      cc.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
        'Above the strike the shares are sold and further upside is not captured. American-style short calls can be assigned before expiry, and attention rises near an ex-dividend date.'));
      wrap.append(cc);
    }
  }

  /* ---- cycle state and ledger (41A.5, 41A.11, 41A.13) ------------------ */
  const legs = State.wheelLegs || [];
  const led = wheelLedger(legs);
  const st = p.state || 'candidate';
  const stDef = WHEEL_STATES.find(x => x.id === st) || WHEEL_STATES[0];
  const allowed = WHEEL_TRANSITIONS[st] || [];
  const openLeg = legs.find(l => l.status === 'open');

  const cyc = el('div', { class: 'card' });
  cyc.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'Cycle state'),
      el('h3', { class: 'h-card', id: 'wheel-cycle-state', tabindex: '-1', style: 'margin:0' }, stDef.label),
    ]),
    el('span', { class: 'chip', style: 'margin-left:auto' },
      `${legs.length} leg${legs.length === 1 ? '' : 's'} recorded`),
  ]));
  cyc.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'Only the transitions this state permits are offered. A cycle cannot skip assignment, and a leg cannot be resolved twice.'));

  /* Where a transition needs a figure, it is asked for rather than assumed. */
  /* AND WHAT IS TYPED FOR IT IS KEPT UNTIL THE TRANSITION.
     These fields were the only copy of the figures, drawn at 0, and the page
     redraws on every contract field (renderAfterTyping) and when the filings
     land. A close debit of 1.20 and a commission of 0.65, then the contract
     corrected above them, came back 0 and 0 — and "I bought it back"
     recorded the buy-back as free, its realised result overstated by
     $120.65 on 100 shares. Held as typed for the open leg they resolve, let
     go by the transition that reads them, and never offered to another leg
     (a reset, a resumed cycle). */
  if (wheelResolveDraft.leg !== (openLeg?.id ?? null)) wheelResolveDraft = { leg: openLeg?.id ?? null, figures: {} };
  const figures = wheelResolveDraft.figures;
  const resolveInput = (label, id) => {
    const f = el('div', { class: 'field', style: 'max-width:230px;margin-top:8px' });
    f.append(el('label', { for: id }, label));
    f.append(el('input', { class: 'input', id, type: 'number', step: '0.01', value: figures[id] ?? '0',
      oninput: e => { figures[id] = e.target.value; } }));
    return f;
  };
  const numFrom = (id) => num0(document.getElementById(id)?.value);
  /* The button pressed is usually gone once the state moves, so focus goes to
     the state it moved to rather than falling to the top of the page. */
  const go = (next) => { p.state = next; wheelResolveDraft = { leg: null, figures: {} }; saveWheel(); render(); document.getElementById('wheel-cycle-state')?.focus(); };

  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });

  /* A new cycle starts a new ledger, and says so first when the last one
     still has legs in it — it cleared them without a word. */
  if (allowed.includes('put_planned')) acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
    if (legs.length && !confirm(`Starting a new cycle clears the ${legs.length} leg${legs.length === 1 ? '' : 's'} recorded for the last one. Continue?`)) return;
    State.wheelLegs = []; saveWheelLegs(); go('put_planned');
  } }, 'Start a cycle'));

  if (allowed.includes('put_open')) acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!m.valid) { toast('Enter the contract first'); return; }
    if (!m.cashSecured) { toast('Not cash-secured — the full assignment cash must be reserved'); return; }
    addWheelLeg({ phase:'put', action:'open', status:'open',
      contractLabel:`${p.symbol || 'Underlying'} ${num0(p.putStrike)}P`, strike:num0(p.putStrike),
      shares:m.deliverableShares, grossPremium:m.grossPutPremium,
      commissions:num0(p.openCommission), fees:num0(p.openFees),
      netCash:m.putPremiumCashReceived, capitalCommitted:m.requiredAssignmentCash,
      currentCloseCost:0 });
    go('put_open');
  } }, 'Record the put as opened'));

  if (st === 'put_open') {
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash),
        note:'Expired worthless. The premium becomes realised at this point and not before.' };
      saveWheelLegs(); go('put_expired');
    } }, 'It expired worthless'));
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const debit = numFrom('w-closedebit') * num0(l.shares) + numFrom('w-closecomm');
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash) - debit,
        note:'Bought back before expiry.' };
      addWheelLeg({ phase:'put', action:'close', status:'resolved', contractLabel:l.contractLabel,
        shares:l.shares, netCash:-debit, realisedPnl:null, commissions:numFrom('w-closecomm'),
        parentLegId:l.id, note:'Closing cash. The realised result sits on the opening leg it closed.' });
      go('put_closed');
    } }, 'I bought it back'));
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash),
        note:'Assigned. The premium is realised; the share position now carries the risk.' };
      addWheelLeg({ phase:'shares', action:'assign', status:'resolved',
        contractLabel:l.contractLabel, shares:l.shares,
        cashPaid: num0(l.strike) * num0(l.shares) + num0(p.assignmentFees),
        fees:num0(p.assignmentFees), capitalCommitted:num0(l.strike) * num0(l.shares),
        note:`Bought ${l.shares} shares at ${fmtMoney(num0(l.strike), 'USD')}.` });
      p.eligibleShares = num0(p.eligibleShares) + num0(l.shares);
      /* Both are frozen at assignment. The cost basis settles realised share
         P&L; the economic basis is the break-even the projections read. Storing
         only the second is how the ledger came to measure a gain against a
         number that already contained the premium it then added again. */
      p.shareCostBasisOverride = m.shareCostBasis;
      p.economicShareBasisOverride = m.economicShareBasis;
      p.phase = 'call'; saveWheel(); saveWheelLegs(); go('shares_held');
    } }, 'It was assigned'));
    cyc.append(el('div', { class: 'row row-wrap', style: 'gap:10px' }, [
      resolveInput('Close debit per share (USD)', 'w-closedebit'),
      resolveInput('Closing commission (USD)', 'w-closecomm'),
    ]));
  }

  if (allowed.includes('call_planned')) acts.append(el('button', { class: 'btn btn-sm', onclick: () => go('call_planned') }, 'Plan a covered call'));

  if (allowed.includes('call_open')) acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!m.valid) { toast('Enter the contract first'); return; }
    if (!m.covered) { toast('Not covered — the full share deliverable must be held and unencumbered'); return; }
    addWheelLeg({ phase:'call', action:'open', status:'open',
      contractLabel:`${p.symbol || 'Underlying'} ${num0(p.callStrike)}C`, strike:num0(p.callStrike),
      shares:m.requiredCoveredShares, grossPremium:m.grossCallPremium,
      commissions:num0(p.callOpenCommission), fees:num0(p.callOpenFees),
      netCash:m.callPremiumCashReceived, capitalCommitted:0 });
    go('call_open');
  } }, 'Record the call as opened'));

  if (st === 'call_open') {
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash), note:'Expired. Shares retained.' };
      saveWheelLegs(); go('call_expired');
    } }, 'It expired, shares retained'));
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      /* The COST basis, not the economic one. The put premium is already
         realised as option P&L on its own leg; measuring the share gain against
         a basis that had subtracted it counted it a second time and overstated
         a completed cycle by exactly the premium. */
      const basis = isNum(p.shareCostBasisOverride) ? p.shareCostBasisOverride
                  : isNum(m.shareCostBasis) ? m.shareCostBasis : 0;
      const proceeds = num0(l.strike) * num0(l.shares);
      /* Sold shares are no longer held. Assignment adds the deliverable to
         the unencumbered count; without the matching subtraction the next
         cycle's covered-call check passed on shares already sold, and a
         second assignment made 100 into 200. */
      p.eligibleShares = Math.max(0, num0(p.eligibleShares) - num0(l.shares));
      saveWheel();
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash), note:'Assigned — shares sold at the strike.' };
      addWheelLeg({ phase:'shares', action:'called_away', status:'resolved',
        contractLabel:l.contractLabel, shares:l.shares,
        shareSaleProceeds: proceeds,
        realisedSharePnl:(num0(l.strike) - basis) * num0(l.shares),
        note:`Sold ${l.shares} shares at ${fmtMoney(num0(l.strike), 'USD')} for ${fmtMoney(proceeds, 'USD')}, `
           + `against a cost basis of ${fmtMoney(basis, 'USD')}. The put premium is reported separately as option P&L, not netted into this basis.` });
      saveWheelLegs(); go('called_away');
    } }, 'Shares were called away'));
  }

  /* EVERY OTHER PERMITTED TRANSITION, SO NO STATE IS A DEAD END.
     Only the transitions with a leg to record had buttons. After a put
     expired or was bought back, after a covered call expired, after the
     shares were called away, and after "Start a cycle" on a blank contract,
     nothing was offered but "Clear the cycle" — which deletes the ledger —
     so the next call could not be written and "Cycle complete" and "Paused"
     could never be reached, on a page that says only the permitted
     transitions are offered. These move the state and record no leg; the
     ledger stays as it is. Pausing is not offered while a leg is open,
     because both ways out of Paused would leave that leg unresolved. */
  const PLAIN = {
    candidate:   { put_planned: 'Cancel the planned put', paused: 'Resume — back to candidate',
                   complete: 'Begin again as a candidate' },
    shares_held: { call_planned: 'Cancel the planned call', paused: 'Resume — shares held' },
    complete:    {},
    paused:      {},
  };
  const plainLabel = (to) => PLAIN[to]?.[st]
    || { candidate: 'Back to candidate — ready for the next put', shares_held: 'Shares held — plan the next call',
         complete: 'Mark the cycle complete', paused: 'Pause the cycle' }[to];
  allowed.filter(to => !['put_planned', 'put_open', 'call_planned', 'call_open'].includes(to)
      && !(st === 'put_open' || st === 'call_open'))
    .forEach(to => acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go(to) }, plainLabel(to))));

  /* The roll, which can only ever be two legs. */
  if (openLeg) {
    /* Open again after a redraw while it holds figures typed into it. */
    const rollBox = el('details', { style: 'margin-top:var(--md)', open: Object.keys(figures).some(k => k.startsWith('r-')) ? '' : null });
    rollBox.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'Roll this contract'));
    rollBox.append(el('p', { class: 'metaline', style: 'margin:8px 0' },
      'A roll is recorded as two transactions: closing the current contract and opening a new one. The realised result of the leg being closed is kept whatever the net cash looks like — a roll can show a credit and still have lost money, and that is exactly when the net figure alone misleads.'));
    const rg = el('div', { class: 'row row-wrap', style: 'gap:10px' });
    [['Close debit per share', 'r-debit'], ['New strike', 'r-strike'],
     ['New credit per share', 'r-credit'], ['Commissions each side', 'r-comm']]
      .forEach(([l, id]) => rg.append(resolveInput(l, id)));
    rollBox.append(rg);
    rollBox.append(el('button', { class: 'btn btn-sm', style: 'margin-top:8px', onclick: () => {
      const res = rollWheelLeg(openLeg, numFrom('r-debit'), {
        label:`${p.symbol || 'Underlying'} ${numFrom('r-strike')}${openLeg.phase === 'call' ? 'C' : 'P'}`,
        strike:numFrom('r-strike'), shares:num0(openLeg.shares),
        creditPerShare:numFrom('r-credit'),
        openCommission:numFrom('r-comm'), closeCommission:numFrom('r-comm') });
      toast(`Closed leg realised ${fmtMoney(res.realisedOnClose, 'USD')}; net roll ${fmtMoney(res.netRollCash, 'USD')}`);
      /* As go() does for every other change to the cycle: the redraw took
         the button, and focus goes to the cycle's state, not to <body>. */
      wheelResolveDraft = { leg: null, figures: {} };
      render(); focusAfterRedraw('#wheel-cycle-state');
    } }, 'Record the roll'));
    cyc.append(rollBox);
  }

  if (legs.length) acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
    if (!confirm('Clear this cycle and all its legs?')) return;
    State.wheelLegs = []; saveWheelLegs(); p.state = 'candidate'; p.phase = 'put';
    p.economicShareBasisOverride = null; p.shareCostBasisOverride = null; wheelResolveDraft = { leg: null, figures: {} }; saveWheel(); render();
    focusAfterRedraw('#wheel-cycle-state');
  } }, 'Clear the cycle'));
  cyc.append(acts);

  /* The ledger. */
  if (legs.length) {
    const lt = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
    lt.append(el('thead', {}, el('tr', {}, ['Phase', 'Action', 'Contract', 'Cash', 'Realised', 'State'].map((h, i) =>
      el('th', { style: i <= 2 || i === 5 ? 'text-align:left' : null }, h)))));
    const lb = el('tbody');
    legs.forEach(l => lb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, l.phase),
      el('td', { style: 'text-align:left' }, l.action),
      el('td', { style: 'text-align:left;white-space:normal' }, [
        el('div', {}, l.contractLabel || '—'),
        l.note ? el('div', { class: 'caption' }, l.note) : null,
      ]),
      el('td', { class: 'num ' + signClass(num0(l.netCash)) }, isNum(l.netCash) ? fmtMoney(l.netCash, 'USD') : '—'),
      el('td', { class: 'num ' + signClass(num0(l.realisedPnl)) },
        isNum(l.realisedPnl) ? fmtMoney(l.realisedPnl, 'USD')
          : el('span', { class: 'caption' }, l.status === 'open' ? 'still open' : '—')),
      el('td', { style: 'text-align:left' }, l.status === 'open'
        ? el('span', { class: 'chip chip-bronze' }, 'open obligation')
        : el('span', { class: 'caption' }, 'resolved')),
    ])));
    lt.append(lb);
    cyc.append(el('div', { class: 'tablewrap' }, lt));

    /* 41A.11 totals, kept apart. */
    const tk = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
    [['Premium cash received', fmtMoney(led.premiumCashReceived, 'USD')],
     ['Realised option profit or loss', fmtMoney(led.realisedOptionPnl, 'USD')],
     ['Open obligation', led.openLegs ? `${led.openLegs} leg still open` : 'none'],
     ['Share acquisition cash', fmtMoney(led.shareAcquisitionCash, 'USD')],
     ['Share sale proceeds', led.shareSaleProceeds ? fmtMoney(led.shareSaleProceeds, 'USD') : '—'],
     ['Realised share profit or loss', fmtMoney(led.realisedSharePnl, 'USD')],
     ['Commissions and fees', fmtMoney(led.commissions + led.fees, 'USD')],
     ['Total realised cycle result', fmtMoney(led.totalRealisedCyclePnl, 'USD')],
     /* The same total from cash movements alone. Shown beside the total rather
        than checked in private, because a reader is entitled to see that the
        two agree — and to see it immediately if they ever stop. */
     ['Same total from cash movements', led.cycleClosed ? fmtMoney(led.cashFlowRealised, 'USD')
        : led.sharesHeld > 0 && !led.openLegs ? '— (shares still held)' : '— (cycle still open)'],
     ['Maximum capital committed', fmtMoney(led.maxCapitalCommitted, 'USD')],
     ['Return on maximum committed', isNum(led.cycleReturnOnMaxCommitted)
        ? fmtPct(led.cycleReturnOnMaxCommitted * 100, 2) : '—']]
      .forEach(([k, v]) => { tk.append(el('dt', {}, k)); tk.append(el('dd', {}, v)); });
    cyc.append(tk);
    if (!led.reconciles) cyc.append(el('div', { class: 'note', style: 'margin-top:var(--md);border-left:3px solid var(--dn-text)' },
      el('p', { class: 'body', style: 'font-size:13px' },
        `These two totals disagree by ${fmtMoney(led.reconciliationGap, 'USD')}. On a closed cycle they cannot: `
        + `one is built from each leg's own result, the other from cash that actually moved, and both describe the `
        + `same cycle. A difference means a figure has been counted twice or not at all, so neither total should be `
        + `relied on until it is resolved. Please report this — the corrections form is linked in the footer.`)));
    if (led.openLegs) cyc.append(el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' },
      `Premium cash received includes ${led.openLegs} leg that has not resolved. That cash is in the account and the obligation is still open — it is not profit yet, and the realised line above is the one that answers how this cycle has actually gone.`));
  }
  wrap.append(cyc);

  /* Risk card, per 41A.14. */
  const rc = el('div', { class: 'card' });
  rc.append(cardHead('What can go wrong', 'Plain language, before any yield.'));
  const rl = el('ul', { class: 'ticklist' });
  ['You may have to buy the full deliverable at the strike even if the market value is far lower.',
   'If the underlying becomes worthless, the put loss approaches the whole assignment amount less the premium.',
   'A covered call caps your upside — if assigned, the shares go at the strike however high the price went.',
   'Call premium offsets only a small part of a large share-price fall.',
   'American-style short options can be assigned before expiration, including out of the money near an ex-dividend date.',
   'Earnings and corporate events can move the underlying beyond anything modelled here.',
   'Wide spreads and thin open interest can make closing or rolling materially more expensive.',
   'A USD gain can shrink or reverse in ringgit after currency moves and conversion costs.',
   'One standard contract can create a large single-stock position, because the deliverable is usually substantial.',
   'Splits, mergers and special distributions change what a contract delivers.',
   'Broker approval, collateral treatment, exercise cutoffs and tax treatment all vary.']
    .forEach(x => rl.append(el('li', {}, x)));
  rc.append(rl);
  rc.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'Read the OCC’s Characteristics and Risks of Standardized Options before writing any option. This page is arithmetic on figures you entered — it is not a recommendation to write a put or a call, it names no best strike or expiry, and it connects to no broker.'));
  wrap.append(rc);

  const boundary = el('div', { class: 'card' });
  boundary.append(cardHead('What this is gated on',
    'Research mode only, and the gates are named rather than implied.'));
  boundary.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'No option-chain data. Every contract figure here is one you entered, and there is no licensed chain this product may redistribute.'),
    el('li', {}, 'No recommended contract. Filters and arithmetic only — “best strike” is not an output this product will produce.'),
    el('li', {}, 'No broker connection, order routing, automatic rolling or execution. Those are Compliance Gated and not built.'),
    el('li', {}, 'A roll would be recorded as a close plus a separate new opening, so a net credit could never conceal the realised result of the leg being closed.'),
  ]));
  wrap.append(boundary);
  return wrap;
};

