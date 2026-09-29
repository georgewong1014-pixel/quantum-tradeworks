/* ==========================================================================
   VIEW — LEARN / METHODOLOGY
   ========================================================================== */

State.learnTab = 'dictionary';
/* The public names of four tabs — the routes and the links use these; the
   panels are keyed by the ids below. Module-level so the router can validate a
   ?tab= against both without knowing the view's internals. */
const LEARN_TAB_ALIAS = { glossary:'dictionary', methodology:'models', 'data-sources':'data', corrections:'trust' };
const LEARN_TABS = [
  { id:'dictionary', label:'Metric dictionary' },
  { id:'scoring',    label:'Scoring architecture' },
  { id:'models',     label:'Valuation model router' },
  { id:'data',       label:'Data, rights & point-in-time' },
  { id:'trust',      label:'Corrections & model changes' },
];

VIEWS.learn = () => {
  const wrap = el('div');
  /* /learn/glossary is a route in the table and a link in the navigation, but
     'glossary' is not a tab id — the tab is 'dictionary', labelled "Metric
     dictionary". The lookup returned undefined and calling it threw, so the
     page rendered its header, its tab strip and nothing else. Resolved before
     the strip is built so the correct tab is also the one highlighted, and
     aliased rather than renamed because these URLs are already in the wild. */
  const panels = { dictionary: learnDictionary, scoring: learnScoring, models: learnModels, data: learnData, trust: learnTrust };
  if (!panels[State.learnTab]) State.learnTab = LEARN_TAB_ALIAS[State.learnTab] || 'dictionary';
  /* The heading names the tab on screen. Five Resources links open this
     page — Methodology, Data sources, Glossary, Learn, Corrections — and every
     one landed on the same "Methodology, in public", so the heading never
     confirmed which had been chosen. The section's name is the eyebrow. */
  const tabLabel = LEARN_TABS.find(t => t.id === State.learnTab)?.label || 'Metric dictionary';
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Learn · Methodology, in public'),
    el('h1', {}, tabLabel),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'If a number cannot be explained, it should not be shown. Every formula, weight, anchor range and limitation used anywhere in this prototype is published here.'),
  ])));

  /* Through the address. Four of the five tabs are pages in their own right
     (/learn/glossary, /methodology, /data-sources, /corrections) and the
     routes name them by their public alias; the fifth rides on ?tab=. A
     tablist, with arrow keys between the tabs (tabStrip). */
  const LEARN_ROUTE_TAB = { dictionary: 'glossary' };
  wrap.append(tabStrip('Methodology sections', LEARN_TABS, State.learnTab,
    id => go('learn', { tab: LEARN_ROUTE_TAB[id] || id }), { style: 'margin-bottom:var(--lg)' }));
  wrap.append(panels[State.learnTab]());
  return wrap;
};

/* THE DICTIONARY IS THE REGISTRY, READ ALOUD.
   It used to list the screener's fields by screener group with a formula and
   a missing-data line, and nothing else: no definition, no unit, no inputs,
   no period — and nothing at all for a measure the statements cannot
   support, so a reader looking for gross margin or the current ratio could
   not tell whether it was missing or forgotten. It now reads every row of
   the metric registry, by the ratio library's categories, and a measure
   whose line is not stored is listed as blocked with the line it needs. */
const TYPE_PLURAL = { bank: 'banks', insurer: 'insurers', early: 'pre-profit companies', reit: 'REITs' };
function learnDictionary() {
  const wrap = el('div');
  const blocked = METRICS.filter(x => x.blocked);
  const published = METRICS.filter(x => !x.blocked);
  const intro = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  intro.append(cardHead(`${published.length} measures from the stored statements, ${blocked.length} blocked`,
    `Every measure is defined once, in one registry, and the screener, the source drawer, the explanations and this page are all read from it. Version: ${MODEL_VERSION.split('·')[0].trim()}.`));
  intro.append(el('p', { class: 'body', style: 'max-width:72ch' },
    'The stored statements hold ten lines a year: revenue, operating profit (EBIT), net income, operating cash flow, capital expenditure, equity, debt, cash, shares in issue and dividend per share. A measure that needs any other line cannot be computed for any company, and is listed below as blocked rather than filled from a stand-in:'));
  const ul = el('ul', { class: 'dict-blocked' });
  blocked.forEach(x => ul.append(el('li', {}, [
    el('span', { class: 'ident' }, x.label),
    el('span', { class: 'caption' }, ` — needs ${x.needs.join(', ')}`),
  ])));
  intro.append(ul);
  intro.append(el('p', { class: 'caption', style: 'max-width:72ch' },
    'Adding them means widening the ingest and the stored statements, then regenerating the SEC dataset — which waits on a contact address the SEC requires and this build has not been given.'));
  wrap.append(intro);

  METRIC_CATEGORIES.forEach(cat => {
    const rows = METRICS.filter(x => x.cat === cat.id);
    if (!rows.length) return;
    const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
    card.append(cardHead(cat.label, cat.note));
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt dict' });
    t.append(el('thead', {}, el('tr', {}, ['Metric', 'What it is', 'Formula and inputs', 'Unit and period', 'Computable', 'Missing-data behaviour'].map(h => el('th', {}, h)))));
    const tb = el('tbody');
    rows.forEach(x => {
      const n = x.blocked ? 0 : U.filter(r => isNum(r.m[x.k])).length;
      const na = (x.na || []).map(tp => TYPE_PLURAL[tp] || tp);
      /* Applicability first, from the registry's list; a missing-data line
         whose first sentence only says the same about banks is not repeated. */
      const naText = na.length ? `Not applicable to ${na.join(', ')}${x.counted ? ', and left out of their coverage count' : ''}.` : null;
      const own = (x.miss || '').replace(/^Not (applicable|meaningful|computed) (to|for) (banks|a bank balance sheet)( — excluded rather than imputed)?\.\s*/, '');
      const miss = x.blocked || [naText, own || (naText ? 'Otherwise reported unavailable; never imputed.' : 'Reported unavailable; never imputed.')].filter(Boolean).join(' ');
      const inputs = (x.inputs || []).map(l => LINE_LABEL[l] || l);
      tb.append(el('tr', { class: x.blocked ? 'dict-row-blocked' : null }, [
        el('td', { class: 'ident' }, [metricLabel(x.k, x.label), el('div', { class: 'dict-kind' }, x.blocked
          ? el('span', { class: 'chip chip-bronze' }, 'Blocked')
          : provChip(x.kind))]),
        el('td', { class: 'dict-text' }, x.help?.simple || ''),
        el('td', { class: 'dict-text' }, [el('div', {}, x.formula),
          inputs.length || x.needs ? el('div', { class: 'caption' }, [
            inputs.length ? `Reads ${inputs.join(', ')}` : null,
            x.needs ? `${inputs.length ? '; needs' : 'Needs'} ${x.needs.join(', ')} — not in the stored statements` : null,
          ].filter(Boolean).join('')) : null]),
        el('td', { class: 'dict-text' }, [el('div', {}, METRIC_UNIT[x.unit]?.label || x.unit),
          el('div', { class: 'caption' }, METRIC_PERIOD[x.period] || x.period)]),
        el('td', {}, x.blocked ? el('span', { class: 'caption' }, `none of ${U.length}`) : `${n}/${U.length}`),
        el('td', { class: 'caption dict-text' }, miss),
      ]));
    });
    t.append(tb); tw.append(t); card.append(tw);
    wrap.append(card);
  });
  return wrap;
}

