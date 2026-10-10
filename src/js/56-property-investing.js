/* ==========================================================================
   PROPERTY INVESTING IN SARAWAK — /property-investing (the owner's decision
   of 7 Oct 2026 on the marketing proposal: a search-targeted landing page
   with the live Lab and the real cost stack)
   --------------------------------------------------------------------------
   For someone weighing a property purchase in Sarawak who has not yet met
   the tools. It shows before it explains (the layout system's second
   rule): the Scenario Lab, compact, on the sample deal, and where the
   sample's cash required goes, by what it rests on — both drawn by the calculator's
   own model (dealModel) and the fee rulebook, never typed. Then what the
   tools do, the decision layer's four routes in a line each, and what the
   tools do not do. One primary action, into the Lab (/property); the
   calculator as the lower-friction second.

   WHAT IT MAY SAY. Only what ships: the tools and the figures the page
   draws. No testimonial, statistic, client, outcome or claim of accuracy;
   no ranking word; no paid call to action; nothing collected and nothing
   measured (no tracking). The disclosures stay in sight — not advice, not
   an official valuation, the sample not a real listing — and the four
   things the tools do not do have a section of their own. wording-check
   holds this module and its render to that.

   It reads nothing a browser keeps — the sample deal only — so the page
   served is the page drawn, for every reader.
   ========================================================================== */

/* The sample's cash required (dealModel's ledger, ledgerSplit's lines), by
   what each line rests on, the reader's own money first: the deposit, the
   renovation and the reserve. */
const PI_ROW = {
  own: 'Deposit, renovation and reserve',
  verified: 'Duties and fees computed from a cited rule',
  quote: 'Quotations you entered',
  estimate: 'Estimated lines',
};
const piRound = (v) => Math.round(v * 1e4) / 1e4;
function piCashStack() {
  const m = dealModel(pmCopy(PROPERTY_DEFAULT_DEAL));
  const s = m.ledgerSplit || { kinds: {} };
  /* By what each line rests on, not by its ledger kind: a kind mixes a
     verified duty with an estimated fee charged on it, and its badge could
     only be the weaker. The rows: the sample's own money; the lines
     computed from a cited rule (Verified, the D6 badge Derived); a
     quotation; and the estimates (Placeholder) — the amount the note under
     them names line by line. */
  const all = Object.values(s.kinds || {}).flatMap(x => x.lines || []);
  const by = (k) => all.filter(l => (k === 'own' ? !l.provenance
    : k === 'verified' ? l.provenance === 'verified'
    : k === 'quote' ? l.provenance === 'quote'
    : l.provenance === 'estimated' || l.provenance === 'unknown'));
  const rows = ['own', 'verified', 'quote', 'estimate'].map(k => { const lines = by(k); return { k, lines, total: lines.reduce((t, l) => t + (isNum(l.amount) ? l.amount : 0), 0) }; })
    .filter(r => r.lines.length && r.total > 0);
  const sum = rows.reduce((t, r) => t + r.total, 0);
  const total = isNum(m.safeCashRequired) ? m.safeCashRequired : sum;
  /* A row's badge: the sample's own figures are Illustrative; a fee kind
     wears the weakest of its lines' (KIND_OF_FEE: Verified lines are
     Derived — arithmetic on the cited rule — and an estimate a Placeholder). */
  const badgeOf = (r) => (r.k === 'own'
    ? kindBadge('illustrative', { fine: 'The sample deal’s own figures', link: false })
    : kindBadge(kindFirst(r.lines.map(l => KIND_OF_FEE[l.provenance] || 'illustrative')) || 'illustrative', { fine: PI_ROW[r.k], link: false }));
  const labelOf = (r) => PI_ROW[r.k];
  /* The bar: each kind's share of the total, its x and width rounded to
     1e-4 so every browser draws the same served markup. */
  let x = 0;
  const rects = rows.map(r => {
    const w = sum > 0 ? r.total / sum * 100 : 0;
    const out = `<rect class="pi-seg pi-k-${r.k}" x="${piRound(x)}" y="0" width="${piRound(w)}" height="10" data-v="${Math.round(r.total)}"/>`;
    x += w;
    return out;
  }).join('');
  const fig = el('figure', { class: 'pi-stack', 'aria-labelledby': 'pi-stack-cap' });
  fig.append(el('div', { class: 'pi-stack-hd' }, [
    el('p', { class: 'pi-stack-k' }, 'Cash required'),
    el('p', { class: 'pi-stack-total num', 'data-v': String(Math.round(total)) }, fmtMoney(total, 'MYR', 0)),
  ]));
  fig.append(el('span', { class: 'pi-stack-bar', html: `<svg class="pi-stack-svg" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${esc(`The sample deal’s cash required, ${fmtMoney(total, 'MYR', 0)}: ${rows.map(r => `${labelOf(r).toLowerCase()} ${fmtMoney(r.total, 'MYR', 0)}`).join('; ')}.`)}">${rects}</svg>` }));
  fig.append(el('ul', { class: 'pi-stack-rows' }, rows.map(r => el('li', { class: 'pi-stack-row', 'data-kind': r.k }, [
    el('i', { class: `pi-sw pi-k-${r.k}`, 'aria-hidden': 'true' }),
    el('span', { class: 'pi-stack-l' }, labelOf(r)),
    el('span', { class: 'pi-stack-v num' }, fmtMoney(r.total, 'MYR', 0)),
    badgeOf(r),
  ]))));
  const uncertain = (m.unconfirmedLines || []).length
    ? `${fmtMoney(m.unconfirmedCost, 'MYR', 0)} of it rests on estimated lines: ${feeUncertainWords(m, (v) => fmtMoney(v, 'MYR', 0))}.`
    : null;
  if (uncertain) fig.append(el('p', { class: 'pi-stack-note' }, uncertain));
  fig.append(el('figcaption', { class: 'pi-stack-cap', id: 'pi-stack-cap' }, [
    el('p', { class: 'pi-src' }, [kindBadge('illustrative', { fine: 'The sample deal', link: false }), el('span', {}, 'Sample deal — not a real listing')]),
    el('p', { class: 'pi-src-line' }, [`Fees from the fee rulebook ${FEE_TABLE.version}, checked ${feeDay(FEE_TABLE.checkedOn)}. `,
      el('a', { class: 'pi-link', href: href('/data-sources#fee-rulebook') }, 'Each line’s source')]),
  ]));
  return fig;
}

