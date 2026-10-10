/* ==========================================================================
   PUBLIC PAGES — THE HOMEPAGE AND HOW IT WORKS (Release A)

   The homepage answers three questions and stops: what this is, what you can
   do with it, and where your work lives. It used to carry the whole product
   at once — three engine readouts in the hero, a report demo, a property deal
   check, a trust grid, a routing band and a pricing strip — which read as a
   trading terminal to somebody who had not yet decided what they came for.
   None of it is lost. The examples moved to /how-it-works, still drawn by the
   same engines, each beside the workflow it illustrates; the trust links are
   in the Resources menu and the footer; pricing is in the header; the "not
   sure where to start" route (/start) is offered by the dashboard.

   The four products — their task, blurb, question, action and status — are
   read from PRODUCTS (35-ui.js), so the homepage, the header's menu, the
   sidebar and this page cannot describe one product four different ways.
   The dashboard lives at /app; this is what the domain root serves.
   ========================================================================== */

/* A status badge by status alone — the legend on /how-it-works and the
   homepage's disclosure line, where no one product is meant. Same classes as
   productBadge (35-ui.js), so the two cannot look different. */
function pubStatusBadge(status, title) {
  return el('span', { class: `status-badge status-${status}`, title: title || null }, (typeof TOOL_STATUS !== 'undefined' ? TOOL_STATUS : PRODUCT_STATUS)[status] || status);
}
/* A product's own badge: productBadge hands back a fresh element (its
   toString is its markup, for pages that build with strings), so the card
   can give it the id its aria-describedby names. */
const pubBadge = (p) => productBadge(p.id) || pubStatusBadge(p.status, p.statusNote);

/* An in-app link that keeps the browser's own link behaviour: a modified or
   middle click opens a tab, as every other internal link in the product does. */
function pubLink(path, attrs, ...kids) {
  return el('a', { href: href(path), ...attrs,
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(path); } }, ...kids);
}
/* A link to a section of this page. Scrolled here rather than left to the
   fragment: a changed hash fires popstate, and the router would repaint the
   page under the scroll. Focus moves to the section's heading, so the next
   Tab continues from where the reader was sent. Ids are prefixed (products,
   hiw-*) so none can be read as one of the legacy #view links fromHash()
   still honours. */
function pubJump(targetId, attrs, ...kids) {
  return el('a', { href: `#${targetId}`, ...attrs, onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    const t = document.getElementById(targetId);
    if (!t) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    const h = t.querySelector('h2') || t;
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  } }, ...kids);
}

const PUB_GLYPH = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  loop: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>',
};
const pubSvg = (name, size) => ICON[name] ? icon(name, size)
  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:${size}px;height:${size}px;flex:none">${PUB_GLYPH[name] || ''}</svg>`;
const pubArrow = () => el('span', { class: 'pub-arrow', 'aria-hidden': 'true', html: pubSvg('arrow', 16) });
/* The product's icon from the shell's table (PRODUCT_ICON, 35-ui.js), so a
   product looks the same on its card as in the menu, the sidebar and its
   tab row: Equities was a document here and a chart everywhere else. */
const pubIcon = (id) => el('span', { class: 'pub-ico', 'aria-hidden': 'true', html: pubSvg(PRODUCT_ICON[id] || 'grid', 22) });
const pubGlyph = (name) => el('span', { class: 'pub-glyph', 'aria-hidden': 'true', html: pubSvg(name, 18) });

/* ==========================================================================
   THE HOMEPAGE, DECLUTTERED (plan Phase 3A and 3B; the owner's decisions D5,
   D6, D17 and D22, 5 Oct 2026), on the layout system (37-layout-system.js).
   It said everything in prose — 557 drawn words, no figure — and twice
   said what the data is. Now: the held headline, a lede of eight words and
   one action; three products, each a task, a qualifier with its ⓘ, and a
   visual of what the product does, drawn from its own engine; Business as
   one line of text; and an example path through the work, drawn, with no
   figure, name or count in it. The strip above every page carries the one
   disclosure line; every sentence that left is one action away — in an ⓘ,
   the strip's Details, /how-it-works or /my/data.
   THE BUDGETS (plan 3.6; build --check holds the served page to them):
   the hero 15 words or fewer; a card 12 outside its figure and its action;
   a figure 20 (numbers, dates and axis ticks not counted); main 110 outside
   its figures; at least two data visuals; one disclosure line above the
   footer — the strip.
   What it reads: nothing the reader keeps, and no base currency — Apple's
   figures are in its filing currency, the sample deal's in ringgit — so the
   served page stands for every reader, wherever they are (the head's
   script never hides it).
   ========================================================================== */

/* APPLE'S FILED REVENUE AND NET INCOME, from data/us.json, written into the
   app by the build (homeFiled, build.mjs) so the page draws them in its
   first draw, before the filings load, and served-check holds them to the
   file the site serves. US$ billions, by fiscal year. */
const HOME_FILED = /*@INJECT:homeFiled*/ null;

/* A product's qualifier and its ⓘ: the badge and its few words in sight,
   and the full note one press away — a native <details>, so it opens with
   no script, from the keyboard as from a finger — with where every label is
   explained. The card's link is described by both (aria-describedby). */