function learnScoring() {
  const wrap = el('div');
  const intro = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  intro.append(cardHead('Why a scorecard and not one composite',
    'Quality, growth, balance-sheet strength, capital allocation and valuation answer different questions and frequently point in opposite directions. Collapsing them into one number hides exactly the trade-off a reader needs to see. Pillars stay separate.'));
  const rules = ['Scores are computed inside valid cohorts — market, sector and business model — never against the whole universe alone.',
    'Both the absolute score and the peer percentile are shown.',
    'Missing inputs reduce coverage and re-base the weights; a score is never credited for data it does not have.',
    'Sector-specific input sets are used only where they are economically justified — banks and REITs have their own.',
    'Every score publishes its version, calculation date, source periods and coverage ratio.'];
  const ul = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:6px' });
  rules.forEach(x => ul.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  intro.append(ul);
  wrap.append(intro);

  /* The valuation pillar is defined apart from PILLARS because it is scored on
     the model's output; it is published here all the same, since it is a
     screener column and 30% of the composite. It was missing from this page. */
  const VARIANT_LABEL = { general: 'General (non-financial)', bank: 'Banks', reit: 'REITs', all: 'Every business model' };
  [...Object.entries(PILLARS), ['value', VALUE_PILLAR]].forEach(([key, def]) => {
    const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
    card.append(cardHead(def.label, key === 'value'
      ? 'One input set for every business model; all three inputs need a price, and the score re-bases over the ones that could be computed. The anchor range is the raw value that maps to a score of 0 and of 100.'
      : 'Input sets by business model. The anchor range is the raw value that maps to a score of 0 and of 100.'));
    Object.entries(def).filter(([k]) => k !== 'label').forEach(([variant, inputs]) => {
      card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, VARIANT_LABEL[variant] || variant));
      const tw = el('div', { class: 'tablewrap' });
      const t = el('table', { class: 'dt' });
      t.append(el('thead', {}, el('tr', {}, ['Input', 'Weight', 'Anchor 0', 'Anchor 100'].map(h => el('th', {}, h)))));
      t.append(el('tbody', {}, inputs.map(i => el('tr', {}, [
        el('td', { class: 'ident' }, i.label), el('td', {}, `${Math.round(i.w * 100)}%`),
        el('td', {}, i.inv ? i.fmt(i.hi) : i.fmt(i.lo)), el('td', {}, i.inv ? i.fmt(i.lo) : i.fmt(i.hi)),
      ]))));
      tw.append(t); card.append(tw);
    });
    wrap.append(card);
  });

  const risk = el('div', { class: 'card' });
  risk.append(cardHead('Risk grading', 'Flags are computed from the statements, then weighted into a composite. A grade is an ordering, not a probability.'));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, ['Severity', 'Weight', 'Bands'].map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, Object.entries(RISK_WEIGHT).map(([k, v]) => el('tr', {}, [
    el('td', { class: 'ident', html: sevChip(k).outerHTML }), el('td', {}, String(v)),
    el('td', { class: 'caption' }, k === 'critical' ? '0–21 Low · 22–44 Medium · 45+ High' : ''),
  ]))));
  tw.append(t); risk.append(tw);
  wrap.append(risk);
  return wrap;
}

