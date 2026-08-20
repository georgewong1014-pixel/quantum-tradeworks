/* ==========================================================================
   VIEW — LEARN / METHODOLOGY
   ========================================================================== */

State.learnTab = 'dictionary';
const LEARN_TABS = [
  { id:'dictionary', label:'Metric dictionary' },
  { id:'scoring',    label:'Scoring architecture' },
  { id:'models',     label:'Valuation model router' },
  { id:'data',       label:'Data, rights & point-in-time' },
  { id:'trust',      label:'Corrections & model changes' },
];

VIEWS.learn = () => {
  const wrap = el('div');
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Learn'),
    el('h1', {}, 'Methodology, in public'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'If a number cannot be explained, it should not be shown. Every formula, weight, anchor range and limitation used anywhere in this prototype is published here.'),
  ])));
  /* /learn/glossary is a route in the table and a link in the navigation, but
     'glossary' is not a tab id — the tab is 'dictionary', labelled "Metric
     dictionary". The lookup returned undefined and calling it threw, so the
     page rendered its header, its tab strip and nothing else. Resolved before
     the strip is built so the correct tab is also the one highlighted, and
     aliased rather than renamed because these URLs are already in the wild. */
  const LEARN_TAB_ALIAS = { glossary:'dictionary', methodology:'models', 'data-sources':'data', corrections:'trust' };
  const panels = { dictionary: learnDictionary, scoring: learnScoring, models: learnModels, data: learnData, trust: learnTrust };
  if (!panels[State.learnTab]) State.learnTab = LEARN_TAB_ALIAS[State.learnTab] || 'dictionary';

  const sub = el('div', { class: 'subnav', style: 'margin-bottom:var(--lg)' });
  LEARN_TABS.forEach(t => sub.append(el('button', { role: 'tab', 'aria-selected': State.learnTab === t.id ? 'true' : 'false',
    onclick: () => { State.learnTab = t.id; render(); } }, t.label)));
  wrap.append(sub);
  wrap.append(panels[State.learnTab]());
  return wrap;
};