function pubQualifier(p, id) {
  return el('div', { class: 'pub-card-qual' }, [
    productBadge(p.id, { qualified: true, qualId: id('q') }),
    el('details', { class: 'pub-info' }, [
      el('summary', { class: 'pub-info-btn' }, [
        el('span', { class: 'pub-info-i', 'aria-hidden': 'true' }),
        el('span', { class: 'sr-only' }, `What ${PRODUCT_STATUS[p.status]} means for ${p.name}`),
      ]),
      el('p', { class: 'pub-info-body' }, [
        el('span', { id: id('note') }, p.statusNote), ' ',
        el('a', { href: '/how-it-works#hiw-status', class: 'pub-textlink' }, 'What the labels mean'),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------- the visuals */
/* EQUITIES: Apple's filed revenue and net income, a pair of columns a
   fiscal year, in US$ whatever the reader's base currency; the Filed badge;
   and the measure no filed company can carry here. Linked to Apple's page. */
function pubVisEquities() {
  const F = HOME_FILED;
  const fig = el('figure', { class: 'pub-vis pub-vis-eq', 'aria-labelledby': 'pub-vis-eq-src' });
  if (!F || !F.years?.length) { fig.append(el('figcaption', { class: 'pub-vis-cap', id: 'pub-vis-eq-src' }, kindBadge('unavailable'), ' Filed example not loaded')); return fig; }
  /* The shared component (filedColumnsSvg, 30-charts.js), as Research's
     examples draw it. */
  const svg = filedColumnsSvg(F);
  fig.append(el('a', { class: 'pub-vis-link', href: href(F.path), 'data-path': F.path, 'aria-label': `${F.name}’s filed statements` }, el('span', { class: 'pub-vis-plot', html: svg })));
  fig.append(el('figcaption', { class: 'pub-vis-cap' }, [
    el('p', { class: 'pub-vis-src', id: 'pub-vis-eq-src' }, [kindBadge('filed', { fine: `${F.name}, SEC 10-K` }), el('span', {}, `${F.name.replace(/ Inc\.?$/, '')} · SEC 10-K · US$`)]),
    el('p', { class: 'pub-vis-legend', 'aria-hidden': 'true' }, [el('i', { class: 'pub-sw pub-sw-rev' }), 'Revenue', el('i', { class: 'pub-sw pub-sw-ni' }), 'Net income']),
    el('p', { class: 'pub-vis-row' }, [el('span', { class: 'pub-vis-k' }, 'P/E'), kindBadge('unavailable', { fine: 'P/E needs a price' }), el('span', {}, 'no licensed price')]),
  ]));
  return fig;
}

/* SCANNER: the rule the builder starts from, as its condition chips, read
   from the builder's own blank (scanBlankCondition) and the engine's
   labels; and where a match is recorded. No chart and no count: no price
   ships with this site, so nothing here could match. */
function pubVisScanner() {
  const c = typeof scanBlankCondition === 'function' ? scanBlankCondition() : null;
  /* Each side as the builder names it, short: the price, or the indicator
     and its period ("EMA 50"). */
  const side = (s) => {
    const def = SCAN_INDICATORS[s?.indicator];
    if (s?.indicator === 'price') return 'Price';
    const n = def ? scanParams(s).params.n : null;
    const w = def && isNum(n) ? `${def.label} ${n}` : scanSideLabel(s);
    return w.charAt(0).toUpperCase() + w.slice(1);
  };
  const chips = c ? [side(c.left), SCAN_OPERATORS[scanOpName(c.op)]?.label || c.op, side(c.right)] : [];
  return el('figure', { class: 'pub-vis pub-vis-scan' }, [
    el('p', { class: 'pub-vis-k pub-vis-k-top' }, 'Starting rule'),
    el('p', { class: 'pub-rule', role: 'list', 'aria-label': 'The builder’s starting rule' }, chips.map((t, i) => el('span', { class: `pub-chip${i === 1 ? ' pub-chip-op' : ''}`, role: 'listitem' }, t))),
    el('div', { class: 'pub-record', 'aria-hidden': 'true' }, [0, 1, 2].map(() => el('div', { class: 'pub-record-row' }, [el('i'), el('i'), el('i')]))),
    el('figcaption', { class: 'pub-vis-cap pub-vis-empty' }, [
      el('span', { class: 'pub-vis-empty-mark', 'aria-hidden': 'true' }),
      el('span', {}, 'Matches are recorded by a worker you run, not by this site'),
    ]),
  ]);
}

/* PROPERTY: the Scenario Lab, compact, on the sample deal — its price knob
   (the Lab's own span and step) and three of its figures (LAB_FIGURES: the
   Lab's reading, wording and format), with where the month's rent goes.
   The sample deal only, never the reader's own deal: the page reads nothing
   the reader keeps, so it is the same page for every reader. Moving the
   price redraws the figures in place. */
const PUB_LAB_KEYS = ['instalment', 'safeCashRequired', 'cashflowMonthly'];
/* The price the reader moved it to, kept in this tab's memory only (never
   stored: the page reads nothing the reader keeps) so a redraw — the
   filings landing a moment after the page opens — leaves it where it was. */
let pubLabAt = null;
function pubLabRun(price) {
  const d = pmCopy(PROPERTY_DEFAULT_DEAL);
  d.price = price;
  return price > 0 ? { m: dealModel(d) } : null;
}
/* badgeLink: false where every target on the page is held to 44px
   (/property-investing): the badge is then its word and its note, not a
   link of its own. */
function pubVisProperty({ badgeLink = true } = {}) {
  const inp = LAB_INPUT_BY_K.price;
  const base = num0(PROPERTY_DEFAULT_DEAL.price);
  const [lo, hi] = inp.span(base);
  const at = isNum(pubLabAt) ? Math.min(hi, Math.max(lo, pubLabAt)) : base;
  const fig = el('figure', { class: 'pub-vis pub-vis-lab', 'aria-labelledby': 'pub-vis-lab-src' });
  const val = el('output', { class: 'pub-lab-price num', for: 'pub-lab-price', id: 'pub-lab-price-v' }, inp.shown(at));
  const range = el('input', { type: 'range', class: 'pub-lab-range', id: 'pub-lab-price', min: String(lo), max: String(hi), step: String(inp.step), value: String(at),
    'aria-valuetext': inp.shown(at) });
  const figs = el('dl', { class: 'pub-lab-figs' });
  const bars = el('span', { class: 'pub-lab-bars' });
  const paint = (price) => {
    const run = pubLabRun(price);
    const m = run?.m || {};
    figs.replaceChildren(...PUB_LAB_KEYS.map(k => {
      const f = LAB_FIGURES.find(x => x.key === k);
      const v = run ? f.read(m) : null;
      return el('div', { class: 'pub-lab-fig' }, [el('dt', {}, f.label()), el('dd', { class: `num${f.neg && isNum(v) && v < 0 ? ' neg' : ''}`, 'data-figure': k, 'data-v': isNum(v) ? String(v) : '' }, LAB_FORMATS[f.fmt](v))]);
    }));
    /* Where the month's rent goes: the rent, against the repayment and the
       rest of the month's costs (vacancy and running costs, the rent less
       what is left of it before the loan). What is left over, or short, is
       the monthly position above. */
    const rent = isNum(m.grossAnnualRent) ? m.grossAnnualRent / 12 : null;
    const rep = isNum(m.instalment) ? m.instalment : null;
    const costs = isNum(m.noi) && isNum(rent) ? rent - m.noi / 12 : null;
    const top = Math.max(rent || 0, (rep || 0) + (costs || 0)) || 1;
    const w = (v) => (Math.max(0, v || 0) / top * 100).toFixed(2);
    bars.innerHTML = `<svg class="pub-lab-svg" viewBox="0 0 100 22" preserveAspectRatio="none" role="img" aria-label="${esc(`A month: rent ${labMoney(rent)}; repayment ${labMoney(rep)} and other costs ${labMoney(costs)}.`)}">`
      + `<rect class="pub-bar pub-bar-rent" x="0" y="0" width="${w(rent)}" height="9" rx="1" data-v="${isNum(rent) ? rent : ''}"/>`
      + `<rect class="pub-bar pub-bar-rep" x="0" y="13" width="${w(rep)}" height="9" rx="1" data-v="${isNum(rep) ? rep : ''}"/>`
      + `<rect class="pub-bar pub-bar-cost" x="${w(rep)}" y="13" width="${w(costs)}" height="9" rx="1" data-v="${isNum(costs) ? costs : ''}"/></svg>`;
  };
  let said = null;
  range.addEventListener('input', () => {
    const v = Number(range.value);
    pubLabAt = v;
    val.textContent = inp.shown(v);
    range.setAttribute('aria-valuetext', inp.shown(v));
    paint(v);
    clearTimeout(said);
    said = setTimeout(() => {
      const t = [...figs.querySelectorAll('dt')].map((dt, i) => `${dt.textContent} ${figs.querySelectorAll('dd')[i].textContent}`).join(', ');
      const live = document.getElementById('liveStatus');
      if (live) live.textContent = `At ${inp.shown(v)}: ${t}.`;
    }, 700);
  });
  paint(at);
  fig.append(
    el('div', { class: 'pub-lab-knob' }, [el('label', { class: 'pub-vis-k', for: 'pub-lab-price' }, 'Price'), val, range]),
    figs,
    el('div', { class: 'pub-lab-flow' }, [bars,
      el('p', { class: 'pub-vis-legend', 'aria-hidden': 'true' }, [el('i', { class: 'pub-sw pub-sw-rent' }), 'Rent', el('i', { class: 'pub-sw pub-sw-rep' }), 'Repayment', el('i', { class: 'pub-sw pub-sw-cost' }), 'Costs'])]),
    el('figcaption', { class: 'pub-vis-cap' }, el('p', { class: 'pub-vis-src', id: 'pub-vis-lab-src' }, [kindBadge('illustrative', { fine: 'The sample deal', link: badgeLink }), el('span', {}, 'Sample deal — not a real listing')])),
  );
  return fig;
}
const PUB_VISUALS = { equities: pubVisEquities, scanner: pubVisScanner, property: pubVisProperty };

/* ONE PRODUCT, AS A CARD (plan 3.3). An <article>: its name, its task — the
   card's one action, an <h3> link stretched over the card — its qualifier
   with the ⓘ, and its visual. What sits over the stretched link (the ⓘ,
   the visual's own link and control, a badge, the Property card's second
   action) is its own target: no link, button or <details> inside a link.
   Business, which is not built, is not a card: one line of text below. */
function pubProductCard(p) {
  const id = (k) => `pub-${p.id}-${k}`;
  const card = el('article', { class: `pub-card ls-card pub-acc-${p.id}`, 'data-card': 'action', 'data-product': p.id, 'aria-labelledby': id('t') });
  card.append(el('div', { class: 'pub-card-top' }, [pubIcon(p.id), el('p', { class: 'pub-card-product', id: id('n') }, p.name)]));
  card.append(el('h3', { class: 'pub-card-title', id: id('t') },
    pubLink(p.actionPath, { class: 'pub-card-link ls-card-cta', 'aria-describedby': `${id('n')} ${id('q')} ${id('note')}` }, p.task, pubArrow())));
  card.append(pubQualifier(p, id));
  const vis = PUB_VISUALS[p.id];
  if (vis) card.append(vis());
  if (p.also) card.append(el('p', { class: 'pub-card-also' }, pubLink(p.also.path, { class: 'pub-textlink' }, p.also.label, pubArrow())));
  return card;
}

VIEWS.marketing = () => {
  const wrap = el('div', { class: 'pub pub-home' });

  /* -- 1. the hero: the held headline, the lede, one action ---------------- */
  const hero = el('section', { class: 'pub-hero', 'aria-labelledby': 'pub-hero-h' });
  hero.append(el('h1', { class: 'pub-h1', id: 'pub-hero-h' }, 'Make financial decisions with greater clarity.'));
  hero.append(el('p', { class: 'pub-lede' }, POSITIONING.lede));
  hero.append(el('div', { class: 'pub-ctas' }, pubLink('/app', { class: 'btn btn-primary pub-btn' }, 'Open your workspace', pubArrow())));
  wrap.append(hero);

  /* -- 2. the products, in the menu's order --------------------------------
     The question stays for the ear; to the eye the cards are the answer. */
  const products = el('section', { class: 'pub-section pub-products', id: 'products', 'aria-labelledby': 'pub-products-h' });
  products.append(el('h2', { class: 'sr-only', id: 'pub-products-h' }, 'What would you like to do?'));
  const built = PRODUCTS.filter(p => p.path && p.actionPath);
  products.append(el('div', { class: 'pub-cards' }, built.map(pubProductCard)));
  for (const p of PRODUCTS.filter(x => !x.path)) {
    products.append(el('p', { class: 'pub-soon', 'data-product': p.id }, [
      el('span', { class: 'pub-soon-name' }, p.name), ' · ', p.task, ' · ', pubStatusBadge(p.status, p.statusNote),
    ]));
  }
  wrap.append(products);

  /* -- 3. an example path through the work (plan 3.4, D22) ------------------
     Two step diagrams — research and property — each step a link to where
     it happens. Labelled an example; no figure, name or count. Saved work
     lives in this browser, said once, with where to read more. */
  const path = el('section', { class: 'pub-section pub-path', 'aria-labelledby': 'pub-path-h' });
  path.append(el('div', { class: 'pub-path-hd' }, [
    el('p', { class: 'pub-tag' }, 'Example path'),
    el('h2', { class: 'pub-h2', id: 'pub-path-h' }, 'Your research, connected.'),
  ]));
  const steps = (label, rows) => el('div', { class: 'pub-route' }, [
    el('h3', { class: 'pub-route-t', id: `pub-route-${label.toLowerCase()}` }, label),
    el('ol', { class: 'pub-steps', 'aria-labelledby': `pub-route-${label.toLowerCase()}` }, rows.map(([t, to, glyph]) => el('li', { class: 'pub-step' },
      pubLink(to, { class: 'pub-step-a' }, [el('span', { class: 'pub-step-node', 'aria-hidden': 'true', html: pubSvg(glyph, 16) }), el('span', { class: 'pub-step-t' }, t)])))),
  ]);
  path.append(el('div', { class: 'pub-routes' }, [
    steps('Research', [['A company', '/research', PRODUCT_ICON.equities], ['A watchlist', '/my/watchlists', 'list'], ['Your setup', '/app/scanner/setups/new', PRODUCT_ICON.scanner],
      ['A match, if you run the worker', '/app/scanner', 'bell'], ['Back to the company', '/research', 'loop']]),
    steps('Property', [['A property', '/property/calculator', PRODUCT_ICON.property], ['Its scenarios', '/property/lab', 'layout'],
      ['A, B and C compared', '/property/lab', 'scale'], ['Saved', '/property/models', 'bookmark']]),
  ]));
  path.append(el('div', { class: 'pub-path-ft' }, [
    el('p', { class: 'pub-saved' }, 'Saved in this browser — no account.'),
    el('details', { class: 'pub-info' }, [
      el('summary', { class: 'pub-info-btn' }, [el('span', { class: 'pub-info-i', 'aria-hidden': 'true' }), el('span', { class: 'sr-only' }, 'Where saved work is kept')]),
      el('p', { class: 'pub-info-body' }, ['There are no accounts and no copy on a server. ',
        pubLink('/my/data', { class: 'pub-textlink' }, 'Your data and the export'), ' is the copy that travels.']),
    ]),
    el('a', { class: 'pub-textlink pub-path-more', href: '/how-it-works#hiw-journey' }, 'How it connects', pubArrow()),
  ]));
  wrap.append(path);

  const wl = waitlistCard();
  if (wl) wrap.append(wl);
  return wrap;
};

/* ==========================================================================
   HOW IT WORKS — /how-it-works

   For each product, the workflow in plain words: what goes in, what the
   product does with it, what comes out, what is kept, and what a reader does
   next. Then the journey that joins them, what the status labels mean, and
   the examples that left the homepage — each still computed by the engine it
   illustrates, never typed in, and each saying where its figures came from.
   One primary action, the same as the homepage's: open the workspace.
   ========================================================================== */
/* The steps are this page's words about each product, keyed by the product's
   id. A product without an entry (Business Intelligence, which is not built)
   gets no steps: describing the workflow of something that does not exist
   would be the claim the brief forbids. */
const HIW_FLOW = {
  equities: [
    ['Input', 'A company. Search by ticker, name or Bursa code, or narrow the list in the screener or on the value map.'],
    ['Analysis', 'Statements, ratios and a valuation model chosen for the business type. Every figure shows its formula, its period and its source.'],
    ['Result', 'A report of what the company reported and what the model gives under assumptions you can see and change. No ratings, no target prices.'],
    ['Save', 'Put the company on a watchlist, save a valuation run or a comparison, or write an investment case.'],
    ['Next', 'Compare it with similar businesses, or write a scanner rule on the price history you supply for it.'],
  ],
  scanner: [
    ['Input', 'Your own rules — conditions on the price history you supply — and what to check: a watchlist, a market or named instruments.'],
    ['Analysis', 'Each rule is checked on every completed daily bar, by one engine shared by this page and the worker on your computer.'],
    ['Result', 'A record of which conditions held on which bar, with their values. A record, not a signal: nothing is ranked and nothing is sent.'],
    ['Save', 'Setups are kept in this browser with every version of each; the worker writes its matches to a file on your computer.'],
    ['Next', 'Open a match, read the values behind it, and go on to the company page where the instrument is a company, or to Tracked where it is followed by price only.'],
  ],
  property: [
    ['Input', 'The purchase: price, financing, rent and costs. The calculator starts on illustrative defaults and marks each one until you replace it.'],
    ['Analysis', 'Instalment, fees, maintenance, vacancy, tax on the rent and exit costs, in one deal model shared by the calculator and its printed record.'],
    ['Result', 'Cash to complete, safe cash, monthly cash flow, break-even rent, yield and rate of return — each with its working.'],
    ['Save', 'Save the deal as a snapshot, record the property on the opportunity register, or print the decision record.'],
    ['Next', 'Test it against the comparables you have recorded and the area screen for its town.'],
  ],
};
/* Where saved property models are a list of their own (My properties, the
   property model store), the calculator's result says "Save this property",
   then "Compare scenarios" — so the steps say it too, in those words. Until
   that store is in the build, the steps say what the calculator does now. */
function hiwFlow(id) {
  const steps = HIW_FLOW[id];
  const models = typeof toolById === 'function' ? toolById('models') : null;
  if (id !== 'property' || !steps || !models || !toolPresent(models)) return steps;
  return steps.map(([k, t]) => k === 'Save'
    ? [k, 'Save this property: it joins My properties with its inputs, and each scenario you save of it is kept beside it. Record it on the opportunity register, or print the decision record.']
    : k === 'Next' ? [k, 'Compare scenarios of it side by side, then test it against the comparables you have recorded and the area screen for its town.']
    : [k, t]);
}

/* ITS TOOLS, AND THEIR STATE HERE (audit 1, #2). Each tool of the product
   from the registry (TOOLS, 35-ui.js) — its badge, its sentence and its
   primary action — so this page says what the tab rows and the dashboard
   say. A tool that is delayed or unavailable here says why in place of its
   sentence, and one that cannot be used offers no action. */
function hiwTools(p) {
  const tools = typeof TOOLS !== 'undefined' ? TOOLS.filter(t => t.product === p.id && toolPresent(t)) : [];
  if (!tools.length) return null;
  const box = el('div', { class: 'hiw-tools' });
  box.append(el('h3', { class: 'hiw-tools-h', id: `hiw-${p.id}-tools` }, 'Its tools, and their state here'));
  box.append(el('ul', { class: 'hiw-tools-list', 'aria-labelledby': `hiw-${p.id}-tools` }, tools.map(t => {
    const s = toolState(t);
    return el('li', { class: `hiw-tool${s.actionable ? '' : ' hiw-tool-off'}`, data: { tool: t.id, state: s.status } }, [
      el('p', { class: 'hiw-tool-hd' }, [el('span', { class: 'hiw-tool-name' }, t.label), toolBadge(t)]),
      el('p', { class: 'hiw-tool-note' }, s.note),
      s.actionable && t.action ? pubLink(t.action.path, { class: 'pub-textlink hiw-tool-go' }, t.action.label, pubArrow()) : null,
    ]);
  })));
  return box;
}

function hiwSteps(p, steps) {
  const ol = el('ol', { class: 'hiw-steps', 'aria-label': `${p.name}, step by step` });
  steps.forEach(([k, t], i) => ol.append(el('li', { class: 'hiw-step' }, [
    el('span', { class: 'hiw-step-n', 'aria-hidden': 'true' }, String(i + 1)),
    el('div', { class: 'hiw-step-body' }, [el('p', { class: 'hiw-step-k' }, k), el('p', { class: 'hiw-step-t' }, t)]),
  ])));
  return ol;
}

/* A computed figure and what it is, side by side. */
function hiwFigure(figure, title, body, link) {
  return el('div', { class: 'hiw-figure' }, [
    figure,
    el('div', { class: 'hiw-cap' }, [
      el('h4', { class: 'hiw-cap-t' }, title),
      el('p', { class: 'hiw-cap-b' }, body),
      link || null,
    ]),
  ]);
}

/* THE PROOF, COMPUTED RATHER THAN DRAWN.
   Each card runs the real engine on a fixture and shows what comes back. No
   figure below is written by hand, and each says where it came from. */
function pubProofCard(title, source, rows, note) {
  const c = el('div', { class: 'proof-card' });
  c.append(el('div', { class: 'proof-hd' }, [
    el('span', { style: 'font-size:13px;font-weight:700' }, title),
    el('span', { class: 'proof-src' }, source),
  ]));
  /* Two passes, not three wrappers: every label, then every value. Siblings
     in one grid line up; nested wrappers do not when one of them wraps. */
  const r = el('div', { class: 'proof-row' });
  rows.forEach(([k]) => r.append(el('span', { class: 'pk' }, k)));
  rows.forEach(([, v, tone]) => r.append(el('span', { class: 'pv', style: tone ? `color:var(${tone})` : null }, v)));
  c.append(r);
  if (note) c.append(el('p', { class: 'proof-src', style: 'margin-top:8px' }, note));
  return c;
}

/* The property engine on whatever the calculator holds in this browser.
   What is still to be paid, as the calculator, its ledger and the decision
   record all say. This printed the whole completion figure, booking deposit
   included, so with RM5,000 paid at offer the card read "Cash to complete
   RM95.3k" beside a calculator that read RM90.3k under the same name. And a
   total with a line it cannot price says so, as those surfaces do: with the
   reserve unpriced (a loan tenure of 0) the card printed the safe cash as the
   answer where the calculator calls it "so far". Completion is short only by
   an acquisition or financing line, as the record reckons it; safe cash by
   any line. */
function hiwPropertyCard() {
  const pm = dealModel(State.deal);
  const pmShort = (groups) => (pm.missingCostLines || []).some(x => !groups || groups.includes(x.groupId));
  return pubProofCard('Sarawak property', 'your inputs', [
    [pmShort(['acquisition', 'financing']) ? 'Cash to complete so far' : 'Cash to complete', fmtAmount(pm.cashStillRequiredToComplete, 'MYR')],
    [pmShort(null) ? 'Safe cash so far' : 'Safe cash', fmtAmount(pm.safeCashRequired, 'MYR')],
    ['Monthly', isNum(pm.cashflowMonthly) ? fmtAmount(pm.cashflowMonthly, 'MYR') : '—',
      isNum(pm.cashflowMonthly) && pm.cashflowMonthly < 0 ? '--dn-text' : null],
  ], 'Computed live from the calculator’s current inputs, which start as illustrative defaults until you replace them.');
}

/* The Wheel engine on its worked contract alone. It was laid over the
   reader's own saved plan, so their open fees and conversion cost moved this
   card's "$50 strike" figures, and a plan marked as an unverified adjusted
   contract blanked all three to a dash. fmtAmount, not fmtMoney, so the cards
   share one scale: beside "RM95.3k" a "$5000.00" reads as a different kind of
   number. */
/* Its source is the worked contract, and it says so. It was tagged "figures
   you enter" — the tool's description, not this card's — so a reader who had
   entered their own contract read the fixed example's $5.0k under a tag
   that said the figures were theirs, and the ringgit line rested on a rate
   and a buffer the card never named. Both are the example's own inputs,
   read from it rather than retyped. */
function hiwWheelCard() {
  const ex = WHEEL_WORKED_EXAMPLE;
  const wm = wheelMath({ ...ex });
  return pubProofCard('US options Cash Wheel', 'worked example · illustrative', [
    ['Assignment cash', fmtAmount(wm.requiredAssignmentCash, 'USD')],
    ['In ringgit', fmtAmount(wm.safeAssignmentCashMyr, 'MYR')],
    ['Worst case', fmtAmount(wm.putMaxLossIfZero, 'USD'), '--dn-text'],
  ], `An illustrative contract, not yours and not a quote: ${ex.contracts} cash-secured put at a $${ex.putStrike} strike on ${ex.contractMultiplier} shares. `
    + `The ringgit line converts at the example’s ${ex.myrPerUsd} ringgit a dollar plus a ${ex.fxBufferPct}% currency buffer. `
    + 'The obligation is shown before any premium, because the obligation is the decision.');
}

/* The Trading Index on the specification's published example. */
function hiwTradingCard() {
  const qr = qttiRun(qttiWorkedExample());
  return pubProofCard('QT Trading Index', 'worked example §14', [
    ['Trend regime', String(qr.regime)],
    ['Tranche ready', String(qr.tranche), '--dn-text'],
    ['Screenshot conf.', String(qr.confidence)],
  ], `Three outputs, never blended. This example is blocked on ${qr.gates.length} conditions and the page names every one.`);
}

/* WHAT A COMPANY REPORT CONTAINS — the report preview that was the
   homepage's demo. A pick repaints only the panel, and focus stays on the
   pressed button: the whole page used to re-render under the reader's
   pointer, and the button that had focus was destroyed with it. */
const HIW_PICKS = [
  { id: 'MAYBANK', label: 'Maybank' }, { id: 'PBBANK', label: 'Public Bank' },
  { id: 'TENAGA', label: 'Tenaga' }, { id: 'AAPL-SEC', label: 'Apple' },
];
function hiwReportBody(r) {
  const out = [];
  /* The illustrative marker every other company surface carries. The panel
     showed synthetic Maybank scores and a valuation range with nothing saying
     they were synthetic. */
  if (!r.c.real) out.push(el('p', { class: 'metaline hiw-label' }, [
    illusChip(r.c), ` ${r.c.name}: illustrative figures — synthetic, not filed. They show what the report contains, not what the company reported.`]));
  else out.push(el('p', { class: 'metaline hiw-label' }, `${r.c.name}: from audited statements filed with the SEC.`));
  const score = (s) => (isNum(s?.score) ? `${s.score}/100` : '—');
  out.push(el('div', { class: 'grid grid-5 hiw-tiles' }, [
    statTile('Business quality', score(r.scores?.quality), { sub: 'margin durability, returns, consistency' }),
    statTile('Financial strength', score(r.scores?.strength), { sub: 'leverage, cover, liquidity' }),
    statTile('Valuation range', isNum(r.val?.vals?.bear) && isNum(r.val?.vals?.bull)
      ? `${fmtMoney(r.val.vals.bear, r.c.ccy)} – ${fmtMoney(r.val.vals.bull, r.c.ccy)}` : 'not computable',
      { sub: r.val?.pack?.name || '—' }),
    statTile('Principal risks', String((r.flags || []).length || 'none flagged'), { sub: 'raised from the reported figures' }),
    statTile('Data completeness', isNum(r.m?.coverage) ? `${r.m.coverage}%` : '—', { sub: 'computable ÷ applicable metrics' }),
  ]));
  out.push(el('div', { class: 'hiw-ex-actions' },
    el('a', { class: 'btn btn-ghost pub-btn', href: href(companyPath(r.c)),
      onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); openResearch(r.c.id); } },
      'Open the full report', pubArrow())));
  return out;
}
function hiwReportPreview() {
  const box = el('div', { class: 'hiw-example' });
  box.append(el('h4', { class: 'hiw-ex-t' }, 'What a company report contains'));
  box.append(el('p', { class: 'hiw-ex-b' }, 'Pick one. Five outputs, then the full report.'));
  const picks = HIW_PICKS.filter(p => BY_ID.has(p.id));
  if (!picks.length) { box.append(el('p', { class: 'metaline' }, 'The example companies are still loading.')); return box; }
  /* 'property' was a pick when this lived on the homepage; its figures are
     the property deal check below now, so a stored 'property' opens the
     first company. */
  if (!picks.some(p => p.id === State.demoPick)) State.demoPick = picks[0].id;
  const seg = el('div', { class: 'segmented hiw-seg', role: 'group', 'aria-label': 'Example company' });
  const panel = el('div', { class: 'hiw-panel' });
  const draw = () => {
    panel.replaceChildren(...hiwReportBody(BY_ID.get(State.demoPick)));
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === State.demoPick)));
  };
  picks.forEach(p => seg.append(el('button', { type: 'button', data: { pick: p.id },
    onclick: () => { State.demoPick = p.id; draw(); } }, p.label)));
  box.append(seg, panel);
  draw();
  return box;
}

/* THE KUCHING EXAMPLE, COMPUTED. Its figures were written by hand, and the
   engine disagreed with them for the very inputs stated beside them — the
   page then invited the reader to calculate their own and see different
   numbers. The example is the calculator's default deal at the stated price
   and rent, run through the same dealModel the calculator uses. */
function hiwDealCheck() {
  const EX_PRICE = 550000, EX_RENT = 1900;
  const exm = dealModel({ ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence },
    checks: {}, price: EX_PRICE, rent: EX_RENT });
  const rm0 = (v) => isNum(v) ? fmtMoney(v, 'MYR', 0) : '—';
  const upfront = isNum(exm.transactionCash) ? exm.transactionCash + (exm.improvementCash || 0) : null;
  const box = el('div', { class: 'hiw-example' });
  box.append(el('h4', { class: 'hiw-ex-t' }, 'A Sarawak property deal check'));
  box.append(el('p', { class: 'hiw-ex-b' }, `The calculator’s own model at ${rm0(EX_PRICE)} and ${rm0(EX_RENT)} a month.`));
  box.append(el('div', { class: 'hiw-panel' }, [
    el('div', { class: 'grid hiw-tiles hiw-tiles-6' }, [
      statTile('Purchase price', rm0(EX_PRICE)),
      statTile('Expected rent', rm0(EX_RENT), { sub: 'per month' }),
      statTile('Gross yield', fmtPct(exm.grossYield, 2), { sub: 'annual rent ÷ purchase price' }),
      statTile('Monthly cash flow', rm0(exm.cashflowMonthly), { sub: 'after instalment, maintenance and vacancy',
        tone: isNum(exm.cashflowMonthly) && exm.cashflowMonthly < 0 ? '--dn-text' : null }),
      statTile('Break-even rent', rm0(exm.breakEvenRent), { sub: 'rent needed to cover every cost' }),
      statTile('Cash required upfront', rm0(upfront), { sub: 'deposit, fees, renovation' }),
    ]),
    el('p', { class: 'metaline hiw-label', style: 'margin-top:var(--md)' },
      'Computed by the calculator’s own model from its illustrative defaults at this price and rent — an example, not a listing, with no verified comparables behind it. Enter your own numbers to get your own answer.'),
  ]));
  const towns = el('div', { class: 'hiw-pills' }, el('span', { class: 'hiw-pills-k' }, 'Model a purchase in'));
  ['Kuching', 'Sibu', 'Miri', 'Bintulu'].forEach(city =>
    towns.append(pubLink(`/property/calculator?city=${city.toLowerCase()}`, { class: 'hiw-pill' }, city)));
  box.append(towns);
  return box;
}

/* Each product's examples. Figures only where an engine computes them. */
const HIW_EXAMPLES = {
  equities: () => [
    hiwReportPreview(),
    hiwFigure(hiwWheelCard(), 'The US Options Cash Wheel',
      'Part of Equities Research: a cash-secured put and covered call cycle, modelled from a contract you enter. No option-chain data is connected.',
      pubLink('/us-options/wheel', { class: 'pub-textlink' }, 'Open the Cash Wheel', pubArrow())),
  ],
  /* The example on a generated series (N5b; the owner's decision D14c,
     87-scanner-ops.js) — how a rule is evaluated, and nothing about a
     market: no market's prices ship with this site. */
  scanner: () => [
    el('div', { class: 'hiw-scan-ex' }, scanExampleFigure({ id: 'hiw-scan-ex' })),
    hiwFigure(hiwTradingCard(), 'The QT Trading Index',
      'Part of Quantum Scanner: a multi-timeframe trend reading and a test of your own first-tranche rules, from chart evidence you record.',
      pubLink('/research/trading-index', { class: 'pub-textlink' }, 'Open the Trading Index', pubArrow())),
    el('div', { class: 'hiw-aside' }, [pubGlyph('info'), el('p', {},
      'The example above is drawn on a generated series. A match on your own instruments is recorded from price history you supply, and none ships with this site — so until yours is there, the scanner’s pages say what they would show.')]),
  ],
  property: () => [
    hiwDealCheck(),
    hiwFigure(hiwPropertyCard(), 'Your calculator, as it stands',
      'The same model on whatever the calculator holds in this browser now — its illustrative defaults until you replace them.'),
  ],
};

function hiwProduct(p) {
  const s = el('section', { class: `hiw-product pub-acc-${p.id}${p.path ? '' : ' hiw-product-soon'}`, id: `hiw-${p.id}`,
    'aria-labelledby': `hiw-${p.id}-h` });
  s.append(el('div', { class: 'hiw-product-hd' }, [
    el('div', { class: 'hiw-product-id' }, [pubIcon(p.id), el('div', {}, [
      el('h2', { class: 'hiw-product-name', id: `hiw-${p.id}-h` }, p.name),
      el('p', { class: 'hiw-product-q' }, p.question),
    ])]),
    el('div', { class: 'hiw-product-status' }, [pubBadge(p), el('p', { class: 'hiw-product-note' }, p.statusNote)]),
  ]));
  const steps = hiwFlow(p.id);
  if (steps && p.path) s.append(hiwSteps(p, steps));
  else s.append(el('p', { class: 'hiw-soon' }, `Planned: ${String(p.blurb || '').replace(/\.$/, '').toLowerCase()}. Its workflow is described here once it is built.`));
  const tools = p.path ? hiwTools(p) : null;
  if (tools) s.append(tools);
  /* The examples fold on a phone. Open, they made the page 10,876px — about
     thirteen screens at 390px — and the connected journey, the page's core
     idea, began near 9,000px. Folded behind "Worked examples", every one of
     them is a tap away and the steps and the journey come first; above 760px
     they are open, as the page was drawn. */
  const ex = p.path && HIW_EXAMPLES[p.id] ? HIW_EXAMPLES[p.id]() : null;
  /* An aside is a note about the examples, not one of them. */
  const exN = ex ? ex.filter(n => !n.classList?.contains('hiw-aside')).length : 0;
  if (ex && ex.length) {
    const folded = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
    s.append(el('details', { class: 'hiw-examples', open: folded ? null : '' }, [
      el('summary', { class: 'hiw-examples-sum' }, [el('h3', { class: 'hiw-examples-h' }, 'Worked examples'),
        el('span', { class: 'hiw-examples-n caption' }, `${exN === 1 ? 'One example' : `${exN} examples`}, computed by the product’s own model`)]),
      el('div', { class: 'hiw-examples-body' }, ex),
    ]));
  }
  if (p.path && p.action && p.actionPath) s.append(el('div', { class: 'hiw-product-ft' },
    pubLink(p.actionPath, { class: 'btn btn-ghost pub-btn' }, p.action, pubArrow())));
  return s;
}

/* The journey across the products, each step at the address where it
   happens. The last step has no link of its own: it is the first step again,
   reached from the match. */
const HIW_JOURNEY = [
  ['Research a company', 'Open its report: statements, ratios and a valuation model, each figure with its source.', '/research', productById('equities')?.action || 'Start research'],
  ['Add it to a watchlist', 'One control on the company page. The list is what you follow — and what a setup can check.', '/my/watchlists', 'Watchlists'],
  ['Create a setup', 'Write your own rule, and give it the watchlist as the instruments to check.', '/app/scanner/setups/new', productById('scanner')?.action || 'Create a setup'],
  ['A rule-match alert', 'When the rule holds on a daily close in the history you supplied, the match is recorded with its values. Nothing is sent anywhere.', '/app/scanner/alerts', 'Scanner alerts'],
  /* A match links to a company page only where its instrument is a company
     (scanSymbolLink, 86-scanner.js); a price-only instrument such as XAUUSD
     links to Tracked. The step said every match led to a company. */
  ['Back to the company', 'Each match names its instrument. Where that is a company, it links to the company page and the research picks up again; a price-only instrument links to Tracked.', null, null],
];
function hiwJourney() {
  const s = el('section', { class: 'hiw-journey', id: 'hiw-journey', 'aria-labelledby': 'hiw-journey-h' });
  s.append(el('div', { class: 'hiw-sec-hd' }, [
    el('h2', { class: 'pub-h2', id: 'hiw-journey-h' }, 'The connected journey'),
    el('p', { class: 'pub-body' }, 'The products hand work to one another. One path through them, from a company to a rule that checks it, and back.'),
  ]));
  const ol = el('ol', { class: 'hiw-path' });
  HIW_JOURNEY.forEach(([t, b, path, label], i) => ol.append(el('li', { class: 'hiw-path-step' }, [
    el('span', { class: 'hiw-path-n', 'aria-hidden': 'true', html: i === HIW_JOURNEY.length - 1 ? pubSvg('loop', 18) : String(i + 1) }),
    el('h3', { class: 'hiw-path-t' }, t),
    el('p', { class: 'hiw-path-b' }, b),
    path ? pubLink(path, { class: 'pub-textlink' }, label, pubArrow()) : null,
  ])));
  s.append(ol);
  return s;
}

/* What each status label means, and which products and tools carry it —
   read from PRODUCTS and the tool registry (TOOLS), so the legend cannot
   disagree with the badges below it. The last two are never written by
   hand: they are what a tool's state becomes from what loaded here
   (toolState, 35-ui.js), so their line says where they apply now. */
const HIW_STATUS = [
  ['live', 'Works end to end on data you enter or on filed data.'],
  ['beta', 'Works, with data or delivery still limited as its note says.'],
  ['demo', 'Illustrative data only.'],
  ['soon', 'Not built, nothing to open.'],
  ['delayed', 'Works, on a file older than its own date allows; its note says which file, and how old.'],
  ['unavailable', 'Cannot work here: a file it needs did not load, or is never on this site. Shown as text, never as a link.'],
];
function hiwStatus(P) {
  const s = el('section', { class: 'hiw-status', id: 'hiw-status', 'aria-labelledby': 'hiw-status-h' });
  s.append(el('h2', { class: 'hiw-status-h', id: 'hiw-status-h' }, 'What the labels mean'));
  const dl = el('dl', { class: 'hiw-status-list' });
  const tools = typeof TOOLS !== 'undefined' ? TOOLS.filter(t => t.product && toolPresent(t)).map(toolState) : [];
  HIW_STATUS.forEach(([st, meaning]) => {
    const derived = st === 'delayed' || st === 'unavailable';
    const who = derived
      ? tools.filter(x => x.status === st).map(x => `${productById(x.tool.product)?.short || ''} ${x.tool.label}`.trim())
      : P.filter(p => p.status === st).map(p => p.name);
    dl.append(el('div', { class: 'hiw-status-item' }, [
      el('dt', {}, pubStatusBadge(st)),
      el('dd', {}, [el('span', { class: 'hiw-status-m' }, meaning),
        el('span', { class: 'hiw-status-who' }, who.length ? `${derived ? 'Here, now' : 'Today'}: ${who.join(', ')}`
          : derived ? 'No tool here, now' : 'No product carries it today')]),
    ]));
  });
  s.append(dl);
  return s;
}

VIEWS.howItWorks = () => {
  const P = PRODUCTS;
  const wrap = el('div', { class: 'pub hiw' });

  const hd = el('div', { class: 'pub-hero hiw-hd' });
  hd.append(el('p', { class: 'pub-kicker' }, 'How it works'));
  hd.append(el('h1', { class: 'pub-h1 hiw-h1' }, 'From your question to a saved answer'));
  hd.append(el('p', { class: 'pub-lede' },
    'Each product starts from something you choose or enter, shows its working, and keeps what you save in this browser. '
    + 'Here is each one step by step, how they connect, and worked examples computed by the products’ own models.'));
  hd.append(el('div', { class: 'pub-ctas' }, pubLink('/app', { class: 'btn btn-primary pub-btn' }, 'Open your workspace', pubArrow())));
  /* A jump link for each product that is built. Business Intelligence was a
     fourth identical pill — a link, styled as a way into a product the brief
     says is never a link or a button. It is text here, with its badge, as on
     the homepage card; its section below is still on the page. */
  const toc = el('ul', { class: 'hiw-toc-list' });
  P.forEach(p => toc.append(el('li', {}, p.path
    ? pubJump(`hiw-${p.id}`, { class: 'hiw-toc-link' }, p.name)
    : el('span', { class: 'hiw-toc-soon' }, [p.name, pubBadge(p)]))));
  toc.append(el('li', {}, pubJump('hiw-journey', { class: 'hiw-toc-link' }, 'The connected journey')));
  hd.append(el('nav', { class: 'hiw-toc', 'aria-label': 'On this page' }, toc));
  wrap.append(hd);

  wrap.append(hiwStatus(P));
  const list = el('div', { class: 'hiw-products' });
  P.forEach(p => list.append(hiwProduct(p)));
  wrap.append(list);
  wrap.append(hiwJourney());

  wrap.append(el('section', { class: 'hiw-end', 'aria-labelledby': 'hiw-end-h' }, [
    el('h2', { class: 'pub-h2', id: 'hiw-end-h' }, 'All of it, in one workspace'),
    el('p', { class: 'pub-body' }, 'Open it to research a company, write a setup or model a property. What you save stays in this browser.'),
    el('div', { class: 'pub-ctas' }, pubLink('/app', { class: 'btn btn-primary pub-btn' }, 'Open your workspace', pubArrow())),
  ]));
  return wrap;
};

/* ==========================================================================
   START WITH MY GOAL — ROUTING, NOT ADVICE.
   ==========================================================================
   The homepage already had a task grid, and it was five links. A link grid
   answers "where is the thing" for someone who already knows which thing they
   want. It does nothing for the reader this product actually has to serve: one
   who has a question about a property or a contract and no idea that the
   answer lives behind a nav item called Discover.

   So: pick a goal, answer at most three more questions, and land in the right
   tool with what you said already filled in.

   THE LINE THIS MUST NOT CROSS. This routes a workflow. It does not ask what
   the reader wants to achieve financially, does not score their answers, and
   does not select an instrument for them — the questions only decide which
   tool opens and which fields are pre-set, and every one of them is a fact
   about the task rather than about the person. "Which city" is routing.
   "What return do you need" would not be, and is not asked.

   Both paths are named. "Use my own figures" and "Open a worked example" are
   different intentions and the second must never be mistaken for the first, so
   the destination keeps saying which it is — the property review queue, the
   Wheel's illustrative banner, the Trading Index coverage notes. */
/* Answers persist, the chosen goal does not. Returning to a page called "Start"
   and landing halfway through a form you filled in last week is a small
   surprise with no upside — the menu is the predictable entry. Re-picking the
   goal restores everything you said, which is what "Back preserves answers"
   actually asks for. */
State.launcher = { goal: null, a: store.read('launcherAnswers', {}) };
const saveLauncher = () => store.write('launcherAnswers', State.launcher.a);

const LAUNCH_GOALS = [
  { id:'property', label:'Check a Sarawak property',
    blurb:'What it costs to complete, what it costs to hold, and what would have to be true for it to pay for itself.',
    tool:'Property deal calculator' },
  { id:'company', label:'Research a US company',
    blurb:'Audited SEC filings, with every metric showing its formula, its period and what could not be computed.',
    tool:'Company report' },
  { id:'wheel', label:'Model options cash flow',
    blurb:'A cash-secured put and covered call cycle, from a contract you enter. No chain data is connected.',
    tool:'Options Cash Wheel' },
  { id:'trading', label:'Assess trend and first tranche',
    blurb:'A multi-timeframe reading and a test of your own entry rules, from chart evidence you record.',
    tool:'QT Trading Index' },
  { id:'screen', label:'Screen a market',
    blurb:'Narrow the universe on quality, financial risk or valuation evidence before reading anything in depth.',
    tool:'Stock screener' },
];

VIEWS.launcher = () => {
  const L = State.launcher;
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Start here'),
    el('h1', {}, 'Start with your goal'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Five things this product does. Pick one and it opens the right tool with what you tell it already filled in. '
      + 'These questions route a workflow — they are not a suitability assessment and nothing here recommends an investment.'),
  ])));

  /* ---- step 1: the goal ---- */
  if (!L.goal) {
    const grid = el('div', { class: 'grid g-2' });
    LAUNCH_GOALS.forEach(g => {
      const c = el('button', { class: 'card', style: 'text-align:left;cursor:pointer;border:1px solid var(--line);width:100%',
        onclick: () => { L.goal = g.id; saveLauncher(); render(); } });
      c.append(el('h3', { class: 'h-card' }, g.label));
      c.append(el('p', { class: 'body', style: 'font-size:14px;margin-top:6px' }, g.blurb));
      c.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, `Opens the ${g.tool}`));
      grid.append(c);
    });
    wrap.append(grid);

    /* THE THIRTY-SECOND PATH, offered beside the five goals rather than instead
       of them. Somebody who has not decided which of the five they want is
       exactly the person who should be allowed to look at a filled-in one
       first — and the honest empty states this product is built on are the
       reason that person otherwise sees nothing at all. */
    const demo = el('div', { class: 'card', style: 'margin-top:var(--md)' });
    demo.append(cardHead(hasWorkedExample() ? 'The worked example is loaded' : 'Or look at a filled-in one first',
      WORKED_EXAMPLE_NOTE));
    demo.append(workedExampleControls());
    wrap.append(demo);
    return wrap;
  }

  const goal = LAUNCH_GOALS.find(g => g.id === L.goal);
  const a = (L.a[L.goal] = L.a[L.goal] || {});
  const set = (k, v) => { a[k] = v; saveLauncher(); render(); };

  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
    el('h2', { class: 'h-card' }, goal.label),
    /* Back clears the goal and NOT the answers — a reader who changes their
       mind and comes back should not retype what they already told us. */
    el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-left:auto',
      onclick: () => { L.goal = null; saveLauncher(); render(); } }, 'Back'),
  ]));

  const q = (label, hint) => {
    card.append(el('h3', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, label));
    if (hint) card.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' }, hint));
  };
  const seg = (k, opts, dflt) => {
    const cur = a[k] ?? dflt;
    card.append(el('div', { class: 'segmented', style: 'flex-wrap:wrap' }, opts.map(([v, lab]) =>
      el('button', { 'aria-pressed': cur === v ? 'true' : 'false', onclick: () => set(k, v) }, lab))));
    return cur;
  };

  let open = null;

  if (L.goal === 'property') {
    q('Which town or city?', 'Sample projects are held for some of these and not others. The tool says which, and never borrows a comparable from a different market.');
    const city = seg('city', SARAWAK_CITIES.map(c => [c.id, c.name]), 'kuching');
    q('Start from what?');
    const mode = seg('mode', [['own', 'My own figures'], ['example', 'A worked example']], 'example');
    open = () => {
      /* The reader's deal is kept aside, not replaced. This wrote the default
         deal over one the reader had entered — a price of 888,000 came back
         as 572,000 — with no question and nothing to restore it from. A deal
         of their own (dealIsTheReaders, the rule every page reads a deal by)
         goes where a shared link puts the deal it displaces, and the
         calculator's "Restore my previous deal" offers it back. */
      const had = State.deal;
      /* Through the property model's own rule (71-property-models.js): it keeps
         unsaved work and a sample with the reader's choices in it, and moves any
         older work already kept aside into My properties first — a plain write
         here replaced that older work, the only copy of it. */
      const kept = typeof propertySetAside === 'function' ? propertySetAside(had) : (dealIsTheReaders(had) && (store.write('dealBeforeLink', had), true));
      State.deal = { ...PROPERTY_DEFAULT_DEAL, city,
        district: (SARAWAK_CITIES.find(c => c.id === city)?.districts || [''])[0],
        projectId: (projectsForCity(city)[0] || {}).id || customProjectId(city),
        touched: {}, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence },
        checks: { ...PROPERTY_DEFAULT_DEAL.checks } };
      /* "My own figures" does not blank the model — it cannot, or nothing
         computes. It opens the review queue instead, which is the honest
         version of the same intention: here is every figure that is still
         ours, replace them. */
      saveDeal();
      navigate('/property/calculator');
      if (kept) toast('Your previous deal is kept — “Restore my previous deal” puts it back');
      if (mode === 'own') setTimeout(() => {
        const det = [...document.querySelectorAll('details')]
          .find(x => /Review \d+ sample input/.test(x.querySelector('summary')?.textContent || ''));
        if (det) { det.open = true; det.scrollIntoView({ block: 'center' }); }
      }, 400);
    };
  }

  if (L.goal === 'company') {
    q('Which company?', 'Only companies with audited statements filed with the SEC are listed here. Bursa figures in this build are illustrative and are not offered as a research destination.');
    const filed = (typeof U !== 'undefined' ? U : []).filter(r => r.c.real && r.c.mkt === 'US')
      .sort((x, y) => String(x.c.name).localeCompare(String(y.c.name)));
    if (!filed.length) {
      card.append(coverageCell('p', { class: 'body' }, `${COVERAGE_PENDING} — the audited set is still loading.`));
    } else {
      const cur = a.company || filed[0].c.id;
      const sel = el('select', { class: 'select', 'aria-label': 'Company',
        onchange: e => set('company', e.target.value) });
      filed.forEach(r => sel.append(el('option', { value: r.c.id, selected: r.c.id === cur ? '' : null },
        `${r.c.tk} — ${r.c.name}`)));
      card.append(sel);
      open = () => {
        const row = BY_ID.get(cur) || filed[0];
        navigate(companyPath(row.c));
      };
    }
  }

  if (L.goal === 'wheel') {
    q('Start from what?', 'This build carries no option-chain data, so a contract is entered by hand either way.');
    const mode = seg('mode', [['own', 'My own contract'], ['example', 'A worked contract']], 'example');
    open = () => {
      /* A contract the reader entered is theirs, as the worked-example
         loader already holds (93-worked-example.js): "My own contract" opens
         it as it is rather than blanking it, and the worked contract asks
         before it replaces it. Both replaced it without a word. */
      const own = num0(State.wheel?.putStrike) > 0 && !State.wheel?.isWorkedExample;
      if (own && mode === 'own') { navigate('/wheel'); toast('Your contract is open as you left it'); return; }
      if (own && !confirm('Replace the contract you entered with the worked contract? Yours is not kept.')) return;
      State.wheel = mode === 'example'
        ? { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true }
        : { ...State.wheel, ...WHEEL_BLANK_CONTRACT, isWorkedExample: false };
      saveWheel();
      navigate('/wheel');
    };
  }

  if (L.goal === 'trading') {
    q('Start from what?', 'Phase 1 reads nothing from your screenshot — every panel is transcribed by you.');
    const mode = seg('mode', [['own', 'My own chart evidence'], ['example', 'The §14 worked example']], 'example');
    open = () => {
      /* Chart evidence the reader transcribed — a symbol, or a panel marked
         present — is kept the same way as a contract. */
      const q = State.qtti;
      const own = !!q && JSON.stringify(q) !== JSON.stringify(qttiWorkedExample())
        && (String(q.symbol || '').trim() !== '' || ['daily', 'weekly', 'monthly'].some(t => q.timeframes?.[t]?.present));
      if (own && mode === 'own') { navigate('/trading-index'); toast('Your chart evidence is open as you left it'); return; }
      if (own && !confirm('Replace the chart evidence you entered with the §14 worked example? Yours is not kept.')) return;
      if (mode === 'example') State.qtti = qttiWorkedExample();
      else State.qtti = { ...State.qtti, symbol:'',
        timeframes:{ daily:qttiBlankPanel(), weekly:qttiBlankPanel(), monthly:qttiBlankPanel() },
        confidence:{ metadata:null, panels:null, indicators:null, legibility:null, recency:null },
        entryLocation:'unknown', identityConsistent:false, capturedAt:'', triggerComplete:false };
      saveQtti();
      navigate('/trading-index');
    };
  }

  if (L.goal === 'screen') {
    q('Which market?');
    const universe = seg('universe', [['all', 'All markets'], ['US', 'US listings'], ['MY', 'Bursa']], 'all');
    q('Which measures?', 'A preset chooses which columns are on screen. It does not filter, sort or rank anything.');
    const preset = seg('preset', COL_PRESETS.map(p => [p.id, p.label]), 'essentials');
    open = () => {
      const p = COL_PRESETS.find(x => x.id === preset) || COL_PRESETS[0];
      State.screen = screenFitClass({ ...blankScreen(), universe, cols: [...presetCols(p, universe === 'MY' ? 'illustrative' : 'filed')] });
      store.write('screen', State.screen);
      State.appliedTemplate = null;
      navigate('/discover/screener');
    };
  }

  if (open) {
    /* The button names the tool it opens, so the shell's gate draws it as
       text where that tool cannot be used here (gateToolLink, 35-ui.js):
       with the filings failed to load, "Open the stock screener" sent the
       reader to the Unavailable screener. */
    const opens = { property: '/property/calculator', wheel: '/us-options/wheel', trading: '/research/trading-index', screen: '/discover/screener' }[L.goal] || null;
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--xl)' }, [
      el('button', { class: 'btn btn-primary', 'data-tool-path': opens, onclick: open }, `Open the ${goal.tool.toLowerCase()}`),
    ]));
    card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The tool will say which of its figures are still samples and which are yours.'));
  }
  wrap.append(card);
  return wrap;
};