function learnModels() {
  const wrap = el('div');
  const intro = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  intro.append(cardHead('One formula does not fit every business',
    'A bank has no meaningful free cash flow. A REIT distributes contracted income. A commodity producer earns nothing like its trailing figures at the wrong point in the cycle. Each company type is routed to a model pack that suits it, and the routing reason is published on the company page.'));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  /* The Companies column wraps as the checks beside it do. It kept the table's
     nowrap, and a mature row's list made it 2,537px wide: 1,865px of the table
     ran past its card at 1440, the column's heading with it, and every short
     row's companies sat off-screen, so the Bank to Early-stage rows read as if
     no company were routed to them. */
  const MEMBERS = 'text-align:left;white-space:normal;min-width:220px';
  t.append(el('thead', {}, el('tr', {}, ['Company type', 'Primary model', 'Secondary checks', 'Companies'].map((h, i) => el('th', i === 3 ? { style: MEMBERS } : {}, h)))));
  /* Every type routeModel handles, and the pack from routeModel itself. The
     table used to list seven types and take each pack from the first company
     of that type: the insurer and early-stage rows were missing though their
     packs are built and companies use them, and a type with no member printed
     no model at all, although the router still sends it somewhere. */
  t.append(el('tbody', {}, [
    ['mature', 'Mature profitable non-financial'], ['bank', 'Bank'], ['insurer', 'Insurer'], ['reit', 'REIT'],
    ['cyclical', 'Cyclical / commodity'], ['growth', 'High growth'], ['saas', 'Subscription software'], ['holding', 'Holding company'],
    ['early', 'Early-stage, loss-making'],
  ].map(([type, label]) => {
    const pack = routeModel({ type });
    const members = U.filter(r => r.c.type === type);
    return el('tr', {}, [
      el('td', { class: 'ident' }, label),
      el('td', { style: 'text-align:left;white-space:normal;max-width:200px' }, pack?.name || '—'),
      el('td', { style: 'text-align:left;white-space:normal;max-width:260px', class: 'caption' }, pack?.secondary.join(' · ') || '—'),
      el('td', { style: MEMBERS }, members.map(m => m.c.tk + illusText(m.c)).join(', ') || '—'),
    ]);
  })));
  tw.append(t); intro.append(tw);
  /* What the router does not do, stated beside what it does: saying so is the
     difference between a published methodology and a marketing page. */
  intro.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Known limits of the router'));
  const nb = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  [['Every company type in the table is routed', 'Every row of the intended router is built, including the insurer and loss-making early-stage packs. Routing is by business model, not by sector label.'],
   ['Embedded value is not modelled', 'The insurer pack uses residual income with a combined-ratio check. A life insurer’s embedded value is not disclosed in this dataset, so an embedded-value model cannot be run and is not approximated.'],
   ['Sum of the parts is not a true SOTP', 'The holding-company pack values consolidated cash flow and applies an explicit discount, because segment-level earnings and capital are not carried here.'],
   ['Routing is a default, not a verdict', 'Every pack’s assumptions are editable, and all nine methods are computed on every company regardless of which pack was selected.']]
    .forEach(([n, why], i) => nb.append(el('div', { class: i === 0 ? 'evidence support' : 'evidence counter', style: 'font-size:13px' },
      el('span', {}, [el('b', {}, n + ' — '), why]))));
  intro.append(nb);
  wrap.append(intro);

  Object.values(MODEL_PACKS).forEach(p => {
    const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
    card.append(cardHead(p.name, p.why));
    card.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Limitations'));
    const ul = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
    p.limits.forEach(x => ul.append(el('li', { class: 'evidence counter', style: 'font-size:13px' }, x)));
    card.append(ul);
    wrap.append(card);
  });

  const guards = el('div', { class: 'card' });
  guards.append(cardHead('Guardrails enforced by the studio', 'These are blocks and warnings in the product, not advice in a footnote.'));
  const gl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:6px' });
  ['Terminal growth at or above the discount rate is blocked — the perpetuity is undefined.',
   'A terminal value above 78% of enterprise value raises a warning: most of the answer is an assumption about the far future.',
   'A zero or negative starting free cash flow raises a warning and points to a scenario model instead.',
   'For banks, long-run growth above what retained earnings can fund at the assumed ROE and payout raises a warning.',
   'For REITs, modelling growth from a distribution that recurring income does not cover raises a warning.',
   'Data completeness below 80% reduces the confidence grade rather than being filled in.'].forEach(x =>
    gl.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  guards.append(gl);
  wrap.append(guards);
  return wrap;
}

function learnData() {
  const wrap = el('div');
  const src = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  src.append(cardHead('Source hierarchy', 'What a production deployment would need, and which of them this build actually reaches. One is connected; the rest are not. No price source is connected at any tier.'));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, ['Rank', 'Source', 'Used for', 'Status in this prototype'].map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, [
    ['1', 'Regulatory filings and exchange announcements', 'Reported facts',
      'Connected for the US only — audited annual statements from SEC EDGAR XBRL company facts. Bursa filings are not reachable on any compliant route, so the Malaysian financials are illustrative.'],
    ['2', 'Licensed market-data provider', 'Prices, corporate actions, reference data, redistribution rights',
      'Not connected, on either market. This is why every price-derived measure on a filed company reads as unavailable, and why share counts cannot be split-adjusted.'],
    ['3', 'Licensed estimates and news provider', 'Forward estimates, earnings calendar', 'Out of scope'],
    ['4', 'Derived platform metrics', 'Every ratio shown in this product', 'Computed live from the stored statement lines, filed or illustrative'],
    ['5', 'AI-derived qualitative claims', 'Moat structuring and change summaries', 'Authored, evidence-linked templates only'],
  ].map(r => el('tr', {}, r.map((c, i) => el('td', { class: i === 0 ? 'ident' : '', style: i > 0 ? 'text-align:left;white-space:normal' : '' }, c))))));
  tw.append(t); src.append(tw);
  src.append(el('p', { class: 'body', style: 'margin-top:var(--md);font-size:13px' },
    'Bursa Malaysia data is licensed, not free. Information-service licensing terms, a published price list and redistribution rights make the data workstream a commercial prerequisite — it has to be settled before the feature architecture is locked, not after.'));
  wrap.append(src);

  /* THE STATUS ON EVERY FIGURE. Five kinds of number and five reasons for an
     absence; the screener's cells and the drawer behind each use exactly these
     words, from the same registry this table reads. */
  const lg = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  lg.append(cardHead('How every figure is labelled', 'A number carries one of five kinds; an absence carries one of five reasons. The screener cell and the drawer behind it read the same registry, so they cannot disagree about one figure.'));
  const legendTable = (heads, rows) => {
    const tw = el('div', { class: 'tablewrap', style: 'margin-bottom:var(--sm)' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, heads.map(h => el('th', {}, h)))));
    t.append(el('tbody', {}, rows.map(r => el('tr', {}, r.map((x, i) => el('td', { style: i ? 'text-align:left;white-space:normal' : '' }, x))))));
    tw.append(t); return tw;
  };
  lg.append(legendTable(['Kind', 'Meaning'], ['reported', 'calculated', 'modelled', 'market', 'illustrative'].map(k => [provChip(k), PROVENANCE[k].note])));
  lg.append(legendTable(['Absence', 'Meaning'], Object.entries(ABSENCE).map(([k, a]) => [el('span', { class: 'chip chip-bronze' }, `Unavailable — ${k}`), a.legend])));
  lg.append(el('p', { class: 'metaline' }, 'Every empty cell on the screener prints the short form of its reason and opens the drawer that names the line, the flag or the price behind it.'));
  wrap.append(lg);

  /* SARAWAK TRANSACTION EVIDENCE — CORRECTED.
     This page previously implied no Sarawak transaction source existed. It
     does; what does not yet exist is the right to republish it. Those are
     different statements and only one of them is true. */
  const nap = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  nap.append(cardHead('Sarawak transaction evidence',
    'Official transaction data for Sarawak exists and is publicly reachable. What has not been granted is the right to '
    + 'republish records to subscribers. This product may source and analyse; it may not redistribute.'));
  nap.append(el('p', { class: 'body', style: 'margin-top:var(--md);font-size:13px' }, [
    el('strong', {}, 'The position, stated once: '),
    'Quantum Tradeworks can source and analyse official transaction evidence for Sarawak through NAPIC. '
    + 'Record-level republication remains restricted until NAPIC or another licensed provider grants commercial '
    + 'redistribution rights. Nothing sourced that way is shown to anyone but the person who loaded it.',
  ]));
  const nt = el('table', { class: 'dt' });
  nt.append(el('thead', {}, el('tr', {}, ['Source', 'What it provides', 'Best use here', 'Licence position']
    .map((h, i) => el('th', { style: i ? 'text-align:left' : 'text-align:left' }, h)))));
  nt.append(el('tbody', {}, SARAWAK_TRANSACTION_SOURCES.map(s2 => el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left;white-space:normal' },
      el('a', { href: s2.url, target: '_blank', rel: 'noopener noreferrer' }, s2.name)),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, s2.gives),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, s2.use),
    el('td', { style: 'text-align:left;white-space:normal' }, [
      el('span', { class: LICENCE_BY_ID[s2.licence].publish ? 'chip' : 'chip chip-bronze',
        title: LICENCE_BY_ID[s2.licence].note }, LICENCE_BY_ID[s2.licence].label),
      el('span', { class: 'caption', style: 'display:block;margin-top:4px' }, s2.position),
    ]),
  ]))));
  nap.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--md)' }, nt));

  nap.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' },
    'What NAPIC has to confirm before a record reaches a subscriber'));
  const nq = el('ul', { class: 'ticklist blocklist' });
  NAPIC_LICENCE_QUESTIONS.forEach(q => nq.append(el('li', {}, q)));
  nap.append(nq);
  nap.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Every one of these is open. Until each is answered in writing, record-level NAPIC data is held as '
    + '"licence pending": usable as your own evidence, excluded from export and never republished. '
    + 'Requests go to prismsupport@jpph.gov.my.'));

  nap.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'What is not done, and will not be'));
  const nx = el('ul', { class: 'ticklist blocklist' });
  ['Portal scraping. EdgeProp permits analytics for internal use and prohibits constructing, extracting or '
   + 'redistributing a database. Brickz sources from JPPH and is for verifying a figure, not for copying.',
   'Copying Sarawak Land and Survey material, which may not be distributed or commercially dealt with without written consent.',
   'Presenting a district-level figure as a locality figure. NAPIC files by district, mukim, town and scheme; '
   + 'this product files by town and locality, and an unmapped district is held for a person to place rather than guessed into the nearest town.',
  ].forEach(x => nx.append(el('li', {}, x)));
  nap.append(nx);
  wrap.append(nap);

  /* The licence ladder itself, because it is new and orthogonal to the evidence
     ladder a reader already knows. */
  const lic = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  lic.append(cardHead('Licence, which is not the same question as evidence',
    'Every figure here carries two grades. Evidence says how far to believe it. Licence says what may be done with it. '
    + 'A NAPIC transaction is strong evidence that may not be republished; a figure you typed is weak evidence that is entirely yours.'));
  const lt = el('table', { class: 'dt' });
  lt.append(el('thead', {}, el('tr', {}, ['State', 'Shown to you', 'In an export', 'Republished', 'What it means']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  lt.append(el('tbody', {}, DATA_LICENCES.map(l => el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left' },
      el('span', { class: l.publish ? 'chip' : 'chip chip-bronze' }, l.label)),
    el('td', {}, l.show ? 'yes' : 'no'),
    el('td', {}, l.export ? 'yes' : 'no'),
    el('td', {}, l.publish ? 'yes' : 'no'),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, l.note),
  ]))));
  lic.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--md)' }, lt));
  wrap.append(lic);

  const pit = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  pit.append(cardHead('Point-in-time policy', 'Screens and backtests must query what was known on the selected date, not the latest corrected database. Without this, historical results are not credible.'));
  const kv = el('dl', { class: 'kv' });
  [['Source event time', 'When the company published it'],
   ['Provider receipt time', 'When the vendor made it available'],
   ['Ingestion time', 'When the platform stored it'],
   ['Calculation time', 'When the derived metric was computed'],
   ['Effective availability time', 'The timestamp a point-in-time query uses'],
   ['Restatement link', 'Amended filings create a new version; history is never overwritten']]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, v)); });
  pit.append(kv);
  wrap.append(pit);

  const cov = el('div', { class: 'card' });
  cov.append(cardHead('Coverage in this prototype', 'What is deliberately absent is as important as what is present.'));
  const g = el('div', { class: 'grid g-2' });
  const have = el('div');
  have.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Present'));
  const hl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  [covText(k => `${k.us} US companies and ${k.my} Bursa companies`),
   'Up to ten fiscal years for each SEC-filed company — as many as it has filed in XBRL, and a few carry fewer; five authored years for each illustrative one, extended to ten by a labelled reconstruction — every ratio derived live',
   'Bank, REIT, cyclical, growth and holding-company model packs',
   'Shariah status, board category and PN17 flags for the Malaysian set'].forEach(x => hl.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  have.append(hl); g.append(have);
  const lack = el('div');
  lack.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Absent by design'));
  const ll = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  [`Interest expense, cost of revenue, total assets, current assets and liabilities, inventory and depreciation — so ${METRICS.filter(x => x.blocked).map(x => x.label.toLowerCase().replace('ev / ebitda', 'EV / EBITDA')).join(', ')} are listed in the metric dictionary as blocked rather than estimated`,
   'Forward estimates and analyst revisions — these require a licence',
   'Intraday prices, order books and tick data',
   'Backtested theme returns — shown only with point-in-time data and full cost assumptions',
   'Brokerage connections, order execution and personalised allocation',
   'Historical score versions — only the current score exists, so a saved screen cannot be re-run against an earlier model version',
   /* The ingest now keeps the first-filed figure beside the latest and flags
      the year; the shipped file predates that, and even with it a period
      holds one figure, so this stays on the list. */
   'Restatement and amendment versioning — the dataset holds one version of each period, so a restatement overwrites rather than branches. The SEC ingest now records the first-filed value beside the latest and flags a restated year, but the shipped statements predate it',
   'Winsorisation of extreme inputs — score inputs are clamped at their published anchor range instead, which bounds the score but does not treat the outlier',
   'Lease, minority-interest, associate and non-controlling-interest adjustments — these lines are not carried, so enterprise value is unadjusted for them',
   'Share-based compensation as a separate line — it cannot be isolated from operating cash flow in this dataset',
   'Accounts and sign-in — every list, portfolio, thesis and alert lives in this browser and is lost if you clear it',
   'Free trial, billing, cancellation and renewal — no payment system exists, and a mocked one would be a claim the product cannot honour',
   /* This said nothing was gated, while the plan switcher on /pricing visibly
      unlocks the full property report and the cross-asset view. Both were true
      of different things — there is no SERVER entitlement, and there is a local
      one — and the sentence collapsed them into a claim a reader could disprove
      in two clicks. */
   'Server-side entitlement — plan tiers are enforced in this browser only, for inspection. Switching plan on the pricing page does change what renders, including the full property report and the cross-asset view. There is no identity, no payment, no subscription record and no production access control behind it'].forEach(x => ll.append(el('li', { class: 'evidence counter', style: 'font-size:13px' }, x)));
  lack.append(ll); g.append(lack);
  cov.append(g);
  wrap.append(cov);
  return wrap;
}