function learnDictionary() {
  const wrap = el('div');
  FIELD_GROUPS.forEach(g => {
    const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
    card.append(cardHead(g, null));
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Metric', 'Formula', 'Computable', 'Missing-data behaviour'].map(h => el('th', {}, h)))));
    const tb = el('tbody');
    FIELDS.filter(f => f.g === g).forEach(f => {
      const n = U.filter(r => isNum(r.m[f.k])).length;
      tb.append(el('tr', {}, [
        el('td', { class: 'ident' }, f.label),
        el('td', { style: 'text-align:left;white-space:normal;max-width:280px' }, f.formula),
        el('td', { html: `${n}/${U.length}` }),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal;max-width:300px' }, f.miss || 'Reported unavailable; never imputed.'),
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
    'Quality, value, risk and momentum answer different questions and frequently point in opposite directions. Collapsing them into one number hides exactly the trade-off a reader needs to see. Pillars stay separate.'));
  const rules = ['Scores are computed inside valid cohorts — market, sector and business model — never against the whole universe alone.',
    'Both the absolute score and the peer percentile are shown.',
    'Missing inputs reduce coverage and re-base the weights; a score is never credited for data it does not have.',
    'Sector-specific input sets are used only where they are economically justified — banks and REITs have their own.',
    'Every score publishes its version, calculation date, source periods and coverage ratio.'];
  const ul = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:6px' });
  rules.forEach(x => ul.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  intro.append(ul);
  wrap.append(intro);

  Object.entries(PILLARS).forEach(([key, def]) => {
    const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
    card.append(cardHead(def.label, 'Input sets by business model. The anchor range is the raw value that maps to a score of 0 and of 100.'));
    Object.entries(def).filter(([k]) => k !== 'label').forEach(([variant, inputs]) => {
      card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, variant === 'general' ? 'General (non-financial)' : variant === 'bank' ? 'Banks' : 'REITs'));
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
  t.append(el('thead', {}, el('tr', {}, ['Company type', 'Primary model', 'Secondary checks', 'Companies'].map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, [
    ['mature', 'Mature profitable non-financial'], ['bank', 'Bank'], ['reit', 'REIT'],
    ['cyclical', 'Cyclical / commodity'], ['growth', 'High growth'], ['saas', 'Subscription software'], ['holding', 'Holding company'],
  ].map(([type, label]) => {
    const sample = U.find(r => r.c.type === type);
    const pack = sample ? routeModel(sample.c) : null;
    const members = U.filter(r => r.c.type === type);
    return el('tr', {}, [
      el('td', { class: 'ident' }, label),
      el('td', { style: 'text-align:left;white-space:normal;max-width:200px' }, pack?.name || '—'),
      el('td', { style: 'text-align:left;white-space:normal;max-width:260px', class: 'caption' }, pack?.secondary.join(' · ') || '—'),
      el('td', {}, members.map(m => m.c.tk).join(', ') || '—'),
    ]);
  })));
  tw.append(t); intro.append(tw);
  /* The blueprint's router lists eight company types. Two have no pack here,
     and saying so is the difference between a published methodology and a
     marketing page. */
  intro.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Known limits of the router'));
  const nb = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  [['All eight company types are routed', 'Every row of the intended router is built, including the insurer and loss-making early-stage packs. Routing is by business model, not by sector label.'],
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
    ['4', 'Derived platform metrics', 'Every ratio shown in this product', 'Computed live from the stored sample lines'],
    ['5', 'AI-derived qualitative claims', 'Moat structuring and change summaries', 'Authored, evidence-linked templates only'],
  ].map(r => el('tr', {}, r.map((c, i) => el('td', { class: i === 0 ? 'ident' : '', style: i > 0 ? 'text-align:left;white-space:normal' : '' }, c))))));
  tw.append(t); src.append(tw);
  src.append(el('p', { class: 'body', style: 'margin-top:var(--md);font-size:13px' },
    'Bursa Malaysia data is licensed, not free. Information-service licensing terms, a published price list and redistribution rights make the data workstream a commercial prerequisite — it has to be settled before the feature architecture is locked, not after.'));
  wrap.append(src);

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
   'Five reported years per company, with every ratio derived live',
   'Bank, REIT, cyclical, growth and holding-company model packs',
   'Shariah status, board category and PN17 flags for the Malaysian set'].forEach(x => hl.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  have.append(hl); g.append(have);
  const lack = el('div');
  lack.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Absent by design'));
  const ll = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Interest expense — so interest cover is reported as unavailable rather than estimated',
   'Forward estimates and analyst revisions — these require a licence',
   'Intraday prices, order books and tick data',
   'Backtested theme returns — shown only with point-in-time data and full cost assumptions',
   'Brokerage connections, order execution and personalised allocation',
   'Historical score versions — only the current score exists, so a saved screen cannot be re-run against an earlier model version',
   'Restatement and amendment versioning — the dataset holds one version of each period, so a restatement would overwrite rather than branch',
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
  const mineCard = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
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
    mine.forEach(c => mb.append(el('tr', {}, [
      el('td', { class: 'ident', style: 'text-align:left' }, c.id),
      el('td', { class: 'caption', style: 'text-align:left' }, c.createdAt),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
        `${c.item}${c.subject ? ` · ${c.subject}` : ''}`),
      el('td', { style: 'text-align:left' }, el('span', { class: 'chip chip-bronze' }, c.status)),
      el('td', { style: 'text-align:left' }, el('button', { class: 'btn btn-ghost btn-sm',
        onclick: () => openDrawer(`Case ${c.id}`, (() => {
          const w = el('div');
          const pre = el('textarea', { class: 'input', style: 'min-height:220px;font-family:var(--mono,monospace);font-size:12px' });
          pre.value = correctionPayload(c);
          w.append(pre);
          w.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
            el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
              pre.select();
              (navigator.clipboard ? navigator.clipboard.writeText(pre.value) : Promise.reject())
                .then(() => toast('Case copied')).catch(() => toast('Select the text above and copy it'));
            } }, 'Copy'),
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
              State.corrections = (State.corrections || []).filter(x => x.id !== c.id);
              saveCorrections(); closeDrawer(); render(); toast(`${c.id} deleted`);
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
  corr.append(cardHead('Corrections log', 'Sample entries showing the format. Every correction records what was wrong, who was affected and what changed.'));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, ['Date', 'Scope', 'Issue', 'Resolution'].map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, [
    ['24 Jul 2026', 'Metric engine', 'Dividend cover used dividends declared rather than dividends paid for two Bursa REITs.', 'Recomputed; affected screens re-run; three saved screens changed membership and their owners were notified.'],
    ['11 Jul 2026', 'Score model 1.1.0 → 1.2.0', 'Capital Allocation over-weighted buybacks for companies with negative equity.', 'Weight re-based and the change published here. Note that this prototype does not retain prior score versions, so a screen saved before the change cannot be reproduced against the old model.'],
    ['02 Jul 2026', 'Company identity', 'A Bursa ticker change was not mapped, splitting five years of history across two records.', 'Records merged; point-in-time history preserved under the new identifier.'],
  ].map(r => el('tr', {}, r.map((c, i) => el('td', { class: i === 0 ? 'ident' : '', style: i > 1 ? 'text-align:left;white-space:normal;max-width:300px' : '' }, c))))));
  tw.append(t); corr.append(tw);
  wrap.append(corr);

  const rep = el('div', { class: 'card' });
  rep.append(cardHead('Report an error', 'Every data item in the product is reportable, and a report is tied to the exact item rather than to a general inbox.'));
  rep.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => openReportError() }, 'Open the report form'));
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
   timestamp id would. */
function nextCaseId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const n = (State.corrections || []).filter(c => String(c.id || '').includes(stamp)).length + 1;
  return `QT-${stamp}-${String(n).padStart(3, '0')}`;
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
  const file = el('input', { class: 'input', type: 'file', accept: '.json,application/json', style: 'margin-bottom:var(--md)' });
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
    const c = {
      id: nextCaseId(),
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      route: location.pathname + location.search,
      status: 'recorded — not sent',
      modelVersion: MODEL_VERSION, asOf: AS_OF,
      /* A case is evidence. Recording the sample counts against it because the
         audited set had not landed yet would file a case that misdescribes the
         build it was raised against. */
      coverage: k.resolved
        ? `${k.total} companies, ${k.filed} filed, ${k.illustrative} illustrative`
        : 'coverage not resolved when this case was recorded',
      ...state,
    };
    State.corrections = [c, ...(State.corrections || [])].slice(0, 100);
    saveCorrections();
    closeDrawer();
    openDrawer(`Case ${c.id} recorded`, (() => {
      const w = el('div');
      w.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
        `Recorded in this browser as ${c.id}. Nothing has been sent and nobody has received it — there is no server behind this build, and no contact address is published yet. Copy the case below and keep it, or send it once there is somewhere to send it to.`));
      const pre = el('textarea', { class: 'input', style: 'min-height:200px;font-family:var(--mono,monospace);font-size:12px' });
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
    render();
  } }, 'Record this case'));
  openDrawer('Report a data error', body);
}