/* ==========================================================================
   WATCHLISTS — its own destination, not a panel on a dashboard.
   ========================================================================== */
/* WHAT OF "EVERYTHING YOU HAVE MADE" IS A SAMPLE. The first visit writes two
   portfolios, two cases, two watchlists and two price alerts, and the worked
   example writes comparables, area attributes, their register history and a
   Cash Wheel contract. The card counted all of them as the reader's work,
   with no sample label and no banner, while the six personal pages call the
   same records samples that are not the reader's. Each key says which of
   its records are samples by the rules those pages use: how many, for a
   list, or whether the one record is, for a single one. */
const HELD_SAMPLES = {
  portfolios: (v) => v.filter(p => SEEDED_PF_IDS.includes(p.id)).length,
  theses: (v) => v.filter(t => SEEDED_THESIS_IDS.includes(t.id)).length,
  watchlists: (v) => v.filter(isSeededWL).length,
  priceAlerts: (v) => v.filter(isSeededPA).length,
  observations: (v) => v.filter(o => o.sample).length,
  registerLog: (v) => v.filter(e => e.actor === SAMPLE_ACTOR).length,
};
const HELD_IS_SAMPLE = {
  areaProfiles: (v) => { const attrs = Object.values(v).flatMap(p => (isRecord(p) ? Object.values(p) : [])); return attrs.length > 0 && attrs.every(a => a?.sample); },
  wheelPlan: (v) => !!v.isWorkedExample,
  qttiPlan: (v) => JSON.stringify(v) === JSON.stringify(qttiWorkedExample()),
  /* A deal nobody has started (dealIsTheReaders, 15-derivation.js). */
  deal: (v) => !dealIsTheReaders(v),
};