function learnTrust() {
  const wrap = el('div');
  wrap.append(el('div', { style: 'margin-bottom:var(--md)' }, scopeCard()));
  const modes = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  modes.append(cardHead('Product modes',
    'The architecture supports two configurations. This prototype runs in Research mode only; the advisory surfaces do not exist in the build, they are not merely hidden.'));
  const g = el('div', { class: 'grid g-2' });
  const rm = el('div', { class: 'panel' });
  rm.append(el('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [el('span', { class: 'chip chip-brand' }, 'Active'), el('h4', { class: 'h-card' }, 'Research mode')]));
  const rl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Factual and analytical outputs', 'Published formulas and linked evidence', 'User-controlled assumptions',
   'No suitability questionnaire', 'No action recommendation', 'No target allocation',
   'Themes described as rule-based research universes', 'Alerts describe changed facts and conditions'].forEach(x =>
    rl.append(el('li', { style: 'font-size:13px;color:var(--ink-2)' }, `✓ ${x}`)));
  rm.append(rl); g.append(rm);
  const am = el('div', { class: 'panel', style: 'opacity:.72' });
  am.append(el('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, [el('span', { class: 'chip' }, 'Not built'), el('h4', { class: 'h-card' }, 'Licensed advisory mode')]));
  const al = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Suitability and risk profiling', 'Representative oversight and governance', 'Advice rationale and record keeping',
   'Conflict and compensation disclosure', 'Controlled recommendation language', 'Policy approvals and surveillance'].forEach(x =>
    al.append(el('li', { style: 'font-size:13px;color:var(--ink-3)' }, `· ${x}`)));
  am.append(al); g.append(am);
  modes.append(g);
  modes.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'A disclaimer does not change the substance of a feature. In Malaysia, automated algorithm-based investment advice is treated as investment advice under the Capital Markets and Services Act and requires a licence when carried on as a business — so each surface needs written legal classification before launch, not a footnote.'));
  wrap.append(modes);

  /* The reader's own cases, above the sample log — a case they raised and
     cannot find again is a case they have no reason to believe was kept. */
  const mine = State.corrections || [];
  const mineCard = el('div', { class: 'card', id: 'my-cases', style: 'margin-bottom:var(--md)' });
  mineCard.append(cardHead(`Cases you have recorded — ${mine.length}`,
    'Held in this browser only. Nothing has been sent, because there is no server behind this build and no contact address published yet.'));
  if (!mine.length) {
    mineCard.append(el('p', { class: 'metaline' },
      'None yet. Any figure on this site can be challenged — the report button in the footer records a case with the page, the model version and the data date attached.'));
  } else {
    const mt = el('table', { class: 'dt' });
    mt.append(el('thead', {}, el('tr', {}, ['Case', 'Raised', 'Item', 'Status', ''].map(h =>
      el('th', { style: 'text-align:left' }, h)))));
    const mb = el('tbody');
    mine.forEach((c, row) => mb.append(el('tr', {}, [
      el('td', { class: 'ident', style: 'text-align:left' }, c.id),
      el('td', { class: 'caption', style: 'text-align:left' }, c.createdAt),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
        `${c.item}${c.subject ? ` · ${c.subject}` : ''}`),
      el('td', { style: 'text-align:left' }, el('span', { class: 'chip chip-bronze' }, c.status)),
      el('td', { style: 'text-align:left' }, el('button', { class: 'btn btn-ghost btn-sm', id: `case-open-${row}`,
        onclick: () => openDrawer(`Case ${c.id}`, (() => {
          const w = el('div');
          /* Named, as every field on this page is: a bare textarea is announced
             as an unlabelled edit box, with nothing to say it holds the case. */
          const pre = el('textarea', { class: 'input', 'aria-label': `Case ${c.id}, as text to copy`, style: 'min-height:220px;font-family:var(--mono,monospace);font-size:12px' });
          pre.value = correctionPayload(c);
          w.append(pre);
          w.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
            el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
              pre.select();
              (navigator.clipboard ? navigator.clipboard.writeText(pre.value) : Promise.reject())
                .then(() => toast('Case copied')).catch(() => toast('Select the text above and copy it'));
            } }, 'Copy'),
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
              /* By identity, not by id: a browser that recorded cases before
                 the id fix can hold two with the same id, and Delete must
                 remove only the one that was opened. */
              State.corrections = (State.corrections || []).filter(x => x !== c);
              /* The drawer handed focus back to the Open button it came from,
                 which the redraw had just removed with its row, so focus
                 fell to <body>. It goes to the Open button of the case that
                 took the row, or the one before, or the list's heading. */
              saveCorrections(); closeDrawer({ restore: false }); render();
              focusAfterRedraw(`#case-open-${row}`, `#case-open-${row - 1}`, '#my-cases h3');
              toast(`${c.id} deleted`);
            } }, 'Delete this case'),
          ]));
          return w;
        })()) }, 'Open')),
    ])));
    mt.append(mb);
    mineCard.append(el('div', { class: 'tablewrap' }, mt));
  }
  wrap.append(mineCard);

  const corr = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  /* REAL ENTRIES, FROM THE CHANGE HISTORY OF THIS BUILD.
     This table used to hold three invented rows labelled "sample entries
     showing the format" — with specific dates, and one claiming that "owners
     were notified" of a change on a product that has no accounts and nobody
     to notify. A corrections log whose entries are made up is the one page on
     the site that cannot be allowed to be. Every row below is a correction
     that shipped, dated by its commit, and describes what was wrong and what
     changed. Nothing here is illustrative. */
  corr.append(cardHead('Corrections log', 'Drawn from the change history of this build. Every correction records what was wrong and what changed; the most recent is first.'));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, ['Date', 'Scope', 'What was wrong', 'What changed'].map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, [
    ['28 Sep 2026', 'Metric dictionary',
      'Net margin was computed and published nowhere; free cash flow, operating cash flow margin and net-income growth were supported by the stored statements and not offered; twenty-four screener measures had no plain-language definition; and gross margin, return on assets, the current and quick ratios and EV/EBITDA were simply missing from the dictionary, with nothing to say why. A bank’s free cash flow was published although every measure built on it was declared not applicable.',
      'Metrics 1.7.0 and scores 1.4.0. Six measures are published — net margin, operating cash flow margin, free cash flow, net income growth over four years and one, and revenue growth over one — every measure has a definition, unit and period, and the five that need lines the statements do not carry are listed as blocked. A bank’s free cash flow is not computed, so Citigroup and Goldman Sachs no longer carry a negative-free-cash-flow risk flag. No coverage figure changed.'],
    ['26 Sep 2026', 'Statement display',
      'Ten SEC filers whose fiscal year ends before December — Microsoft, Nvidia, Walmart, Oracle, Nike and five more — had every column labelled one year early: figures for fiscal 2026 were printed under FY2025.',
      'Every label now reads the company’s own fiscal years, on the statement table, the source drawer, the provenance strip and the Value Map. No figure changed.'],
    ['26 Sep 2026', 'Metric engine',
      'A missing capital-expenditure, dividend or debt line was read as nought: the reinvestment rate published 0% on every filer whose capital-expenditure line did not resolve (sixteen, six of them banks); the payout ratio 0% on the eighteen whose dividend line did not resolve while earnings were positive; and of the twelve filers with no debt line, the seven routed to a model that bridges enterprise value to equity — plus one with debt but no cash line — were valued with a zero bridge, as if debt-free.',
      'Each measure now requires its inputs and reports unknown without them. The valuation reports itself unavailable, with the reason, rather than assuming a balance sheet.'],
    ['26 Sep 2026', 'Metric engine',
      'Earnings, book-value and dividend growth were computed across stock splits, so they measured the split rather than the company. Share-count growth had been withheld on the same evidence since 9 August; the other per-share lines had not.',
      'Every per-share growth rate is withheld where the share series breaks, and the statement table says why.'],
    ['26 Sep 2026', 'Property model',
      'The five- and ten-year exit table totalled rent before tax while the year-by-year path beside it was after tax. The stress rows charged a management fee to a self-managed owner. A quoted MRTA premium never replaced the RM8,000 placeholder in the ledger.',
      'One year’s cash flow is computed in one place and both surfaces call it. One composition of running costs serves the model and the stress tests. The reader’s quote takes the line, marked as a quote.'],
    ['09 Sep 2026', 'Property model',
      'The asset class was asked for and then ignored: a bare parcel was given a rental yield, a debt-service cover and a break-even rent, and graded on them.',
      'Land withholds every rent-derived figure; the carrying cost and the exit remain. No residential figure moved.'],
    ['05 Sep 2026', 'Property model',
      'Real property gains tax used four unsourced rates and silently assumed an individual citizen was selling.',
      'The rate follows the disposer category — citizen, company, non-citizen — and the holding year, computed on the chargeable gain with Schedule 4 relief. Every rate carries its citation and is marked unverified until someone checks it.'],
    ['21 Aug 2026', 'Property model',
      'The figure labelled IRR was the annualised total multiple, which ignores when cash arrives; on the default deal it overstated the return by more than a point (3.48% against 2.38%). Income tax on rent was not modelled at all.',
      'A real internal rate of return, solved on the cash-flow vector and shown beside the multiple with the gap explained. Rental income tax with the interest deductible and the principal not.'],
    ['21 Aug 2026', 'Property register',
      'One demand record disabled undo for every earlier change in the register, silently. Backups dropped demand records.',
      'Entities declare their undo and replay together; a backup carries every entity; a state-machine test now fails the build if undo jams.'],
    ['09 Aug 2026', 'Score model',
      'The valuation pillar substituted fixed scores for its three price-dependent inputs, so 115 companies with no price scored exactly 46 with coverage reported as 100%. Share-count growth across a split read Apple’s four-for-one as 12% a year of issuance.',
      'The pillar scores over the inputs that were testable and returns no score when none were. Share-count growth and buyback yield are withheld across a split and the discontinuity is named on the page.'],
    ['07 Aug 2026', 'Company pages',
      'A company with filings and no price threw when viewed in another currency; the price-alert form prefilled RM0.00 for it; the Financial Strength scorecard printed a broken, non-numeric weight in its Weight column.',
      'All three fixed. No score changed.'],
  ].map(r => el('tr', {}, r.map((c, i) => el('td', { class: i === 0 ? 'ident' : '', style: i > 1 ? 'text-align:left;white-space:normal;max-width:300px' : '' }, c))))));
  tw.append(t); corr.append(tw);
  wrap.append(corr);

  const rep = el('div', { class: 'card' });
  rep.append(cardHead('Report an error', 'Every data item in the product is reportable, and a report is tied to the exact item rather than to a general inbox.'));
  rep.append(el('button', { class: 'btn btn-primary btn-sm', id: 'open-report-form', onclick: () => openReportError() }, 'Open the report form'));
  wrap.append(rep);
  return wrap;
}