/* The tools, one action card each (the layout system's action card: a
   title, one line, one call to action), in the product's tab order. */
const PI_TOOLS = [
  { title: 'Scenario Lab', line: 'Move price, deposit, rate, rent and renovation; up to three scenarios side by side, nothing ranked.', cta: 'Open the Lab', path: '/property' },
  { title: 'Calculator', line: 'Cash required, monthly cash flow, yield and break-even rent, each fee line marked Verified or Estimated with its source.', cta: 'Open the calculator', path: '/property/calculator' },
  { title: 'Comparables register', line: 'Record a transacted price or an achieved rent with what it rests on, then use it in a scenario.', cta: 'Record a comparable', path: '/property/comparables' },
  { title: 'Area screen', line: 'The localities of a town, shaded by what you have recorded; an area with no record stays hollow.', cta: 'Screen a town', path: '/property/areas' },
];
/* The decision layer's routes (83-property-decision.js, P2–P5): what the
   figures add on each, in a line. */
const PI_ROUTES = [
  ['Subsale', 'The gap between the asking price and the value your named comparables imply, and the highest price at which your target is met.'],
  ['Auction', 'The effective acquisition cost, the true discount and the forfeiture exposure, from the Proclamation’s terms you enter — none assumed.'],
  ['New development', 'The developer’s premium over your comparable, interest during construction from your drawdown schedule, and the cash flow from vacant possession.'],
  ['Commercial', 'Four rents kept apart, never blended; the rent tested against your comparables; and 3, 6, 12 and 18 months vacant from the lease’s expiry.'],
];
/* What the tools do not do — each a sentence the page owes the reader. */
const PI_NOT = [
  ['Value a property.', 'That is a registered valuer’s work; these tools show what your figures imply.'],
  ['Hold licensed market data.', 'No licensed transactions or listings ship here: the comparables are the ones you record, and the sample projects are synthetic.'],
  ['Give figures for a named building.', 'Nothing is shown or estimated building by building.'],
  ['Advise.', 'Nothing is recommended or ranked; check what applies to you with a lawyer, your lender and a tax adviser.'],
];