VIEWS.userdata = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(pageHead({ title: 'Bring your own prices', lede: 'Your prices, your backups and your settings, kept in this browser.',
    note: 'This site ships no market prices, because none of the prices it could ship are licensed for it to redistribute. Yours are a different question.' }));
  appendSampleBanner(wrap);

  /* Why this exists, said once and without hedging. */
  const why = el('div', { class: 'card' });
  why.append(cardHead('What happens to what you paste',
    'It stays in this browser.'));
  why.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'Held in this browser’s local storage, on this device. It is not uploaded, not sent to a server, and not visible to anyone else — this build has no accounts and no backend to send it to.'),
    el('li', {}, 'Every figure derived from it is labelled as yours rather than treated as a source of record. A price you supplied and a licensed close are not the same evidence.'),
    el('li', {}, 'Clearing your browser data removes it. There is no copy anywhere else, so export it if it took work to assemble.'),
    el('li', {}, 'Whatever you paste remains under whatever terms you obtained it. This tool does not acquire it, republish it, or give you a right to share it — a broker export is still your broker’s data.'),
  ]));
  wrap.append(why);

  /* ---------- backup, restore and saved work ----------
     This page already explained that everything lives in this browser and dies
     with it, and then offered no way to act on that. A warning without a remedy
     is just an apology in advance. */
  const bk = el('div', { class: 'card' });
  bk.append(cardHead('Back up everything in this browser',
    'One file with every calculation, saved deal, watchlist, screen and correction case this browser holds. There is no server copy, so this file is the only copy.'));

  const bkRow = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
  bkRow.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    const payload = backupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob),
      download: `quantum-tradeworks-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    toast(`Downloaded ${payload.keys} stored item${payload.keys === 1 ? '' : 's'}`);
  } }, 'Download a backup'));

  /* A hidden input behind a button, because the native file control cannot be
     styled and reads as a browser artefact rather than part of the page. */
  const fileIn = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const res = restoreBackup(await file.text());
      e.target.value = '';
      if (!res.ok) { toast(res.error); return; }
      const left = res.refused || [];
      toast(`Restored ${res.restored} item${res.restored === 1 ? '' : 's'}${left.length ? ` — ${left.length} left as ${left.length === 1 ? 'it was' : 'they were'}, not in the shape this app writes: ${left.join(', ')}` : ''} — reloading`);
      /* A reload rather than a re-render: State was populated from storage at
         boot, and half the app would still be holding the pre-restore values. */
      setTimeout(() => location.reload(), 700);
    } });
  bkRow.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileIn.click() },
    'Restore from a backup'));
  bkRow.append(fileIn);
  bk.append(bkRow);
  bk.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Restoring overwrites what this browser currently holds for any key present in the file, then reloads. '
    + 'Nothing is merged, because a half-merged calculation is a figure nobody entered.'));
  wrap.append(bk);

  /* Saved records, listed once in a place that is about storage. */
  const recs = loadWork();
  const sw = el('div', { class: 'card' });
  /* None is said as none, not as a nought (D12's rule, on My Workspace's
     pages since they are served pre-rendered: the 9 Oct 2026 audit, #7). */
  sw.append(cardHead(recs.length ? `Saved work — ${recs.length}` : 'Saved work — none yet',
    recs.length ? 'Named snapshots you took inside the tools. Each carries the model version and data date it was taken against.'
                : 'Nothing saved yet. The Property, Cash Wheel and Trading Index tools each have a Save control.',
    /* The tools' snapshots are one kind of saved thing among five; the
       Workspace lists all of them, with whether each one's model or data has
       moved. */
    el('a', { class: 'btn btn-ghost btn-sm', href: href('/my/workspace'),
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/my/workspace'); } },
      'Everything saved, in the Workspace')));
  if (recs.length) {
    const tw2 = el('div', { class: 'tablewrap' });
    const t2 = el('table', { class: 'dt' });
    t2.append(el('thead', {}, el('tr', {}, ['Name', 'Kind', 'Saved', 'Model version', ''].map((h, i) =>
      el('th', { style: i ? null : 'text-align:left' }, h)))));
    const tb2 = el('tbody');
    recs.forEach(r => {
      tb2.append(el('tr', {}, [
        el('td', { style: 'text-align:left' }, r.name),
        el('td', {}, WORK_KINDS[r.kind]?.label || r.kind),
        /* The stamp is UTC (15-derivation.js), and printed bare it read eight
           hours early in Malaysia; fmtSaved names the zone, as the Workspace
           and the tools' Resume menu do. */
        el('td', {}, fmtSaved(r.savedAt)),
        el('td', { class: 'metaline' }, `${r.modelVersion} · data ${r.asOf} · ${r.editor}`),
        el('td', {}, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
          if (!confirm(`Delete "${r.name}"?`)) return;
          /* deleteWork returns the write's result; a refused one said
             "Deleted" over a record still listed after the render. */
          const gone = deleteWork(r.id); render(); toast(gone ? 'Deleted' : STORE_UNDELETED);
        } }, 'Delete')),
      ]));
    });
    t2.append(tb2);
    tw2.append(t2);
    sw.append(tw2);
  }
  wrap.append(sw);
  /* The one place a hidden Start here panel comes back from (Release B,
     B6; 36-layouts.js). */
  wrap.append(startHereSettings());

  /* ---------- what is loaded now ---------- */
  const have = userSeriesCount();
  const status = el('div', { class: 'card' });
  status.append(cardHead('Loaded now',
    have ? 'Every view that uses price history is reading these.' : 'Nothing yet.'));
  if (have) {
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Symbol', 'Company', 'Closes', 'From', 'To', ''].map((h, i) =>
      el('th', { style: i === 1 ? 'text-align:left' : null }, h)))));
    const tb = el('tbody');
    const reg = instruments?.instruments || [];
    Object.entries(userData.series).sort().forEach(([sym, series]) => {
      const dates = Object.keys(series).sort();
      const known = reg.find(x => x.symbol === sym);
      tb.append(el('tr', {}, [
        el('td', { class: 'ident' }, sym),
        el('td', { style: 'text-align:left;white-space:normal' },
          known ? known.name : el('span', { class: 'caption' }, 'not in the instrument registry')),
        el('td', { class: 'num' }, String(dates.length)),
        el('td', { class: 'num' }, dates[0] || '—'),
        el('td', { class: 'num' }, dates[dates.length - 1] || '—'),
        el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          if (!commitUserData(() => { delete userData.series[sym]; })) { toast(STORE_UNDELETED); return; }
          toast(`${sym} removed`); location.reload();
        } }, 'Remove')),
      ]));
    });
    t.append(tb); tw.append(t); status.append(tw);
    status.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
      `${userCloseCount().toLocaleString()} closes across ${have} instrument${have === 1 ? '' : 's'}. A trend indicator appears once its own minimum history is met — 20 closes for the 20-day average, 200 for the 200-day, 252 for the 52-week range — and says how many more it needs until then.`));
    const exp = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:10px' });
    exp.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'quantum-tradeworks-my-data.json' });
      document.body.append(a); a.click(); a.remove();
      /* Named for what it carries. It shared its label with the card below,
         which exports portfolios, cases and watchlists; a reader backing up
         from this one got pasted prices and nothing else. */
    } }, 'Export these prices'));
    exp.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      if (!confirm('Remove every price you have added? This cannot be undone and there is no copy on any server.')) return;
      if (!commitUserData(() => { userData.series = {}; })) { toast(STORE_UNDELETED); return; }
      location.reload();
    } }, 'Remove all'));
    status.append(exp);
  } else {
    status.append(el('p', { class: 'body', style: 'font-size:13px' },
      'Without prices, anything price-derived is shown as unavailable rather than estimated: market capitalisation, multiples, dividend yield, the difference to a model estimate, and every trend indicator. The statements, scorecards and risk flags all work without them.'));
  }
  wrap.append(status);

  /* ---------- everything, not only the prices ----------
     The export above covers pasted price series. Everything else a reader makes
     — portfolios, investment cases, watchlists, property comparables,
     correction cases, both workspaces — was unreachable, so the work that takes
     the longest was the work most easily lost. */
  const all = el('div', { class: 'card' });
  all.append(cardHead('Everything you have made',
    'All of it is held in this browser and nowhere else. This is the only copy that survives a cleared browser, a second machine, or private mode closing. Display preferences — theme, density, the companies in a comparison — are not in it; the backup above carries those too.'));

  const held = PORTABLE_KEYS.map(({ k, label }) => {
    const v = store.read(k, null);
    /* A setting stored as a bare value (the base currency) is held too. */
    const n = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? 1 : (v !== null && v !== undefined && v !== '' ? 1 : 0));
    const samples = Array.isArray(v) && HELD_SAMPLES[k] ? HELD_SAMPLES[k](v) : 0;
    const sampleOnly = isRecord(v) && HELD_IS_SAMPLE[k] ? HELD_IS_SAMPLE[k](v) : false;
    return { k, label, n, list: Array.isArray(v), samples, sampleOnly, has: v !== null && v !== undefined && n > 0 };
  });
  const kv = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  const records = (n) => `${n} record${n === 1 ? '' : 's'}`;
  held.filter(x => x.has).forEach(x => {
    const own = x.n - x.samples;
    kv.append(el('dt', {}, x.label));
    kv.append(el('dd', {}, !x.list ? (x.sampleOnly ? 'a sample — not yours' : 'saved')
      : x.samples ? `${own ? `${records(own)} · ` : ''}${x.samples} sample${x.samples === 1 ? '' : 's'} — not yours` : records(x.n)));
  });
  if (held.some(x => x.has)) all.append(kv);
  else all.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Nothing saved yet. Anything you build — a property model, an investment case, a comparable — appears here and can be carried to another browser.'));
  if (held.some(x => x.samples || x.sampleOnly)) all.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'A sample was written into this browser on a first visit, or by the worked example, so the pages have something to show. Samples are counted apart from your own work here; Export everything carries them too, with the marks that say they are samples.'));

  all.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
      const doc = exportEverything();
      if (!Object.keys(doc.data).length) { toast('Nothing saved yet'); return; }
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob),
        download: `quantum-tradeworks-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }, 'Export everything'),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openRestoreDrawer() }, 'Restore from a file'),
  ]));
  all.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'The file never leaves your machine unless you send it. It is plain JSON — you can read it, and so can anyone you give it to.'));
  wrap.append(all);

  /* ---------- paste ---------- */
  const add = el('div', { class: 'card' });
  add.append(cardHead('Paste closes',
    'One row per day. A column copied out of a spreadsheet or a broker export works as it is.'));

  const symField = el('div', { class: 'field', style: 'max-width:280px' });
  symField.append(el('label', { for: 'ud-sym' }, 'Symbol, if the rows do not carry one'));
  const symInput = el('input', { class: 'input', id: 'ud-sym', placeholder: '2852, 1155, AAPL…' });
  symField.append(symInput);
  add.append(symField);

  const ta = el('textarea', { class: 'input', rows: '9', style: 'margin-top:10px;width:100%;font-family:var(--mono, monospace);font-size:12px',
    'aria-label': 'Paste closes',
    placeholder: '2026-08-06,7.93\n2026-08-05,7.88\n2026-08-04,7.90\n\n…or with the symbol on each row:\n2852,2026-08-06,0.995' });
  add.append(ta);

  const report = el('div', { style: 'margin-top:10px' });
  add.append(report);

  const actions = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:10px' });
  actions.append(el('button', { class: 'btn btn-primary', onclick: () => {
    const res = parseCloses(ta.value, symInput.value.trim().toUpperCase());
    report.replaceChildren();
    if (!res.accepted && !res.rejected.length) { report.append(el('p', { class: 'metaline' }, 'Nothing to read.')); return; }

    const kept = !res.accepted || commitUserData(() => {
      for (const [sym, series] of Object.entries(res.series)) {
        userData.series[sym] = { ...(userData.series[sym] || {}), ...series };
      }
      userData.added = new Date().toISOString().slice(0, 10);
    });

    /* Both halves reported, always. A partial import that only announces its
       successes is how a reader ends up trusting a series with holes in it.
       And a read that the browser refused to keep says so, with no reload
       offered: the reload would have shown none of it. */
    const summary = el('p', { class: 'body', style: 'font-size:13px' },
      `${res.accepted} close${res.accepted === 1 ? '' : 's'} read across ${res.symbols.length} symbol${res.symbols.length === 1 ? '' : 's'}`
      + (res.rejected.length ? `, and ${res.rejected.length} row${res.rejected.length === 1 ? '' : 's'} could not be read.` : '.'));
    report.append(summary);
    if (!kept) report.append(el('p', { class: 'body', style: 'font-size:13px;color:var(--bronze)', role: 'alert' }, STORE_REFUSED));

    if (res.rejected.length) {
      const det = el('details', { style: 'margin-top:8px' });
      det.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
        `Show the ${res.rejected.length} row${res.rejected.length === 1 ? '' : 's'} that were not read`));
      const ul = el('ul', { class: 'ticklist', style: 'margin-top:6px' });
      res.rejected.slice(0, 40).forEach(r => ul.append(el('li', {},
        `Line ${r.line}: ${r.why} — ${r.text.slice(0, 80)}`)));
      if (res.rejected.length > 40) ul.append(el('li', { class: 'caption' },
        `…and ${res.rejected.length - 40} more.`));
      det.append(ul);
      report.append(det);
    }

    if (res.accepted && kept) {
      report.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:10px',
        onclick: () => location.reload() },
        'Reload to apply'));
      report.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        'Everything derived from a price is computed once when the page loads, so the new closes appear after a reload rather than part-way through a session where half the figures used them and half did not.'));
    }
  } }, 'Read what I pasted'));
  actions.append(el('button', { class: 'btn btn-ghost', onclick: () => { ta.value = ''; report.replaceChildren(); } }, 'Clear'));
  add.append(actions);

  add.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'Dates must be YYYY-MM-DD, or day-first where the day is unambiguous. 03/04/2026 is refused rather than guessed — reading it the wrong way round would move the whole series by months.'));
  wrap.append(add);

  /* Restore exported prices. Named for the one file it takes: as "Restore an
     export — a file previously exported from this page" it refused both the
     page's other exports, and "Export these prices" is offered only once
     prices have been pasted. The other two files are pointed to the control
     that takes them. */
  const restore = el('div', { class: 'card' });
  restore.append(cardHead('Restore exported prices', 'A file from “Export these prices” above — the price series you pasted. A backup and the Export everything file each have their own restore, further up this page.'));
  const file = el('input', { class: 'input', type: 'file', accept: '.json', 'aria-label': 'Restore exported prices' });
  file.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const sibling = siblingFileOf(j);
      if (sibling && sibling !== 'prices') { e.target.value = ''; toast(SIBLING_FILES[sibling]); return; }
      if (!j?.series || typeof j.series !== 'object') { toast('That file has no price series in it'); return; }
      let n = 0;
      const kept = commitUserData(() => {
        for (const [sym, series] of Object.entries(j.series)) {
          if (!series || typeof series !== 'object') continue;
          userData.series[sym] = { ...(userData.series[sym] || {}), ...series };
          n += Object.keys(series).length;
        }
      });
      if (!kept) { e.target.value = ''; toast(STORE_REFUSED); return; }
      toast(`${n} closes restored`);
      location.reload();
    } catch { toast('That file could not be read as JSON'); }
  });
  restore.append(file);
  wrap.append(restore);

  return wrap;
};