/* CORRECTION CASES
   ---------------------------------------------------------------------------
   The form used to open, collect two fields, discard them, and toast "Report
   submitted — you would receive the correction outcome". Nothing was submitted,
   nothing was retained, and nobody would receive anything. A product whose
   pitch is that every figure can be challenged had a challenge button that
   threw the challenge away, and then said thank you.

   There is no server, so a case cannot be sent anywhere from here. What it can
   do is be RECORDED: given an id, kept, listed back, and handed over in a form
   the reader can actually send. So the wording is exact — recorded, not
   submitted; nothing has reached anyone. Claiming receipt is the thing that
   made the old version worse than no button at all. */
State.corrections = store.read('corrections', []);
const saveCorrections = () => store.write('corrections', State.corrections);

/* QT-YYYYMMDD-NNN. The sequence comes from the cases already stored on that
   date, so two cases raised in the same millisecond cannot collide the way a
   timestamp id would. It is one past the HIGHEST sequence used, not the count
   of cases: counting reissued an id still in use as soon as one case was
   deleted, and deleting either of the pair then removed both. */
function nextCaseId(d = new Date()) {
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const used = (State.corrections || []).map(c => String(c.id || ''))
    .filter(id => id.startsWith(`QT-${stamp}-`)).map(id => parseInt(id.slice(-3), 10)).filter(Number.isFinite);
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `QT-${stamp}-${String(n).padStart(3, '0')}`;
}