VIEWS.propertyInvesting = () => {
  const wrap = el('div', { class: 'pub pi ls-page' });

  /* -- the hero: the question, one action, the disclosure; the Lab beside -- */
  const hero = el('section', { class: 'pi-hero', 'aria-labelledby': 'pi-h1' });
  hero.append(el('div', { class: 'pi-hero-text' }, [
    el('p', { class: 'pi-kicker' }, 'Property investing · Sarawak'),
    el('h1', { class: 'pi-h1', id: 'pi-h1' }, 'Work out a Sarawak property before you buy'),
    el('p', { class: 'pi-lede' }, 'The cash it needs, what each month leaves after the loan, and up to three scenarios side by side — from the figures you enter.'),
    el('div', { class: 'pi-ctas' }, [
      pubLink('/property', { class: 'btn btn-primary pub-btn pi-cta-primary' }, 'Open the Scenario Lab', pubArrow()),
      pubLink('/property/calculator', { class: 'pub-textlink pi-cta-second' }, 'Or start in the calculator', pubArrow()),
    ]),
    el('div', { class: 'ls-disclosure pi-disclosure' }, el('p', {}, 'Arithmetic on your figures — not advice, and not an official property valuation.')),
  ]));
  hero.append(el('div', { class: 'pi-hero-fig' }, pubVisProperty({ badgeLink: false })));
  wrap.append(hero);

  /* -- the cost stack ------------------------------------------------------ */
  const cash = el('section', { class: 'pi-section pi-cash', id: 'pi-cash', 'aria-labelledby': 'pi-cash-h' });
  cash.append(el('h2', { class: 'pi-h2', id: 'pi-cash-h' }, 'Where the cash required goes'));
  cash.append(el('p', { class: 'pi-body' }, `The sample deal’s cash required, by what each part rests on, from the calculator’s model and the fee rulebook ${FEE_TABLE.version}.`));
  cash.append(piCashStack());
  wrap.append(cash);

  /* -- what the tools do ---------------------------------------------------- */
  const tools = el('section', { class: 'pi-section pi-tools', id: 'pi-tools', 'aria-labelledby': 'pi-tools-h' });
  tools.append(el('h2', { class: 'pi-h2', id: 'pi-tools-h' }, 'What the tools do'));
  tools.append(el('div', { class: 'pi-cards' }, PI_TOOLS.map(t => lsActionCard({ title: t.title, line: t.line, cta: lsCta(t.cta, { path: t.path }), cls: 'pi-card' }))));
  tools.append(el('p', { class: 'pi-body pi-saved' }, 'What you save stays in this browser — no account.'));
  wrap.append(tools);

  /* -- the decision layer --------------------------------------------------- */
  const routes = el('section', { class: 'pi-section pi-routes', id: 'pi-routes', 'aria-labelledby': 'pi-routes-h' });
  routes.append(el('h2', { class: 'pi-h2', id: 'pi-routes-h' }, 'Say what you are buying, and how'));
  routes.append(el('p', { class: 'pi-body' }, 'Two questions start the Lab and the calculator: residential, commercial or land; subsale, auction or new development. The figures that follow are the route’s own.'));
  routes.append(el('dl', { class: 'pi-route-list' }, PI_ROUTES.map(([k, v]) => el('div', { class: 'pi-route' }, [el('dt', {}, k), el('dd', {}, v)]))));
  wrap.append(routes);

  /* -- what they do not do -------------------------------------------------- */
  const not = el('section', { class: 'pi-section pi-not', id: 'pi-not', 'aria-labelledby': 'pi-not-h' });
  not.append(el('h2', { class: 'pi-h2', id: 'pi-not-h' }, 'What they do not do'));
  not.append(el('ul', { class: 'pi-not-list' }, PI_NOT.map(([k, v]) => el('li', {}, [el('strong', {}, k), ' ', v]))));
  wrap.append(not);
  return wrap;
};