VIEWS.watchlists = () => {
  const wrap = el('div', { class: 'stack' });
  /* The personal pages' heading — eyebrow, 24px title, one-line lede — the
     one head every product and workspace page wears (pageHead,
     36-layouts.js). It was a 40px display heading with the sample banner
     above it, the one page of the four that looked like a different
     product. */
  wrap.append(pageHead({ title: 'Watchlists', lede: 'Companies you follow, in lists of your own.',
    note: 'Adding one here does not imply a view on it — it decides what the daily change feed covers, and a list can be handed to the scanner as its universe.' }));
  appendSampleBanner(wrap);
  const lists = Array.isArray(State.watchlists) ? State.watchlists : [];
  /* A control of the page drawn again, by its label — where focus goes when
     the one pressed is gone (focusAfterRedraw, 05-plans.js). */
  const labelled = (l) => () => [...document.querySelectorAll('#main button, #main input')].find(n => n.getAttribute('aria-label') === l);

  /* Create, export and import — the operations the brief names, on the page
     the brief names, rather than in a drawer behind another page's button.
     Every mutation goes through the service in 06-watchlists.js. */
  const ctl = el('div', { class: 'card' });
  /* A browser can hold more lists than its plan allows — the seed has two, the
     Free plan one. Those are kept; only creating another is refused, and the
     line says which of the two is the case rather than '2 of 1'. */
  /* Counted as wlCreate counts them: the reader's own lists, not the samples
     (06-watchlists.js). */
  const own = ownWatchlistCount(), samples = lists.length - own;
  const over = own > LIMITS.watchlists;
  /* None of the reader's own is said as none, not "0 of 1" (D12's rule, on
     My Workspace's pages since they are served pre-rendered: the 9 Oct 2026
     audit, #7). */
  ctl.append(cardHead('New watchlist', `${over ? `${own} lists of your own — this plan allows ${LIMITS.watchlists}, so the ones you have are kept and no more can be created` : own ? `${own} of ${LIMITS.watchlists} on this plan` : `None of your own yet — ${LIMITS.watchlists} on this plan`}${samples ? ` (the ${samples === 1 ? 'sample list does' : `${samples} sample lists do`} not count)` : ''}, each holding up to ${LIMITS.watchlistStocks} companies. Stored in this browser only — there are no accounts, so nothing here follows you to another device.`));
  const nameInp = el('input', { class: 'input', placeholder: 'Name', 'aria-label': 'New watchlist name', style: 'flex:1;min-width:160px' });
  const createBtn = el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    const r = wlCreate(nameInp.value); toast(r.ok ? `Created “${r.watchlist.name}”` : r.why); if (r.ok) render(); } }, 'Create');
  nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });
  const fileInp = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none', 'aria-label': 'Import a watchlists file' });
  fileInp.addEventListener('change', async () => {
    const file = fileInp.files?.[0]; if (!file) return;
    try {
      const rep = watchlistsImport(JSON.parse(await file.text()));
      /* The refusals too. A list refused for the plan's limit, and each
         company refused for a list's, are in rep.refused, which this never
         read: a Free-plan import of two lists, one of thirty, said "0 list(s)
         created, 25 added" and nothing of the second list or the five
         companies over the limit. Grouped by reason, so five refusals for one
         limit read as one line with their count. */
      const byWhy = new Map();
      (rep.refused || []).forEach(x => {
        const s = String(x), at = s.indexOf(': ');
        const why = at < 0 ? s : s.slice(at + 2);
        if (!byWhy.has(why)) byWhy.set(why, []);
        byWhy.get(why).push(at < 0 ? null : s.slice(0, at));
      });
      const refused = [...byWhy].map(([why, who]) => {
        const named = who.filter(Boolean);
        return `${who.length} refused — ${why}${named.length ? ` (${named.slice(0, 3).join(', ')}${named.length > 3 ? ` and ${named.length - 3} more` : ''})` : ''}`;
      }).join('; ');
      toast(rep.ok ? `Imported: ${rep.created} list(s) created, ${rep.added} added, ${rep.duplicate} already present${rep.unresolved.length ? `, ${rep.unresolved.length} not recognised: ${rep.unresolved.slice(0, 4).join(', ')}` : ''}${refused ? `; ${refused}` : ''}` : rep.why);
      render();
    } catch (e) { toast(`Could not read that file: ${e.message}`); }
  });
  ctl.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [nameInp, createBtn,
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      const blob = new Blob([JSON.stringify(watchlistsExport(), null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `quantum-tradeworks-watchlists-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    } }, 'Export JSON'),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileInp.click() }, 'Import JSON'), fileInp,
    /* The same export, named for the scanner's worker (round 3 contract
       C3): saved as data/watchlists.json, it is what a setup resolved
       "from your latest export" reads at each run. The scanner records when
       it was made, so its pages can say when a list has moved on since. */
    typeof scanExportWatchlists === 'function' ? el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': 'Export for the scanner (watchlists.json)', onclick: () => {
      scanExportWatchlists();
      toast('Exported watchlists.json — save it as data/watchlists.json on the machine the scanner’s worker runs on');
    } }, 'Export for the scanner') : null]));
  ctl.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'The export carries each member’s canonical instrument id and market — the shape a scanner takes as its universe — and says it belongs to this browser. “Export for the scanner” writes the same file as watchlists.json: the scanner’s worker cannot read this browser, so a setup resolved from your latest export sees the lists as they were when you last exported them.'));
  wrap.append(ctl);

  /* What to do next, with the one action the page has for it: Create, above.
     A second primary, "Find companies", sent the reader away from the page
     before a list existed to add them to. */
  if (!lists.length) {
    wrap.append(emptyStateCta('No watchlists yet', 'Name your first list above and press Create — then add companies to it by ticker, or from their company pages.'));
    return wrap;
  }

  lists.forEach(w => {
    const items = watchlistItems(w);
    const card = el('div', { class: 'card' });
    const head = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' });
    head.append(el('input', { class: 'input input-inline', value: w.name, 'aria-label': `Name of watchlist ${w.name}`, style: 'flex:1 1 180px;font-weight:600',
      onchange: e => { const r = wlRename(w.id, e.target.value); toast(r.ok ? 'Renamed' : r.why); render(); } }));
    head.append(el('span', { class: 'chip' }, `${items.length}/${LIMITS.watchlistStocks}`));
    head.append(el('span', { class: 'chip', title: w.createdAt ? null : (w.createdAtSource || null) }, w.createdAt ? `created ${localDayOf(w.createdAt)}` : 'created: date unknown'));
    if (w.updatedAt) head.append(el('span', { class: 'chip' }, `updated ${localDayOf(w.updatedAt)}`));
    head.append(el('span', { class: 'spacer' }));
    head.append(el('button', { class: 'btn btn-ghost btn-sm', title: 'Open the scanner builder with this list as the universe', onclick: () => {
      /* A draft with changes in it was replaced without a word — a name
         typed into the builder, then this button, and the name was gone —
         where the scanner's own "New setup on this list" and every other
         start the builder offers ask first. */
      if (typeof scanDraftUntouched === 'function' && scanDraft && !scanDraftUntouched()
        && !confirm('Replace the draft open in the builder with a new setup on this list? What is in the draft now is not kept.')) return;
      scanDraft = { ...scanBlankDraft(), universe: { kind: 'watchlist', watchlistId: w.id } };
      scanIdAuto = true;
      navigate('/app/scanner/setups/new');
    } }, 'Use as scanner universe'));
    if (lists.length > 1) head.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      if (!confirm(`Delete “${w.name}”?`)) return;
      const r = wlDelete(w.id); toast(r.ok ? 'Watchlist deleted' : r.why); render();
      /* The card goes, and its Delete with it; focus fell to the top of the
         page. It goes to the New watchlist field — not to the next card, whose
         own Delete is one Enter away. */
      if (r.ok) focusAfterRedraw(labelled('New watchlist name'));
    } }, 'Delete'));
    card.append(head);

    const addInp = el('input', { class: 'input', placeholder: 'Add by ticker, listing code, CIK or name…', 'aria-label': `Add a company to ${w.name}`, style: 'flex:1;min-width:200px' });
    const addBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      const term = addInp.value.trim(); if (!term) return;
      let r = wlAdd(w.id, term);
      /* A name rather than an identifier: the first search hit with a company page. */
      if (!r.ok && !r.duplicate && !r.id) { const hit = searchInstruments(term, {}, { limit: 5 }).hits.find(i => i.companyId); if (hit) r = wlAdd(w.id, hit.companyId); }
      toast(r.ok ? `Added ${BY_ID.get(r.id)?.c.tk || r.id}` : r.why);
      if (r.ok) render();
    } }, 'Add');
    addInp.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:10px' }, [addInp, addBtn]));

    /* An empty list says how it fills: the field above it, or a company
       page's own "Add to watchlist". */
    if (!items.length) card.append(el('p', { class: 'metaline', style: 'margin-top:8px', 'data-empty': '' },
      'Nothing in this list yet. Add a company by its ticker, listing code, CIK or name above — or with “Add to watchlist” on its company page.'));
    else {
      const t = el('table', { class: 'dt' });
      t.append(el('thead', {}, el('tr', {}, ['Symbol', 'Company', 'Coverage', 'Instrument id', 'Added', ''].map((h, i) => el('th', i === 1 ? { style: 'text-align:left' } : {}, h)))));
      t.append(el('tbody', {}, items.map((it, i) => {
        const row = BY_ID.get(it.companyId);
        return el('tr', {}, [
          el('td', { class: 'ident' }, row ? el('a', { href: href(companyPath(row.c)), onclick: (e) => { e.preventDefault(); openResearch(row.c.id); } }, row.c.tk) : it.companyId),
          el('td', { style: 'text-align:left;white-space:normal' }, row ? `${row.c.name}${illusText(row.c)}` : 'not in the universe'),
          el('td', {}, el('span', { class: it.coverage === 'filed' ? 'chip chip-ok' : 'chip chip-bronze' }, it.coverage)),
          el('td', { class: 'caption' }, it.instrumentId || '—'),
          /* A seeded list's own members carry no date: they are the samples. */
          el('td', { class: 'caption' }, it.addedAt ? localDayOf(it.addedAt) : SEEDED_WL_IDS.includes(w.id) ? 'sample' : 'unknown'),
          el('td', {}, el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Remove ${row ? row.c.tk : it.companyId} from ${w.name}`,
            onclick: () => {
              const r = wlRemove(w.id, it.companyId); toast(r.ok ? 'Removed' : r.why); render();
              /* The row goes, and its × with it, which dropped focus at the top
                 of the page: on to the next row's ×, or, from the last row,
                 to this list's "Add a company". */
              const next = items[i + 1];
              if (r.ok) focusAfterRedraw(labelled(next ? `Remove ${BY_ID.get(next.companyId)?.c.tk || next.companyId} from ${w.name}` : `Add a company to ${w.name}`));
            } }, '×')),
        ]);
      })));
      card.append(el('div', { class: 'tablewrap', style: 'margin-top:10px' }, t));
    }
    wrap.append(card);
  });
  return wrap;
};