/* The time a case was raised, on the same local clock as its id and labelled
   with its offset. It was the UTC clock with no zone, so in Kuala Lumpur a case
   raised at 00:30 on the 28th carried a 20260928 id and "Raised 2026-09-27
   16:30", and the payload the reader sends repeated the disagreement. */
function caseRaisedAt(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const zone = `UTC${off < 0 ? '−' : '+'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${zone}`;
}

function correctionPayload(c) {
  return [
    `Correction case ${c.id}`,
    `Raised: ${c.createdAt}`,
    `Page: ${c.route}`,
    `Subject: ${c.subject || '—'}`,
    `Data item: ${c.item}`,
    `Shown: ${c.shownValue || '—'}`,
    `Should be: ${c.expectedValue || '—'}`,
    `Source that disagrees: ${c.sourceRef || '—'}`,
    ``,
    c.description || '(no description given)',
    ``,
    `Model version: ${c.modelVersion}`,
    `Data as of: ${c.asOf}`,
    `Universe at the time: ${c.coverage}`,
  ].join('\n');
}

/* THE WAITLIST, WHICH REFUSES TO EXIST UNTIL IT CAN WORK.
   ---------------------------------------------------------------------------
   Nothing can be bought here: there is no entity, no payment, no account. So
   every visitor a campaign brings is someone who cannot act today, and the only
   honest thing to ask for is permission to tell them when they can.

   It returns null while LAUNCH holds neither an endpoint nor an address,
   because a form that thanks somebody and stores nothing is the corrections
   form's old defect wearing a different label — and worse, because it converts
   a willing reader into one who believes they have already signed up and will
   not sign up again.

   What it promises is deliberately small and exactly what it can keep: one
   message, when there is something to say. No newsletter, no drip, no sharing —
   and it says so beside the field rather than in a policy nobody opens. */