/* The full trend picture for one instrument, including what is not yet
   computable and exactly how far away it is. */
function openTrendDrawer(row, t) {
  const body = el('div', { class: 'stack' });
  body.append(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
    el('span', { class: 'chip' }, row.sym),
    el('span', { class: t.points >= 252 ? 'chip chip-ok' : 'chip chip-bronze' },
      `${t.points} close${t.points === 1 ? '' : 's'}`),
    row.meta?.kind ? el('span', { class: 'chip' }, row.meta.kind) : null,
  ]));
  body.append(el('p', { class: 'metaline' },
    `${row.name}. Price evidence only — this instrument has no financial statements, so nothing here is a valuation and nothing here feeds a quality score.`));

  if (t.seams?.length) {
    const s0 = t.seams[0];
    body.append(el('div', { class: 'card', style: 'border-left:3px solid var(--warn)' }, [
      el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' },
        `${t.seams.length} discontinuit${t.seams.length === 1 ? 'y' : 'ies'} in the series`),
      el('p', { class: 'metaline' },
        `${withSign(s0.movePct, 1)} between ${s0.from} and ${s0.to}${s0.gapDays > 1 ? ` across a ${s0.gapDays}-day gap` : ''}. ` +
        'A step like this is usually where an imported history was joined to daily readings, not a move in the market. ' +
        'Volatility, returns and drawdown are all distorted by it — reimport a continuous series before relying on them.'),
    ]));
  }

  /* Relative strength, computed against the benchmark for this instrument. */
  /* The row's own series is the merged one the Tracked row drew (every alias
     key it is filed under), so the relative strength reads the same history
     as the trend context above. */
  const series = row.hist ? { ...(trackedHistory?.series || {}), [row.sym]: row.hist } : (trackedHistory?.series || {});
  const reg = instruments?.instruments || [];
  const rs = relativeStrength(row.sym, row.meta, series);
  const rsCard = el('div', { class: 'panel' });
  const rsDef = TREND_STRATEGIES.find(s => s.id === 'qt_relative_strength_v1');
  rsCard.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('span', { style: 'font-weight:600;font-size:13px' }, rsDef.name),
    el('span', { class: 'metaline', style: 'margin-left:auto' }, `v${rsDef.version}`),
  ]));
  if (!rs.benchmark) {
    rsCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, rs.reason));
  } else if (rs.isBenchmark) {
    rsCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `${row.sym} is the benchmark other ${row.meta?.market === 'MY' ? 'Malaysian' : ''} instruments are measured against, so it has no relative strength of its own.`));
  } else if (rs.reason) {
    rsCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, rs.reason));
  } else {
    rsCard.append(el('p', { class: 'metaline', style: 'margin:6px 0 8px' },
      `Against ${rs.benchmark.label}. ${rs.benchmark.why}`));
    if (rs.benchmark.weak) rsCard.append(el('p', { class: 'metaline', style: 'color:var(--bronze)' },
      'Not a like-for-like benchmark — read it as global context.'));
    const rt = el('table', { class: 'dt' });
    rt.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Window'), el('th', { class: 'num' }, row.sym),
      el('th', { class: 'num' }, rs.benchmark.symbol), el('th', { class: 'num' }, 'Difference'), el('th', {}, 'Percentile')])));
    const rb = el('tbody');
    rs.horizons.forEach(h => {
      if (h.insufficient) {
        rb.append(el('tr', {}, [el('td', {}, h.label),
          el('td', { class: 'metaline', colspan: 4 },
            `needs ${h.needs} shared closes, has ${h.have}`)]));
        return;
      }
      const pc = rsPercentile(row.sym, row.meta, series, reg, h.days);
      rb.append(el('tr', {}, [
        el('td', {}, h.label),
        el('td', { class: 'num' }, withSign(h.instrument, 1)),
        el('td', { class: 'num' }, withSign(h.benchmark, 1)),
        el('td', { class: 'num ' + diffClass(h.excess) }, withSign(h.excess, 1)),
        el('td', { class: 'metaline' }, !pc ? '—'
          /* A percentile, not a rank: "60th of 43" read as a place out of 43. */
          : pc.insufficient ? `${pc.have} of ${pc.needs} peers` : `${ord(pc.pct)} percentile · ${pc.peers} peers`),
      ]));
    });
    rt.append(rb);
    rsCard.append(el('div', { style: 'overflow-x:auto' }, rt));
    const done = rs.horizons.filter(h => !h.insufficient);
    if (done.length) rsCard.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `Windows are measured on dates both series share, not on row counts — ${done[0].from} to ${done[0].to} for the shortest window shown. Price return only; dividends are not included.`));
  }
  rsCard.append(el('details', { style: 'margin-top:8px' }, [
    el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'What this does and does not tell you'),
    el('ul', { class: 'ticklist', style: 'margin-top:6px' }, rsDef.limitations.map(l => el('li', {}, l))),
  ]));
  body.append(rsCard);

  TREND_STRATEGIES.filter(s => s.evaluate && !s.external).forEach(s => {
    const res = s.evaluate(t);
    const card = el('div', { class: 'panel' });
    card.append(el('div', { class: 'row', style: 'gap:8px' }, [
      el('span', { style: 'font-weight:600;font-size:13px' }, s.name),
      el('span', { class: 'metaline', style: 'margin-left:auto' }, `v${s.version}`),
    ]));
    if (res) {
      card.append(el('p', { style: 'margin:6px 0 2px;font-weight:600' }, res.state));
      card.append(el('p', { class: 'metaline' }, res.detail));
    } else {
      const missing = s.requires.map(id => t.pending.find(x => x.id === id)).filter(Boolean);
      const worst = missing.sort((a, b) => b.more - a.more)[0];
      card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        worst
          ? `Not computed. Needs ${worst.needs} closes and has ${worst.have} — ${worst.more} more trading days, or one import.`
          : 'Not computed for this instrument.'));
    }
    card.append(el('details', { style: 'margin-top:8px' }, [
      el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'What this does and does not tell you'),
      el('ul', { class: 'ticklist', style: 'margin-top:6px' }, s.limitations.map(l => el('li', {}, l))),
    ]));
    body.append(card);
  });

  /* Volume, where the imported file carried it. */
  const vol = volumeContext(trackedHistory?.volume?.[row.sym] || {}, series[row.sym] || {});
  const vCard = el('div', { class: 'panel' });
  vCard.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('span', { style: 'font-weight:600;font-size:13px' }, 'Volume context'),
    el('span', { class: 'metaline', style: 'margin-left:auto' }, 'section 13.3'),
  ]));
  if (vol.pending || !vol.points) {
    vCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      vol.points
        ? `Needs 20 days of volume and has ${vol.points}.`
        : 'No volume for this instrument. A watchlist screenshot shows a price, not a day’s turnover — import an export that carries a volume column.'));
  } else {
    const vt = el('table', { class: 'dt' });
    vt.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', { class: 'num' }, 'Value')])));
    vt.append(el('tbody', {}, [
      ['Latest volume', fmtNum(vol.latest, 0)],
      ['20-day average', isNum(vol.avg20) ? fmtNum(vol.avg20, 0) : '—'],
      ['50-day average', isNum(vol.avg50) ? fmtNum(vol.avg50, 0) : '—'],
      ['Latest vs 20-day', isNum(vol.ratio20) ? `${fmtNum(vol.ratio20, 2)}×` : '—'],
      ['Latest vs 50-day', isNum(vol.ratio50) ? `${fmtNum(vol.ratio50, 2)}×` : '—'],
      ['Average on up days', isNum(vol.upAvg) ? `${fmtNum(vol.upAvg, 0)} (${vol.upDays} days)` : '—'],
      ['Average on down days', isNum(vol.downAvg) ? `${fmtNum(vol.downAvg, 0)} (${vol.downDays} days)` : '—'],
      ['Up/down turnover', isNum(vol.upDownRatio) ? `${fmtNum(vol.upDownRatio, 2)}×` : '—'],
    ].map(([k, v]) => el('tr', {}, [el('td', {}, k), el('td', { class: 'num' }, v)]))));
    vCard.append(el('div', { style: 'overflow-x:auto;margin-top:6px' }, vt));
    vCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'Heavier turnover on up days than down days is a description of the tape, not evidence about the business. Breakout volume is not shown: the specification defines it against a resistance level you set, and this build has no place to set one.'));
  }
  body.append(vCard);

  /* Every indicator, computed or pending, so the gap is legible. */
  const tbl = el('table', { class: 'dt' });
  tbl.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Indicator'), el('th', { class: 'num' }, 'Value'), el('th', {}, 'Status')])));
  const tb2 = el('tbody');
  TREND_INDICATORS.forEach(ind => {
    const v = t.values[ind.id];
    const pend = t.pending.find(x => x.id === ind.id);
    let shown = '—';
    if (ind.id === 'cross') shown = v ? `${v.dir === 'up' ? 'upward' : 'downward'} on ${v.date}` : (pend ? '—' : 'none in the window');
    else if (isNum(v)) shown = ind.kind === 'pct' ? withSign(v, 2) : fmtNum(v, 2);
    tb2.append(el('tr', {}, [
      el('td', {}, t.labels?.[ind.id] || ind.label),
      el('td', { class: 'num' }, shown),
      el('td', { class: 'metaline' }, pend ? `needs ${pend.more} more close${pend.more === 1 ? '' : 's'}` : 'computed'),
    ]));
  });
  tbl.append(tb2);
  body.append(el('div', { style: 'overflow-x:auto' }, tbl));
  body.append(el('p', { class: 'metaline' },
    [`Series runs ${t.first || '—'} to ${t.lastDate || '—'}. Extend it by pasting closes under `,
      el('a', { href: href('/my/data'), 'data-path': '/my/data' }, 'Your data & settings'), '.']));

  openDrawer(`${row.sym} — trend context`, body);
}

/* THE PERSONAL PAGES WEAR THE WORKSPACE HEADER (Release B, B5). This drew a
   row of its own inside six of the eight pages — no name, labels that were
   not the sidebar's ("Alerts" under My Alerts, "Workspace" under Saved
   Models), and none on the dashboard or on two of the pages it listed. The
   shell draws My workspace's header above every one of them now, its tabs
   the workspace's tools from the registry (renderProductTabs, 35-ui.js). The
   pages still call this, and it adds nothing, so no second row repeats it. */
function mySubnav() {
  return document.createDocumentFragment();
}

/* A consistent empty state: says what the surface is for and offers the one
   action that fills it, rather than rendering a blank container. Marked, so
   a check can find every one (data-empty). */
function emptyStateCta(title, body, ctaLabel, ctaPath) {
  const card = el('div', { class: 'card', style: 'text-align:center;padding:var(--xxl) var(--lg)', 'data-empty': '' });
  card.append(el('h2', { class: 'h-card' }, title));
  card.append(el('p', { class: 'metaline', style: 'margin:8px auto 14px;max-width:52ch' }, body));
  if (ctaLabel) card.append(el('a', { class: 'btn btn-primary', href: href(ctaPath),
    onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(ctaPath); } }, ctaLabel));
  return card;
}

/* ==========================================================================
   TRUST PAGES

   These state what is known and mark what is not. An About page carrying an
   invented registration number would be worse than one that says the entity
   is not yet registered — a reader can act on the second and is misled by the
   first.
   ========================================================================== */

/* THE DETAILS NOBODY HAS SUPPLIED YET, IN ONE TABLE (launch audit, 29 Sep
   2026). Terms, Privacy and its PDPA notice need the operating entity's
   name, its registered address, a contact email and the domain the site
   launches on — and none exists: no entity is registered, and the contact
   address is LAUNCH.contactEmail (15-derivation.js), which is empty. Typed
   into four pages as prose, a placeholder reads as a fact and a real detail
   has to be found four times. So every page reads them from here: an empty
   value draws a "To be supplied" marker, styled as a gap rather than as body
   text, and a value the owner supplies replaces the marker on every page at
   once. The Bahasa Malaysia version of the PDPA notice is marked the same
   way. wording-check.mjs holds the table empty until a detail arrives from
   the owner, and fails on an email, a company name or a registration number
   written into these pages instead. */
const OPERATOR = {
  entity:  { label: 'operating entity name', value: '' },
  address: { label: 'registered address', value: '' },
  email:   { label: 'contact email', value: () => LAUNCH.contactEmail },
  domain:  { label: 'domain', value: '' },
  bm:      { label: 'Bahasa Malaysia translation', value: '' },
};
/* The detail, or its marker. The marker's words are real text — "To be
   supplied: contact email" — so a screen reader hears the gap as a sighted
   reader sees it. */
function supplied(k) {
  const d = OPERATOR[k];
  const v = typeof d.value === 'function' ? d.value() : d.value;
  if (v) return k === 'email' ? el('a', { href: `mailto:${v}` }, v) : v;
  return el('span', { class: 'tbs', 'data-tbs': k }, [el('span', { class: 'tbs-k' }, 'To be supplied:'), ` ${d.label}`]);
}
/* A paragraph of words and nodes (a marker, a link), and a list. */
const tp = (...parts) => el('p', {}, parts);
const tlist = (items) => el('ul', { class: 'trust-list' }, items.map(i => el('li', {}, i)));
const tlink = (text, path) => el('a', { href: href(path), 'data-path': path }, text);

/* READ FROM THE PAGE, AS THE WAITLIST SENTENCE IS READ FROM LAUNCH. The
   analytics tag lives in the HTML shell (src/index.template.html), which the
   launch audit takes it out of until analytics returns with a consent
   notice. A sentence typed here would be true of one shell and false of the
   other: the privacy page said "This deployment includes the Vercel Web
   Analytics script" whatever the page carried. */
const analyticsTagged = () => !!document.querySelector('script[src*="/_vercel/insights/"]');

/* Headed as every page but the two marketing ones is: an eyebrow naming the
   menu it is reached from, a 24px title, a standfirst. As 40px display
   headings these four were a fifth heading size on the public chrome, beside
   /pricing and /learn at 24px under the same header.
   `draft` puts the draft line first under the heading, before anything a
   reader could take as settled. A block that is an object, { section, lede },
   opens a section of its own: its title is the h2 and the cards after it
   take h3, so the outline steps down rather than flattening a notice into
   the cards around it. */
function trustPage(title, lede, blocks, { draft } = {}) {
  const wrap = el('div', { class: 'stack trust-page' });
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Resources'),
    el('h1', {}, title),
    el('p', { class: 'body-lg', style: 'margin-top:8px' }, lede),
  ])));
  if (draft) wrap.append(el('div', { class: 'card trust-draft' },
    el('p', { class: 'body' }, [el('strong', {}, 'Draft — not yet reviewed by a lawyer.'), ` ${draft}`])));
  let level = 'h2';
  blocks.forEach(b => {
    if (!Array.isArray(b)) {
      wrap.append(el('div', { class: 'trust-section' }, [
        el('h2', { class: 'h-section' }, b.section),
        b.lede ? el('p', { class: 'body', style: 'margin-top:6px' }, b.lede) : null,
      ]));
      level = 'h3';
      return;
    }
    const [heading, body, pending] = b;
    const card = el('div', { class: 'card trust-card' });
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
      el(level, { class: 'h-card' }, heading),
      pending ? el('span', { class: 'chip chip-bronze' }, 'not yet established') : null,
    ]));
    /* A paragraph may be a [text, path] pair, which renders as a real link.
       "See the contact page." was a bare <p> whose closest('a') was null, so the
       one sentence on the About page that points somewhere pointed nowhere.
       A node (tp, tlist) is placed as it is. */
    (Array.isArray(body) ? body : [body]).forEach(p => {
      if (p?.nodeType) card.append(p);
      else if (Array.isArray(p)) card.append(el('p', {}, tlink(p[0], p[1])));
      else card.append(el('p', { class: pending ? 'metaline' : '' }, p));
    });
    wrap.append(card);
  });
  return wrap;
}

VIEWS.about = () => trustPage('About',
  'Who is responsible for this product, and what it is and is not.',
  [
    ['What Quantum Tradeworks is',
      ['A research tool. It shows the figures a company reported, derives measures from them, and models a range of values under assumptions you can see and change.',
       'It is also a property calculator: you enter a purchase and it returns the monthly cash flow, the break-even rent and the cash required.']],
    ['What it is not',
      /* "Asks nothing about your circumstances" was unqualified, beside a
         property calculator whose loan-readiness check asks for income,
         debts and a credit record. */
      ['Not advice. It does not tell you what to buy, hold or sell, produces no ratings or target prices, and executes nothing. The equity research asks nothing about your circumstances; the one place that takes figures about you is the property calculator’s optional loan-readiness check, where the income, debts and credit record you choose to enter stay in this browser and are used only to judge whether a loan is within reach — a diagnostic, not a suitability assessment.',
       'Not a data vendor. It does not redistribute market data, and where a price is shown its source and licence are stated on the page.']],
    ['Legal entity and registration',
      ['No operating company has been registered for this product yet, so there is no company number, no registered address and no regulated status to state. This page will carry them once there are.',
       tp('Operating entity: ', supplied('entity'), ' · Registered address: ', supplied('address'))], true],
    ['The people responsible',
      'Not published. Naming a team before there is a registered entity behind it would be a claim without anything standing behind it.', true],
    /* It said the product "does not carry on any regulated activity". That
       is the conclusion a Malaysian securities-law opinion would give, and
       the launch audit's first blocker is that no such opinion exists yet —
       the page asserted the answer to the question still open. What is true
       is what the product is built to do and that the opinion is pending. */
    ['Regulatory position',
      'This product is not licensed by the Securities Commission Malaysia. It is built to publish research and calculators and to give no personal recommendation. Whether that keeps it outside the activities the Capital Markets and Services Act 2007 regulates has not yet been confirmed by a legal opinion, and one is required before a public launch.'],
    ['Conflicts of interest',
      ['Nothing on this site is paid for. There are no broker commissions, no mortgage introductions, no developer fees, no advertising, no issuer payments and no sponsored content.',
       'If any of that changes it will be declared here before it takes effect. A score or a valuation must never move because of who paid — that is the one commitment this product cannot trade away.']],
    ['Contact', [['See the contact page.', '/contact']]],
  ]);

/* WHAT WORKS TODAY, SAID FIRST. The page opened "If a number here is
   wrong, that is the most useful thing you can tell us" on a site with no
   address to tell anyone at, and said every correction is published in the
   log — a reader's case is not; nobody receives it. The one route that
   works is the report form, which records a case in this browser and sends
   nothing; the page now says exactly that, and opens it. The address comes
   from OPERATOR, so when LAUNCH.contactEmail is set the marker becomes the
   address — the page did not read it at all, although LAUNCH's own note
   says /contact does. */
VIEWS.contact = () => trustPage('Contact',
  'What works today to reach whoever is responsible for a page, a figure or a correction — and what does not exist yet.',
  [
    ['What works today',
      [(() => {
        const v = OPERATOR.email.value();
        return v
          ? tp('Write to ', supplied('email'), '. Nothing on this site sends a message by itself: the address opens your own email program.')
          : tp('There is no contact address yet — no email, no form and no telephone number — so nothing you write on this site reaches anyone.');
      })(),
       tp('One route does work. ', el('strong', {}, 'Report a data error'), ', here and in the footer of every page, records a wrong figure as a case in this browser, with an identifier, the page you were on, the model version and the data date. It does not send the case: the last step hands it to you as text to copy, and every case you record is listed under ', tlink('Corrections', '/corrections'), ', ready to send once there is somewhere to send it.'),
       el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
         el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-action': 'report-error' }, 'Report a data error'),
       ])]],
    ['Contact address',
      [tp('Email: ', supplied('email'), ' · Post: ', supplied('address'), ', for ', supplied('entity'), '.'),
       'A contact route will be listed here alongside the registered entity rather than before it.'], true],
    ['What to include',
      'The company or property, the figure, what you believe it should be, and where that comes from. A source makes a correction verifiable rather than a disagreement.'],
    ['The corrections log',
      [tp('The ', tlink('corrections log', '/corrections'), ' records corrections made to this build — what was wrong and what changed, dated by the change. A case you record is not added to it, because nobody has received it.')]],
  ]);