/* Restore replaces; it never merges. Two portfolios both called "Long-term
   core" cannot be reconciled by a machine, and guessing wrong destroys the
   thing the reader was trying to protect. So the drawer says exactly what will
   be overwritten and what is in the file, before anything is written. */
function openRestoreDrawer() {
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    'Paste a Quantum Tradeworks export, or choose the file. Nothing is written until you have seen what it holds.'));

  const ta = el('textarea', { class: 'input', style: 'min-height:160px;font-family:var(--mono,monospace);font-size:12px',
    placeholder: 'Paste the JSON here' });
  const file = el('input', { class: 'input', type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a Quantum Tradeworks export file', style: 'margin-bottom:var(--md)' });
  file.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    ta.value = await f.text();
    check.click();
  });
  body.append(file);
  body.append(ta);
  const report = el('div', { style: 'margin-top:var(--md)' });

  const check = el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:var(--md)', onclick: () => {
    report.replaceChildren();
    let doc;
    try { doc = JSON.parse(ta.value); }
    catch (e) { report.append(el('p', { class: 'body', style: 'color:var(--dn-text)' }, `That is not valid JSON — ${e.message}`)); return; }
    const r = importEverything(doc);
    if (!r.ok) { report.append(el('p', { class: 'body', style: 'color:var(--dn-text)' }, r.err)); return; }

    report.append(el('p', { class: 'body', style: 'font-size:13px' },
      `Exported ${String(r.exportedAt || '').slice(0, 16).replace('T', ' ') || 'at an unstated time'}.`));
    const ul = el('ul', { class: 'ticklist', style: 'margin-top:8px' });
    r.incoming.forEach(k => {
      const label = (PORTABLE_KEYS.find(x => x.k === k) || {}).label || k;
      const cur = store.read(k, null);
      const has = cur !== null && cur !== undefined && (!Array.isArray(cur) || cur.length);
      ul.append(el('li', {}, `${label} — ${has ? 'REPLACES what is here now' : 'nothing here to replace'}`));
    });
    report.append(ul);
    /* What the file holds in a shape this app does not write is named with
       the reason and not written (STORE_SHAPES, 00-core.js): written, one
       list turned into a record threw on every workspace page. */
    if (r.refused.length) {
      report.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
        'Not restored — the file holds these in a shape this app does not write, so what is here now is kept:'));
      report.append(el('ul', { class: 'ticklist', style: 'margin-top:6px' }, r.refused.map(({ k, why }) =>
        el('li', {}, `${(PORTABLE_KEYS.find(x => x.k === k) || {}).label || k} — not restored: it ${why}`))));
    }
    if (r.ignored.length) report.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Ignored, because this build does not recognise them: ${r.ignored.join(', ')}.`));

    report.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:var(--md)', onclick: () => {
      if (!confirm('Replace the listed items in this browser? What is here now cannot be recovered afterwards.')) return;
      r.apply();
      closeDrawer();
      /* A full reload rather than render(): half this state was read into
         module-level variables at boot, and repainting over them would show a
         mixture of the old and the new. */
      location.reload();
    } }, `Restore ${r.incoming.length} item${r.incoming.length === 1 ? '' : 's'}`));
  } }, 'Check this file');
  body.append(check);
  body.append(report);
  openDrawer('Restore from a file', body);
}

function waitlistCard() {
  if (!waitlistReady()) return null;

  const card = el('div', { class: 'card', style: 'border-left:3px solid var(--brand)' });
  card.append(cardHead('Tell me when this is real',
    'There is no company behind this yet, nothing can be bought, and nothing is stored on a server. One message when that changes — not a newsletter.'));

  const row = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:flex-end' });
  const f = el('div', { class: 'field', style: 'flex:1 1 260px;margin:0' });
  f.append(el('label', { for: 'wl-email' }, 'Email'));
  const input = el('input', { class: 'input', id: 'wl-email', type: 'email',
    autocomplete: 'email', placeholder: 'you@example.com' });
  f.append(input);
  row.append(f);

  const status = el('p', { class: 'metaline', style: 'margin-top:10px' });
  const submit = el('button', { class: 'btn btn-primary', onclick: async () => {
    const email = input.value.trim();
    /* Deliberately loose. Rejecting an address a mail server would accept, to
       satisfy a regex, loses a real person for nothing. */
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status.textContent = 'That does not look like an email address.'; return; }

    if (!LAUNCH.waitlistEndpoint) {
      /* No endpoint, but an address exists: hand it over rather than pretend. */
      location.href = `mailto:${LAUNCH.contactEmail}?subject=${encodeURIComponent('Quantum Tradeworks waitlist')}`
        + `&body=${encodeURIComponent(`Please add ${email} to the waitlist.`)}`;
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending…';
    try {
      const res = await fetch(LAUNCH.waitlistEndpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, at: new Date().toISOString(), from: location.pathname }),
      });
      if (!res.ok) throw new Error(String(res.status));
      row.replaceChildren();
      status.textContent = `${email} recorded. One message when there is something to say, and nothing else.`;
    } catch (err) {
      submit.disabled = false;
      /* Named, not swallowed. A silent failure here looks identical to success
         and costs the person the thing they came to do. */
      status.textContent = 'That did not send — nothing has been recorded. '
        + (LAUNCH.contactEmail ? `Email ${LAUNCH.contactEmail} instead.` : 'Please try again shortly.');
    }
  } }, 'Keep me posted');
  row.append(submit);
  card.append(row);
  card.append(status);
  card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'Your address is used for that one message and nothing else. It is not sold, not shared, and not added to any list you did not ask for. Reply to it and it is deleted.'));
  return card;
}

function openReportError() {
  /* What opened the form, for the redraw below to find again. */
  const opener = document.activeElement;
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    'This records a case in this browser and gives it an identifier. It does not send anything — there is no server behind this build and no contact address published yet — so the last step hands you the case to send yourself.'));

  const state = { item: (FIELDS[0] && FIELDS[0].label) || '', subject: '', shownValue: '', expectedValue: '', sourceRef: '', description: '' };
  const field = (label, key, kind, placeholder) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    f.append(el('label', { for: `err-${key}` }, label));
    const node = kind === 'area'
      ? el('textarea', { class: 'input', id: `err-${key}`, placeholder })
      : el('input', { class: 'input', id: `err-${key}`, type: 'text', placeholder });
    node.addEventListener('input', e => { state[key] = e.target.value; });
    f.append(node);
    body.append(f);
  };

  const f1 = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  f1.append(el('label', { for: 'errItem' }, 'Data item'));
  const sel = el('select', { class: 'select', id: 'errItem',
    onchange: e => { state.item = e.target.value; } });
  FIELDS.forEach(f => sel.append(el('option', { value: f.label }, f.label)));
  f1.append(sel); body.append(f1);

  field('Company or property this is about', 'subject', 'text', 'e.g. MSFT, or a Sibu condominium');
  field('What the page shows', 'shownValue', 'text', 'the figure as displayed');
  field('What it should be', 'expectedValue', 'text', 'leave blank if you only know it is wrong');
  field('Source that disagrees', 'sourceRef', 'text', 'a filing, a page, a document — a source makes this verifiable rather than a disagreement');
  field('What looks wrong?', 'description', 'area', 'Describe the discrepancy.');

  body.append(el('div', { class: 'sunk', style: 'margin-bottom:var(--md)' },
    el('dl', { class: 'kv' }, [
      el('dt', {}, 'Recorded with the case'),
      el('dd', { style: 'text-align:left' }, `The page you were on, model version ${MODEL_VERSION}, data as of ${AS_OF}, and the universe as loaded.`),
    ])));

  body.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!state.description.trim() && !state.expectedValue.trim()) {
      toast('Say what looks wrong, or what it should be, before recording the case');
      return;
    }
    const k = coverage();
    const now = new Date();
    const c = {
      id: nextCaseId(now),
      createdAt: caseRaisedAt(now),
      route: location.pathname + location.search,
      status: 'recorded — not sent',
      modelVersion: MODEL_VERSION, asOf: AS_OF,
      /* A case is evidence. Recording the sample counts against it because the
         audited set had not landed yet would file a case that misdescribes the
         build it was raised against. */
      coverage: k.resolved
        ? `${k.total} companies, ${k.filed} filed${k.personal ? `, ${k.personal} personal-research` : ''}, ${k.illustrative} illustrative`
        : 'coverage not resolved when this case was recorded',
      ...state,
    };
    State.corrections = [c, ...(State.corrections || [])].slice(0, 100);
    saveCorrections();
    /* The page is redrawn first, so the list on /corrections holds the new
       case — and that redraw replaced "Open the report form", the button the
       drawer was to hand focus back to, so closing the confirmation dropped
       focus on <body>. Focus goes to the button's replacement (or stays on
       an opener the redraw did not touch, like the footer's) before the
       confirmation opens, and openDrawer records that as where to return. */
    render();
    const back = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
    if (back && back !== document.body) back.focus({ preventScroll: true });
    openDrawer(`Case ${c.id} recorded`, (() => {
      const w = el('div');
      w.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
        `Recorded in this browser as ${c.id}. Nothing has been sent and nobody has received it — there is no server behind this build, and no contact address is published yet. Copy the case below and keep it, or send it once there is somewhere to send it to.`));
      const pre = el('textarea', { class: 'input', 'aria-label': `Case ${c.id}, as text to copy`, style: 'min-height:200px;font-family:var(--mono,monospace);font-size:12px' });
      pre.value = correctionPayload(c);
      w.append(pre);
      w.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
          pre.select();
          (navigator.clipboard ? navigator.clipboard.writeText(pre.value) : Promise.reject())
            .then(() => toast('Case copied')).catch(() => toast('Select the text above and copy it'));
        } }, 'Copy the case'),
        el('a', { class: 'btn btn-ghost btn-sm', href: href('/corrections'),
          onclick: e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); closeDrawer(); navigate('/corrections'); } },
          'See my recorded cases'),
      ]));
      return w;
    })());
  } }, 'Record this case'));
  openDrawer('Report a data error', body);
}