VIEWS.privacy = () => {
  const tagged = analyticsTagged();
  const nos = ['no accounts', 'no cookies', tagged ? null : 'no analytics', waitlistReady() ? null : 'no form that sends anything'].filter(Boolean);
  /* "In short" is built from the same flags as the sentences below it, so
     the summary cannot say more than the page does. The one thing that does
     travel — a page's own address, which the property calculator fills with
     the deal's figures — is named here too, not only further down. */
  return trustPage('Privacy',
    'What this build stores, where it stores it and what leaves your device — then the notice the Personal Data Protection Act 2010 asks for.',
    [
    ['In short',
      [`The site sends nothing you enter to anyone${waitlistReady() ? ', except an email address you choose to give the waitlist' : ''}: there ${nos.length === 1 ? 'is' : 'are'} ${nos.slice(0, -1).join(', ')}${nos.length > 1 ? ' and ' : ''}${nos[nos.length - 1]}. Your browser asks this site for its own files and nothing else, and what you save stays in this browser, on your device. The one thing that travels is a page’s own address when the page is loaded — the property calculator keeps the deal’s figures in it — as set out below.`]],
    ['What is stored',
      /* The full list, because a privacy page that names some of what it
         stores is worse than one that names none: it invites the reader to
         assume the rest is not there. The borrower profile in particular —
         income, commitments, credit conduct — is the most personal thing this
         product holds and was not on this page.
         Named after an audit compared this list with every key the code
         writes; the launch audit did so again and found four more — the
         area screen's locality profiles and demand records (both in the
         export, PORTABLE_KEYS), which watchlist is active, and when the
         dashboard was last opened. equity-test now compares the page with
         the code's keys, so a new key is named or the check fails. Grouped
         by what the reader made, so the list can be read. */
      [tp('Everything this product remembers is held in this browser’s local storage, under this site’s address, and none of it is sent anywhere. Unlike a cookie, local storage is not sent with any request: it stays on this device until you clear it. It holds:'),
       tlist([
         [el('strong', {}, 'Your research: '), 'your watchlists and which watchlist is active; saved screens and the screener’s current filters; investment cases and the reviews you write of them; saved valuation runs, the valuation assumptions you edit, the required discount you set and the inputs you chose for the valuation sensitivity grid; saved comparisons and the companies you put in a comparison; portfolio holdings and the dividends you record against them; price alerts, and which alert types the feed shows; the companies you recently viewed, and which company reports you opened this month (counted against the plan’s monthly allowance); any prices or statement lines you paste in; the Cash Wheel plan and its legs; withholding-tax settings; and your trading-index observations.'],
         [el('strong', {}, 'Your property work: '), 'property inputs and the evidence and register records behind them, with the name or initials you give the register log; the property deal you had before opening a shared link; the prices and rents you record in the comparables register; the locality profiles and demand records you keep on the area screen; the borrower profile you enter for the loan-readiness check (income, commitments and credit conduct); your details for proposals — the name, agency, contact and logo a client proposal prints as yours (a client’s name is never kept); saved property candidates; Sarawak exposure records; the property reports you unlocked in the preview, and the included property reports you used this month.'],
         [el('strong', {}, 'The scanner: '), 'your scanner setups with every version of each, which scanner alerts you have read or archived, and your scanner notification and display preferences.'],
         [el('strong', {}, 'Recent: '), 'the pages, tools and saved work you recently opened, and when you opened them and each company you viewed — at most twenty, which the search lists when nothing is typed in it; its “Clear recent” forgets them.'],
         [el('strong', {}, 'Records and settings: '), 'the data-error cases you record; saved-work snapshots; your answers to the launcher and onboarding questions, and whether you dismissed the introduction; which products’ Start here panels you have hidden; the plan you are previewing; when you last opened your dashboard, so it can count what is new since; a digest of what the pages read of all this — a short fingerprint of each item, never the item itself — so that a page this site sends already drawn is kept out of sight until your own is drawn, where yours differs; and display preferences — your theme and base currency, dashboard layout, table density, how much explanation to show, the language of the property pages, the currency the Compare and screener pages total in, the units for property rates, and whether filed SEC data is switched on.'],
       ]),
       'There are no accounts in this build, so there is nothing to sign in to and no server-side record of you.']],
    ['What leaves your device',
      [
        tp('Only requests for this site’s own files: the page itself and the data files it reads — the SEC filings, the instrument list, the Sarawak map and, when you open a locality on the area screen, NAPIC’s published figures for the division it lies in. Those are one file a division, so the address requested names the division. The security policy this site is served with tells your browser to refuse any request the page itself makes to another address, so this is enforced by your browser, not only promised here.'),
        tp('Each request reaches the company that hosts this site, Vercel, carrying what every web request carries: your IP address, your browser’s name and version, and the address requested. This build does not read or keep those requests; what the host records about them, and for how long, is governed by the host’s own terms.'),
        tp('Some pages keep what is on screen in their address, so that a copied link reproduces it. The property calculator writes the deal’s figures there — the price, the rent and the other inputs you changed, never the borrower profile. An address reaches the host only when a page is loaded with it: a reload, or a link someone opens.'),
        tagged
          ? tp('This deployment includes the Vercel Web Analytics script. Where the operator has switched analytics on, page views are counted: the path you visited, the site that referred you, your country, and whether you are on a phone or a desktop. It sets no cookies, stores no identifier, and cannot follow you to another site. Where it is not switched on, the request for the script is refused and nothing is counted.')
          : tp('No analytics. This build loads no analytics, advertising or tracking script and counts no page views. If analytics is switched on later, it will come with a consent notice, and this page will say what it records before it records anything.'),
        /* Written from the same flag the waitlist renders from. If that form is
           ever switched on, this sentence appears with it — a privacy page that
           has to be remembered separately is one that will be wrong. */
        waitlistReady()
          ? tp('If you enter an email address in the waitlist, that address is sent to the form service configured for this deployment and used for one message about launch. Nothing else on this page is sent with it.')
          : tp('There is no form on this site that sends anything anywhere. No email address is requested and none can be submitted.'),
        tp(el('strong', {}, 'Report a data error'), ' records the case in this browser and sends nothing — there is no contact address yet. Its last step hands you the case as text to copy; copying uses your clipboard only when you press the button.'),
        tp('Exporting your data is the only other way anything leaves, and it goes to a file on your own machine when you ask for it.'),
        tp('Links to outside sources — SEC EDGAR, NAPIC, Bursa Malaysia and others — take you to those sites only when you follow one. That visit is between you and that site; the policy this site is served with lets your browser tell it at most this site’s name, never the page you were on.'),
      ]],
    ['Cookies',
      'This build sets no cookies, and no response it is served with sets one. Your theme, the plan you are previewing and everything else it remembers are kept in local storage instead, which never travels with a request.'],
    ['What is never collected',
      'No brokerage credentials, no account numbers, no identity documents. The portfolio feature records what you type and nothing else.'],
    ['Clearing your data',
      [tp('Clearing this site’s storage in your browser removes everything the product holds about you, immediately and irreversibly. Export first if you want to keep it — ', tlink('Your data', '/my/data'), ' lists what is saved and writes it to a file. There is no copy on any server to fall back on.')]],
    { section: 'Personal Data Protection Act 2010 — notice',
      lede: 'The notice a data user gives under the Personal Data Protection Act 2010 (Malaysia): what personal data is processed and why, where it comes from, who it goes to, and how to ask for access or a correction. It is written for this build, which collects nothing on a server, and for what a launch would add — each addition listed here before it is collected.' },
    ['Who the data user is',
      [tp(supplied('entity'), ', ', supplied('address'), ', operating this site at ', supplied('domain'), '.'),
       'No operating entity has been registered yet. The data user named here will be responsible for any personal data a launch collects; this build collects none on a server.']],
    ['What personal data is processed, and where it comes from',
      ['Today this build collects none. What you type — including the income, debts and credit record you may enter for the property calculator’s loan-readiness check — comes from you and stays in your browser, where no one else can read it. The only personal data that reaches anyone is what every web request carries to the host — your IP address and your browser’s name and version — as set out above.',
       'A launch would add only what a feature needs, collected from you directly and listed here before it is collected: your email address and message if you write to the contact address; your email address if a waitlist opens; and, if accounts or paid plans are offered, the details they need, with payment handled by a provider named here first.']],
    ['Purposes',
      'Today there are none, because nothing is collected. At launch, personal data would be used only to answer a message or a correction you send, to send a launch message you asked for, to provide an account or a plan you chose, and to meet a legal obligation. It would not be sold, used for advertising, or used to send you marketing you have not agreed to.'],
    ['Who it is disclosed to',
      'Today, no one: this build holds nothing to disclose. At launch, only the service providers that run the site for the data user — the host, and an email or payment provider, each named here before it is used — and an authority where the law requires it. The host’s servers may be outside Malaysia; if a launch transfers personal data out of Malaysia, this notice will say where.'],
    ['Whether you must provide it',
      'Nothing is obligatory. Every page works without you giving any personal data. At launch, if you choose not to give an email address, the only consequence is that no reply or message can reach you.'],
    ['Access and correction',
      ['The Act gives you the right to ask a data user for a copy of the personal data it holds about you, to ask for it to be corrected, to withdraw your consent to its processing, and to require that it is not used for direct marketing.',
       tp('Today this build holds nothing about you on a server, so there is nothing to request. What it stores is on your device and is yours to see, correct, export and delete — ', tlink('Your data', '/my/data'), ' lists it. At launch, send requests to ', supplied('email'), '.')]],
    ['Your choices',
      'You can use everything here without giving anything, and export or clear what this browser stores at any time. At launch you would be able to decline any message you did not ask for, and withdraw from one you did.'],
    ['Security and retention',
      'On your device, anyone who can use this browser profile can read what it stores — clear it on a shared computer. The site’s security policy stops the page itself connecting to any other address. At launch, personal data would be kept only as long as its purpose needs, and the period would be stated here.'],
    ['Requests and complaints',
      [tp('Write to ', supplied('email'), ' or to ', supplied('address'), '. Until these are supplied there is no one to send a request to — and nothing held to request.'),
       'If a request is not resolved, you may complain to the Personal Data Protection Commissioner.']],
    ['Bahasa Malaysia',
      [tp('The Act requires this notice in the national language as well as in English. The Bahasa Malaysia version is ', supplied('bm'), ': it will be translated for legal use, not by machine, and until it is, this English draft is the only version.')]],
  ], { draft: 'It describes what this build does, read from its code, but it is not a settled policy: no operating entity has been registered to give it, and every detail shown as “To be supplied” is a gap, not a fact.' });
};

VIEWS.terms = () => trustPage('Terms',
  'The terms this build is offered under: a research tool, not advice, with nothing for sale.',
  [
    ['Who offers this site',
      [tp(supplied('entity'), ', ', supplied('address'), ', at ', supplied('domain'), '.'),
       'No operating entity has been registered yet. Until one is, these terms are published so you can see what this build is and is not, and on what footing it is offered.']],
    ['What the service is',
      'A research tool and a property calculator, in beta. It shows the figures companies reported, derives measures from them and models a range of values under assumptions you can see and change; the calculator models a property purchase from figures you enter. It is free to use, needs no account, and is offered as it stands.'],
    ['Research, not advice',
      'Everything here is general information. It does not take account of your objectives, financial situation or needs, and nothing on this site is a recommendation to deal in any security or property. It is not licensed by the Securities Commission Malaysia and gives no personal recommendation; before acting, consider advice from someone licensed to give it.'],
    ['Illustrative data',
      'The Malaysian companies carry synthetic financials that exist to demonstrate the interface, as does any US listing marked illustrative; the rest of the US set carries audited statements from SEC filings. Each company is labelled with which it is, wherever it appears. No market-data licence is in place for either exchange. Do not use a sample figure for a decision.'],
    ['No warranty',
      [tp('The site and everything on it are provided as they are, without any promise that they are accurate, complete, current or fit for a purpose, to the extent the law allows. Figures are drawn from filings and from files you supply; errors are possible, are corrected when found, and are logged in the ', tlink('corrections log', '/corrections'), '. Verify anything you intend to act on against the primary source.'),
       'To the extent the law allows, no one behind this site is liable for a loss that follows from relying on it.']],
    ['No execution',
      'Nothing here places, routes or executes an order. There is no brokerage connection, and no instruction you give this site reaches a market, a broker or a bank.'],
    ['Prices and licensing',
      'No market data is redistributed. Where a price is shown, its source and the right it is shown under are stated on the page.'],
    ['Your data stays in your browser',
      [tp('What you enter is kept in this browser’s local storage and nowhere else — see ', tlink('Privacy', '/privacy'), '. Export anything you want to keep: clearing the browser’s storage deletes it, and there is no copy anywhere to restore it from.'),
       'Data you paste in stays under the terms you obtained it on — a broker’s export is still your broker’s data.']],
    ['No accounts',
      'There is no sign-in and no account, so there is nothing to register, close or cancel.'],
    ['Pricing: not on sale',
      [tp('The plans on the ', tlink('pricing page', '/pricing'), ' are proposed prices, not on sale yet, shown so you can see what is planned. Nothing can be bought: there is no checkout and no payment provider, nothing is charged or renewed, and so there is no refund policy yet. A plan’s button previews its features in this browser only.'),
       'If sales ever open, terms of sale and a refund policy will be published here before anything can be bought.']],
    ['Changes',
      'These terms change with the build they describe. This draft was written on 29 September 2026.'],
    ['Governing law',
      'These terms are governed by the laws of Malaysia, and the courts of Malaysia have jurisdiction over any dispute about them.'],
    ['Contact',
      [tp(supplied('email'), ' · ', supplied('address'), '. Until they are supplied, the ', tlink('contact page', '/contact'), ' says what works today.')]],
  ], { draft: 'These terms are a working draft: no operating entity has been registered to offer them, and every detail shown as “To be supplied” is a gap, not a fact.' });

VIEWS.notfound = () => {
  const wrap = el('div', { class: 'stack' });
  const card = el('div', { class: 'card', style: 'text-align:center;padding:var(--xxxl) var(--lg)' });
  card.append(el('div', { class: 'num', style: 'font-size:44px;font-weight:700' }, '404'));
  card.append(el('h1', { class: 'page-title', style: 'margin-top:6px' },
    State.notFoundWhat ? `No ${State.notFoundWhat}` : 'That page does not exist'));
  card.append(el('p', { class: 'body-lg', style: 'margin:10px auto 0;max-width:54ch' },
    State.notFoundWhat
      ? 'It may have been renamed, or it may not be in the universe this build covers. Search for it, or start from Equities Research.'
      : 'The link may be out of date. Everything below is a real destination.'));
  /* The way out, in the navigation this build has: the workspace as the one
     primary action, the products that exist by name (from PRODUCTS, so a
     product that is not built is never offered), and home. The row still
     named the old header — Discover, Research, Property — as bare .btn text
     with no border or fill, so four words sat under the heading looking like
     a sentence rather than four ways out. */
  const go = (p) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); State.notFoundWhat = null; navigate(p); };
  const row = el('div', { class: 'row', style: 'gap:8px;justify-content:center;flex-wrap:wrap;margin-top:var(--lg)' });
  row.append(el('a', { class: 'btn btn-primary', href: href('/app'), onclick: go('/app') }, 'Open your workspace'));
  PRODUCTS.filter(p => p.path).forEach(p => row.append(el('a', { class: 'btn btn-ghost', href: href(p.path), onclick: go(p.path) }, p.name)));
  row.append(el('a', { class: 'btn btn-ghost', href: href('/'), onclick: go('/') }, 'Home'));
  card.append(row);
  wrap.append(card);
  return wrap;
};

