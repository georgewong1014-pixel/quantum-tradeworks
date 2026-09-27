/* ==========================================================================
   VIEW — HOME
   ========================================================================== */

/* One provenance per aggregate. The US card cap-weighted PGR, an illustrative
   company on a synthetic price and market cap, together with four filers on
   supplied closes, and printed the blend as one move: neither a real figure
   nor a labelled sample. Where a market has filed companies with a close, the
   aggregate is over those alone; otherwise it is over the illustrative set,
   and the card says which it is. */
function marketSummary(mkt) {
  const priced = U.filter(r => r.c.mkt === mkt && isNum(r.m.mcap) && isNum(r.c.px?.d1));
  const filedRows = priced.filter(r => r.c.real);
  const filed = filedRows.length > 0;
  const rows = filed ? filedRows : priced;
  const capTotal = sum(rows.map(r => r.m.mcap));
  const wChg = capTotal > 0 ? sum(rows.map(r => r.c.px.d1 * r.m.mcap)) / capTotal : null;
  const advancers = rows.filter(r => r.c.px.d1 > 0).length;
  const asOf = [...new Set(rows.map(r => priceAsOfLabel(r.c)))];
  return { rows, capTotal, wChg, advancers, total: rows.length, filed, asOf, leftOut: priced.length - rows.length };
}

VIEWS.home = () => {
  const wrap = el('div');

  /* -- header ------------------------------------------------------------ */
  const hd = el('div', { class: 'page-hd' });
  const hl = el('div');
  hl.append(el('p', { class: 'eyebrow' }, 'Research queue'));
  hl.append(el('h1', {}, 'Research the company. Reach your own conclusion.'));
  hl.append(el('p', { class: 'body-lg', style: 'margin-top:8px' },
    'Research, not recommendations. Everything below is derived from the statement lines held for each company — audited filings for the SEC-filed set, illustrative figures for the Malaysian one, and each page says which. No figure is asserted without the inputs behind it, and nothing here tells you what to do with it. Open any number to see its formula, period and coverage.'));
  hd.append(hl);
  const hr = el('div', { class: 'row', style: 'gap:8px' });
  hr.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('discover', { tab: 'screener' }), html: `${icon('filter')} Open screener` }));
  hr.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openDashboardCustomiser(), html: `${icon('grid')} Customise` }));
  hr.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => go('discover', { tab: 'radar' }), html: `${icon('target')} Quality vs Value Map` }));
  hd.append(hr);
  wrap.append(hd);

  /* First-run orientation. The root URL drops a visitor inside the application,
     so this band answers "what is this, what is it not, where do I start"
     before they meet a dashboard of someone else's watchlist. Dismissible, and
     the dismissal sticks. */
  if (!store.read('introDismissed', false)) {
    const intro = el('div', { class: 'card', style: 'margin-bottom:var(--lg);border-left:3px solid var(--brand)' });
    const top = el('div', { class: 'row row-wrap', style: 'gap:var(--md);align-items:flex-start' });
    const txt = el('div', { style: 'flex:1 1 420px;min-width:0' });
    txt.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' }, [
      el('span', { class: 'chip chip-brand' }, 'New here?'),
      el('h3', { class: 'h-card' }, 'What this is, in three lines'),
    ]));
    const ul = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
    ['A research subscription for US and Bursa Malaysia equities, plus a calculator that turns a Malaysian property into a financial model.',
     'Every number shows the formula, the period and the coverage behind it — and says so plainly when it does not know.',
     'It gives you analysis, not answers: no buy or sell ratings, no target prices, no recommendations.'
    ].forEach(x => ul.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
    txt.append(ul);
    top.append(txt);
    top.append(el('button', { class: 'iconbtn', 'aria-label': 'Dismiss introduction',
      onclick: () => { store.write('introDismissed', true); render(); },
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>` }));
    intro.append(top);
    const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
    acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => openResearch('MAYBANK') }, 'Start with a company'));
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('property') }, 'Model a property'));
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { State.learnTab = 'dictionary'; go('learn'); } }, 'How it works'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => go('plans') }, 'Plans'));
    intro.append(acts);
    wrap.append(intro);
  }

  /* -- market context ---------------------------------------------------- */
  const ctx = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--lg)' });
  ['US', 'MY'].forEach(mkt => {
    const s = marketSummary(mkt);
    const card = el('div', { class: 'card' });
    const top = el('div', { class: 'row', style: 'margin-bottom:8px' });
    top.append(marketChip(mkt));
    top.append(el('span', { class: 'caption' }, s.filed ? 'Filed companies' : 'Illustrative sample'));
    card.append(top);
    card.append(statTile('Cap-weighted move vs previous close', withSign(s.wChg, 2), {
      sub: `${s.advancers} of ${s.total} ${s.filed ? 'filed companies with a supplied close' : 'illustrative companies on sample prices'} advancing${s.asOf.length ? ` · ${s.asOf.join('; ')}` : ''}`,
      tone: !isNum(s.wChg) ? null : s.wChg >= 0 ? '--ok-text' : '--dn-text',
    }));
    if (s.leftOut) card.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
      `${s.leftOut} illustrative ${s.leftOut === 1 ? 'company is' : 'companies are'} left out, so supplied closes and sample prices are not averaged together.`));
    ctx.append(card);
  });

  const fxCard = el('div', { class: 'card' });
  fxCard.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, [el('span', { class: 'chip chip-bronze' }, 'FX'),
    el('span', { class: 'caption' }, 'Cross-market base'),
    FX.source === 'sample' ? null
      : el('span', { class: FX.personal ? 'chip chip-bronze' : 'chip', style: 'margin-left:auto' },
          FX.source === 'named' ? 'official rate'
          : FX.personal ? 'from your screen' : 'from your price file')]));
  /* Four decimals once the rate is real: a cross rate rounded to two loses
     enough precision to move a translated market capitalisation visibly. */
  fxCard.append(statTile('USD / MYR',
    FX.source === 'sample' ? FX.USDMYR.toFixed(2) : FX.USDMYR.toFixed(4),
    { sub: FX.source === 'sample'
        ? `Indicative sample rate · ${FX.asOf || 'no observation date — nobody observed it'}`
        : FX.named
        ? `${FX.named} · ${FX.asOf || 'date not stated'}`
        : `${FX.personal ? 'Read from your screen' : 'From your price file'} · ${FX.asOf || 'date not stated'}` }));
  if (FX.crossChecked) fxCard.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    `Cross-checked against an independent source: ${FX.crossChecked}.`));
  if (fxRejected) fxCard.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--dn-text)' },
    `A USD/MYR rate of ${fxRejected.value} was supplied and refused: ${fxRejected.why}. The sample rate is still in use.`));
  fxCard.append(el('div', { class: 'row', style: 'margin-top:10px;gap:6px' }, [
    el('span', { class: 'caption' }, 'Base currency'),
    el('div', { class: 'segmented', style: 'margin-left:auto' }, ['USD', 'MYR'].map(cc =>
      el('button', { 'aria-selected': State.baseCcy === cc ? 'true' : 'false', onclick: () => { State.baseCcy = cc; store.write('baseCcy', cc); render(); } }, cc))),
  ]));
  ctx.append(fxCard);

  const freshCard = el('div', { class: 'card' });
  /* "All feeds current" was a false claim — there are no feeds. The dataset is
     fixed, so the card says so rather than implying a live pipeline that would
     silently age into a lie. */
  freshCard.append(el('div', { class: 'row', style: 'margin-bottom:8px' },
    [sevChip('info', U.some(r => r.c.real) ? 'Filed and illustrative' : 'Illustrative set'), el('span', { class: 'caption' }, 'Freshness')]));
  /* Two dates, because there are two sources: the filed set carries the day
     it was retrieved from EDGAR, the illustrative set its fixed stamp. One
     "data as of" for both dated audited figures a week before they were
     fetched. */
  const filedDate = U.find(r => r.c.real && r.c.retrieved)?.c.retrieved;
  freshCard.append(statTile('Data as of', filedDate ? `Filed ${filedDate}` : AS_OF,
    { sub: `${filedDate ? `Illustrative set ${AS_OF} · ` : ''}${U.length} companies · ${MODEL_VERSION.split('·')[0].trim()}` }));
  freshCard.append(el('div', { class: 'metaline', style: 'margin-top:10px' },
    `This date does not advance — nothing here is fed by a live source. Median coverage ${Math.round(U.map(r => r.m.coverage).sort((a, b) => a - b)[Math.floor(U.length / 2)])}%.`));

  /* Real-data switch. Loading SEC filings alongside the sample set is the
     clearest way to show what the engine does on audited numbers — and what
     stops working without a licensed price feed. */
  const realOn = realEnabled();
  const realRow = el('div', { class: 'row', style: 'gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--grid)' });
  const lab = el('label', { class: 'checkline', style: 'gap:8px' });
  lab.append(el('input', { type: 'checkbox', checked: realOn ? '' : null,
    onchange: e => {
      store.write('realData', e.target.checked);
      location.href = e.target.checked ? '?real=1' : '?real=0';
    } }));
  lab.append(el('span', {}, 'Load SEC-filed companies'));
  realRow.append(lab);
  freshCard.append(realRow);
  if (realOn) {
    /* SEC filers only — personal-research statements are real but not EDGAR's. */
    const n = U.filter(r => r.c.real && !r.c.personal).length;
    const unreadable = realStatus?.priceSource?.unreadable
      ? ` ${realStatus.priceSource.unreadable} of the ${realStatus.priceSource.count ?? 'listed'} entries in ${realStatus.priceSource.file} carry no readable close and were skipped.` : '';
    freshCard.append(el('div', { class: 'metaline', style: 'margin-top:4px' },
      realStatus === null ? 'Loading filings from SEC EDGAR…'
      : realStatus.ok ? `${n} companies loaded from SEC EDGAR. Statements are audited and real. `
          + (realStatus.broken?.length ? `${realStatus.broken.length} could not be built and were skipped (${realStatus.broken.map(b => b.id).join(', ')}). ` : '')
          + (realStatus.priced
              ? (realStatus.priceSource?.personal
                  ? `${realStatus.priced} carry closes you recognised from your own screen (${realStatus.priceSource.file}). Personal research only — these are not licensed market data and must not be redistributed.`
                  : `${realStatus.priced} carry end-of-day prices from data/prices.json${realStatus.priceSource?.licence ? ` (${realStatus.priceSource.licence})` : ' — licence not stated'}.`) + unreadable
              : realStatus.priceSource
              ? `${realStatus.priceSource.file} was read but attached no price to any company, so price-derived measures are unavailable.${unreadable}`
              : 'No price file supplied, so price-derived measures are unavailable.')
      : `Could not load filings: ${realStatus.error}`));
  }
  ctx.append(freshCard);
  if (dashOf('context').visible) wrap.append(ctx);

  /* -- main split -------------------------------------------------------- */
  /* Column widths live in the stylesheet, not inline — an inline
     grid-template-columns would outrank the responsive media query. */
  const split = el('div', { class: 'grid home-split' });

  /* change feed, restricted to the user's watchlist first */
  const feedCard = el('div', { class: 'card' });
  const onList = FEED.filter(f => State.watchlist.includes(f.id));
  const offList = FEED.filter(f => !State.watchlist.includes(f.id));
  const ordered = [...onList, ...offList].slice(0, 9);
  feedCard.append(cardHead('What changed', 'Fundamental, valuation and risk events computed from the reported data. Price-only moves are labelled as such.',
    el('span', { class: 'chip' }, `${ordered.length} of ${FEED.length}`)));
  const list = el('div', { class: 'notelist', style: 'display:flex;flex-direction:column;gap:8px' });
  ordered.forEach(f => {
    const s = SEV_STYLE[f.sev] || SEV_STYLE.info;
    const item = el('div', { class: 'noteitem' });
    item.append(el('span', { class: 'ni-icon', style: `background:color-mix(in srgb, var(${s.v}) 15%, transparent);color:var(${s.v})`, html: icon(s.icon, 13) }));
    const body = el('div', { style: 'min-width:0;flex:1' });
    const t = el('div', { class: 'row row-wrap', style: 'gap:6px' });
    t.append(el('span', { style: 'font-size:13px;font-weight:600;color:var(--ink)' }, f.title));
    if (State.watchlist.includes(f.id)) t.append(el('span', { class: 'chip chip-brand' }, 'Watchlist'));
    body.append(t);
    body.append(el('p', { class: 'caption', style: 'margin-top:2px' }, f.detail));
    const acts = el('div', { class: 'row', style: 'gap:4px;margin-top:6px' });
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(f.id) }, 'Open research'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(f.id, 'valuation') }, 'Valuation'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => addToThesis(f.id) }, 'Add to thesis'));
    body.append(acts);
    item.append(body);
    list.append(item);
  });
  feedCard.append(list);
  /* cards are placed by the saved dashboard configuration */
  const mainCol = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md);min-width:0' });

  /* right rail */
  const rail = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  const wl = el('div', { class: 'card' });
  const wlHead = el('div', { class: 'card-hd card-hd-tight' });
  const wlSel = el('select', { class: 'select', style: 'width:auto;max-width:190px;height:30px;font-size:13px',
    'aria-label': 'Active watchlist',
    onchange: e => { State.wlIdx = +e.target.value; render(); } });
  State.watchlists.forEach((w, i) => wlSel.append(el('option', { value: i, selected: i === State.wlIdx ? '' : null },
    `${w.name} (${w.ids.length})`)));
  wlHead.append(wlSel);
  wlHead.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openWatchlistManager(), html: `${icon('grid', 13)} Manage` }));
  wl.append(wlHead);
  const wlRows = State.watchlist.map(id => BY_ID.get(id)).filter(Boolean);
  if (!wlRows.length) wl.append(emptyState('No companies on the watchlist yet.'));
  else {
    const t = el('div', { style: 'display:flex;flex-direction:column' });
    wlRows.forEach((r, i) => {
      const row = el('button', { class: 'row', style: `width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;gap:10px;${i ? 'border-top:1px solid var(--grid)' : ''}`,
        onclick: () => openResearch(r.c.id) });
      const nm = el('div', { style: 'min-width:0;flex:1' });
      nm.append(el('div', { class: 'row', style: 'gap:6px;font-size:13px;font-weight:600' }, [r.c.tk, illusChip(r.c)]));
      nm.append(el('div', { class: 'metaline', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px' }, r.c.name));
      row.append(nm);
      row.append(sparkline(priceHistory(r.c)));
      const pv = el('div', { style: 'text-align:right' });
      pv.append(el('div', { class: 'num', style: 'font-size:13px;font-weight:600' }, fmtMoney(r.c.px.p, r.c.ccy)));
      pv.append(el('div', { class: 'metaline ' + signClass(r.c.px.d1) }, withSign(r.c.px.d1, 2)));
      row.append(pv);
      t.append(row);
    });
    wl.append(t);
  }
  const CARDS = { feed: feedCard, watchlist: wl };

  const disc = el('div', { class: 'card' });
  disc.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' },
    'A large difference indicates model sensitivity or disagreement. It is not a recommendation.'));
  disc.append(cardHead('Largest differences between market price and model estimate',
    'An arithmetic sort of the universe by the distance between price and the modelled base case, restricted to Medium confidence or better. A sort, not a selection — the order carries no view about which company is worth owning.'));
  const top = U.filter(r => r.val.mos && r.val.confBand !== 'Low').sort((a, b) => b.val.mos.base - a.val.mos.base).slice(0, 5);
  const dl = el('div', { style: 'display:flex;flex-direction:column' });
  top.forEach((r, i) => {
    const row = el('button', { class: 'row', style: `width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;gap:10px;${i ? 'border-top:1px solid var(--grid)' : ''}`,
      onclick: () => openResearch(r.c.id, 'valuation') });
    const nm = el('div', { style: 'min-width:0;flex:1' });
    nm.append(el('div', { class: 'row', style: 'gap:6px' }, [el('span', { style: 'font-size:13px;font-weight:600' }, r.c.tk), illusChip(r.c), marketChip(r.c.mkt)]));
    nm.append(el('div', { class: 'metaline' }, `${r.val.pack.name} · ${r.val.confBand} confidence`));
    row.append(nm);
    row.append(el('div', { class: 'num pos', style: 'font-size:13px;font-weight:700' }, withSign(r.val.mos.base, 0)));
    dl.append(row);
  });
  disc.append(dl);
  disc.append(el('p', { class: 'metaline', style: 'margin-top:10px' }, 'Sorted by modelled gap, not by conviction. A large gap usually means the model and the market disagree — which is a reason to read the company, not a reason to act.'));
  CARDS.discounts = disc;

  /* research loop */
  const loop = el('div', { class: 'card' });
  loop.append(cardHead('The research loop', 'Each pass leaves evidence behind, so the next one starts further along.'));
  const steps = [['Discover candidates', 'discover'], ['Inspect evidence', 'research'], ['Build a valuation range', 'research'], ['Save a thesis', 'thesis'], ['Monitor changes', 'alerts'], ['Review decision quality', 'thesis']];
  const ol = el('ol', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:2px' });
  steps.forEach(([label, target], i) => {
    /* tap-row: one line of 13px text in 7px padding is a 34px target, six of
       them stacked 2px apart — the 44px floor comes from the stylesheet on a
       phone, where a fingertip is what presses them. */
    ol.append(el('li', {}, el('button', {
      class: 'row tap-row', style:'width:100%;gap:10px;background:none;border:0;cursor:pointer;padding:7px 0;text-align:left',
      onclick: () => go(target) }, [
      el('span', { style: 'width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--brand-wash);color:var(--brand)' }, String(i + 1)),
      el('span', { style: 'font-size:13px;color:var(--ink-2)' }, label),
    ])));
  });
  loop.append(ol);
  CARDS.loop = loop;
  dashOrder('main').forEach(d => CARDS[d.k] && mainCol.append(CARDS[d.k]));
  dashOrder('rail').forEach(d => CARDS[d.k] && rail.append(CARDS[d.k]));
  if (mainCol.children.length) split.append(mainCol);

  split.append(rail);
  wrap.append(split);
  return wrap;
};

/* --------------------------------------------------- dashboard customising */
const DASH_CARDS = [
  { k:'context',   label:'Market context strip', col:'top'  },
  { k:'feed',      label:'What changed',         col:'main' },
  { k:'watchlist', label:'Watchlist',            col:'rail' },
  { k:'discounts', label:'Largest differences between price and model estimate', col:'rail' },
  { k:'loop',      label:'The research loop',    col:'rail' },
];
State.dash = store.read('dash', null) || DASH_CARDS.map(c => ({ k: c.k, col: c.col, visible: true }));
const saveDash = () => store.write('dash', State.dash);
const dashOf = (k) => State.dash.find(d => d.k === k) || { visible: true, col: DASH_CARDS.find(c => c.k === k)?.col };
const dashOrder = (col) => State.dash.filter(d => d.col === col && d.visible);

function openDashboardCustomiser() {
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    'Reorder the home dashboard, move a card between the main column and the side rail, or hide it. Saved in this browser.'));
  const list = el('div');
  State.dash.forEach((d, i) => {
    const meta = DASH_CARDS.find(c => c.k === d.k);
    const row = el('div', { class: 'row row-wrap', style: `gap:8px;padding:9px 0;${i ? 'border-top:1px solid var(--grid)' : ''}` });
    const lab = el('label', { class: 'checkline', style: 'flex:1 1 170px' });
    lab.append(el('input', { type: 'checkbox', checked: d.visible ? '' : null,
      onchange: e => { d.visible = e.target.checked; saveDash(); render(); } }));
    lab.append(el('span', {}, meta?.label || d.k));
    row.append(lab);
    if (d.k !== 'context') {
      const cs = el('select', { class: 'select input-inline', style: 'width:96px', 'aria-label': `Column for ${meta?.label}`,
        onchange: e => { d.col = e.target.value; saveDash(); render(); } });
      [['main', 'Main'], ['rail', 'Side rail']].forEach(([v, l]) =>
        cs.append(el('option', { value: v, selected: d.col === v ? '' : null }, l)));
      row.append(cs);
    }
    row.append(el('button', { class: 'btn btn-quiet btn-sm', disabled: i === 0 ? '' : null, 'aria-label': 'Move up',
      onclick: () => { const a = State.dash; [a[i - 1], a[i]] = [a[i], a[i - 1]]; saveDash(); closeDrawer(); render(); openDashboardCustomiser(); } }, '↑'));
    row.append(el('button', { class: 'btn btn-quiet btn-sm', disabled: i === State.dash.length - 1 ? '' : null, 'aria-label': 'Move down',
      onclick: () => { const a = State.dash; [a[i + 1], a[i]] = [a[i], a[i + 1]]; saveDash(); closeDrawer(); render(); openDashboardCustomiser(); } }, '↓'));
    list.append(row);
  });
  body.append(list);
  body.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--md)', onclick: () => {
    State.dash = DASH_CARDS.map(c => ({ k: c.k, col: c.col, visible: true }));
    saveDash(); closeDrawer(); render(); toast('Dashboard reset');
  } }, 'Reset to default'));
  openDrawer('Customise dashboard', body);
}

/* ==========================================================================
   VIEW — DISCOVER
   ========================================================================== */

const DISCOVER_TABS = [
  { id:'screener', label:'Stock Screener' },
  { id:'radar',    label:'Quality vs Value Map' },
  { id:'ideas',    label:'Screening Strategies' },
  { id:'heatmap',  label:'Heatmap' },
];

/* --------------------------------------------------------------- screener */
/* Every field publishes its formula, period and missing-data behaviour. */
const FIELDS = [
  { g:'Business quality',      k:'roic',      label:'Return on invested capital', fmt:v=>fmtPct(v),   formula:'EBIT × (1 − tax rate) ÷ (equity + debt − cash)', miss:'Not meaningful for banks — excluded rather than imputed.' },
  { g:'Business quality',      k:'om',        label:'Operating margin',           fmt:v=>fmtPct(v),   formula:'EBIT ÷ revenue' },
  { g:'Business quality',      k:'fcfm',      label:'Free cash flow margin',      fmt:v=>fmtPct(v),   formula:'(operating cash flow − capex) ÷ revenue', miss:'Not computed for banks.' },
  { g:'Business quality',      k:'roe',       label:'Return on equity',           fmt:v=>fmtPct(v),   formula:'net income ÷ average shareholders’ equity' },
  { g:'Business quality',      k:'cashconv',  label:'Cash conversion',            fmt:v=>fmtPct(v,0), formula:'operating cash flow ÷ net income' },
  { g:'Growth and profitability', k:'rev5',      label:'Revenue CAGR (4y)',          fmt:v=>fmtPct(v),   formula:'(latest ÷ earliest)^(1/n) − 1', miss:'Null when the base period is non-positive.' },
  { g:'Growth and profitability', k:'eps5',      label:'Earnings CAGR (4y)',         fmt:v=>fmtPct(v),   formula:'compound growth of earnings per share' },
  { g:'Growth and profitability', k:'fcf5',      label:'Free cash flow CAGR (4y)',   fmt:v=>fmtPct(v),   formula:'compound growth of free cash flow' },
  { g:'Growth and profitability', k:'dps5',      label:'Dividend CAGR (4y)',         fmt:v=>fmtPct(v),   formula:'compound growth of dividend per share' },
  { g:'Financial risk',        k:'ndEbit',    label:'Net debt / EBIT',            fmt:v=>fmtX(v),     formula:'(debt − cash) ÷ EBIT', miss:'Not applicable to banks.' },
  { g:'Financial risk',        k:'de',        label:'Debt / equity',              fmt:v=>fmtX(v,2),   formula:'total debt ÷ shareholders’ equity' },
  { g:'Financial risk',        k:'icov',      label:'Interest cover',             fmt:v=>fmtX(v),     formula:'EBIT ÷ net interest expense', miss:'Interest expense is not carried in the statement tuple, filed or illustrative — reported missing, never estimated.' },
  { g:'Valuation and income',  k:'pe',        label:'Price / earnings',           fmt:v=>fmtX(v),     formula:'price ÷ earnings per share', miss:'Null when earnings are negative.' },
  { g:'Valuation and income',  k:'pb',        label:'Price / book',               fmt:v=>fmtX(v,2),   formula:'price ÷ book value per share' },
  { g:'Valuation and income',  k:'evebit',    label:'EV / EBIT',                  fmt:v=>fmtX(v),     formula:'(market cap + net debt) ÷ EBIT', miss:'Enterprise value is not meaningful for banks.' },
  { g:'Valuation and income',  k:'pfcf',      label:'Price / free cash flow',     fmt:v=>fmtX(v),     formula:'price ÷ free cash flow per share' },
  { g:'Valuation and income',  k:'dy',        label:'Dividend yield',             fmt:v=>fmtPct(v,2), formula:'dividend per share ÷ price' },
  { g:'Valuation and income',  k:'fcfy',      label:'Free cash flow yield',       fmt:v=>fmtPct(v,2), formula:'free cash flow ÷ market capitalisation' },
  { g:'Valuation and income',  k:'buyback', label:'Net buyback yield',        fmt:v=>fmtPct(v,2), formula:'negative of the share-count CAGR' },
  { g:'Valuation and income',  k:'payout',  label:'Payout ratio',             fmt:v=>fmtPct(v,0), formula:'dividend per share ÷ earnings per share' },
  { g:'Valuation and income',  k:'cashPayout', label:'Dividend as % of FCF',  fmt:v=>fmtPct(v,0), formula:'total dividends paid ÷ free cash flow' },
  { g:'Valuation and income',  k:'reinv',   label:'Reinvestment rate',        fmt:v=>fmtPct(v,0), formula:'capex ÷ operating cash flow' },
  { g:'Financial risk',        k:'epsVol',    label:'Earnings variability',       fmt:v=>fmtNum(v),   formula:'standard deviation of year-on-year net income growth' },
  { g:'Financial risk',        k:'revDD',     label:'Revenue drawdown',           fmt:v=>fmtPct(v,0), formula:'largest peak-to-trough fall in revenue' },
  { g:'Financial risk',        k:'dilution',  label:'Share count growth',         fmt:v=>fmtPct(v,2), formula:'CAGR of shares in issue' },
  { g:'Financial risk',        k:'netGearing',label:'Net gearing',                fmt:v=>fmtPct(v,0), formula:'(total debt − cash) ÷ shareholders’ equity', miss:'Not applicable to a bank balance sheet.', note:'Cash here is cash and equivalents only. A company holding short-term investments will look more indebted than it is.' },
  { g:'Financial risk',        k:'ocfPosYears',label:'Years of positive operating cash flow', fmt:(v, r)=>`${fmtNum(v,0)} of ${r?.m?.ocfYearsSeen ?? 5}`, formula:'count of the reported years, up to the last five, with operating cash flow above zero' },
  { g:'Market and eligibility',k:'rs12',      label:'12-month price change',      fmt:v=>fmtPct(v),   formula:'price change over the trailing twelve months' },
  { g:'Market and eligibility',k:'from52',    label:'Distance from 52-week high', fmt:v=>fmtPct(v),   formula:'(price − 52-week high) ÷ 52-week high' },
  { g:'Market and eligibility',k:'sma200d',   label:'Distance from 200-day average', fmt:v=>fmtPct(v), formula:'(price − 200-day simple moving average) ÷ 200-day average', note:'Needs 200 observed closes. Computed from imported or captured history only.' },
  { g:'Composite scores',      k:'qscore',     label:'Business quality score',     fmt:v=>fmtNum(v,0), formula:'weighted pillar score, 0–100' },
  { g:'Composite scores',      k:'vscore',     label:'Valuation evidence score',   fmt:v=>fmtNum(v,0), formula:'weighted valuation score, 0–100' },
  { g:'Composite scores',      k:'mosBase',    label:'Difference to base-case model', fmt:v=>fmtPct(v,0), formula:'(base-case model estimate − price) ÷ price' },
  /* The only field here denominated in money. Every other column is a ratio, a
     multiple or a percentage, and therefore reads the same whichever currency
     the company reports in. Flagged so the screener can convert and label this
     one rather than printing a Bursa figure in ringgit beside a US figure in
     dollars as though they were the same unit.

     Formatted in the company's own currency when the row is known. A bare
     fmtNum printed "131.2" in the source drawer beside a cell reading
     "$29.7B" — the same quantity twice, with no unit on either side to say
     that one is billions of ringgit and the other billions of dollars. */
  { g:'Market and eligibility',k:'mcap',      label:'Market capitalisation',      fmt:(v, r)=>r?.c ? fmtCap(v, r.c.ccy) : `${fmtNum(v,1)}bn`, formula:'price × shares in issue', money:true },
];
const FIELD_BY_K = Object.fromEntries(FIELDS.map(f => [f.k, f]));
const FIELD_GROUPS = [...new Set(FIELDS.map(f => f.g))];
/* The screener's three fixed score columns carry their own keys and their own
   pill renderers. This maps them to the fields behind them, so an absent score
   says why and a present one opens its drawer like any other cell. */
const SCORE_COL_FIELD = { quality: 'qscore', value: 'vscore', mos: 'mosBase' };

/* COLUMN PRESETS.
   ---------------------------------------------------------------------------
   Thirty-six fields, eight columns allowed, and the only way back from a wide
   unreadable table was to untick metrics one at a time in a drawer. A reader
   who widens the table to answer one question then has to dismantle it by hand
   before they can read anything else, so in practice they stop widening it.

   Every preset is DESCRIPTIVE — a named group of measures, not a ranking and
   not a shortlist. None of them selects companies, orders them or implies that
   one set of metrics is the one to judge by; they choose which columns are on
   screen and nothing else. "Essentials" is the default set the screener opens
   with, so it is also the way back. */
const COL_PRESETS = [
  { id:'essentials', label:'Essentials',
    cols:['roic', 'om', 'pe', 'dy', 'fcfy', 'ndEbit'],
    why:'The set the screener opens with — one measure from each group.' },
  { id:'quality', label:'Business quality',
    cols:['roic', 'om', 'fcfm', 'roe', 'cashconv'],
    why:'How much the business earns on what it employs, and whether earnings arrive as cash.' },
  { id:'risk', label:'Financial risk',
    cols:['ndEbit', 'de', 'icov', 'netGearing', 'ocfPosYears'],
    why:'What is owed, against what services it.' },
  { id:'valuation', label:'Valuation and income',
    cols:['pe', 'pb', 'evebit', 'dy', 'fcfy', 'payout'],
    why:'What the price is against earnings, book, cash and the dividend.' },
  { id:'growth', label:'Growth',
    cols:['rev5', 'eps5', 'fcf5', 'dps5'],
    why:'Four-year compound growth of the four lines that carry it.' },
];
const samePreset = (cols, p) =>
  cols.length === p.cols.length && p.cols.every(k => cols.includes(k));

/* Sector-specific measures are not general screener fields, but thesis
   conditions and alerts still need to render them with their units. */
const SECTOR_FMT = {
  npl: v => fmtPct(v, 2), cet1: v => fmtPct(v, 1), nim: v => fmtPct(v, 2), cir: v => fmtPct(v, 1),
  casa: v => fmtPct(v, 1), ldr: v => fmtPct(v, 1), occ: v => fmtPct(v, 1), gearing: v => fmtPct(v, 1),
  cap: v => fmtPct(v, 1), wale: v => `${fmtNum(v, 1)} yrs`, dpuCover: v => fmtPct(v, 0), pnav: v => fmtX(v, 2),
};
const fmtFor = (k) => FIELD_BY_K[k]?.fmt || SECTOR_FMT[k] || ((v) => fmtNum(v, 2));

function blankScreen() {
  return { universe:'all', sectors:[], types:[], mode:'abs', minCoverage:60,
           crit:{}, local:{ shariahOnly:false, excludePn17:true, klciOnly:false },
           cols:['roic','om','pe','dy','fcfy','ndEbit'], sort:{ k:'quality', dir:-1 } };
}
State.screen = State.screen || blankScreen();
State.density = store.read('density', 'comfortable');
State.compareCcy = store.read('compareCcy', 'common');
State.dividendsReceived = store.read('dividendsReceived', []);
State.requiredDiscount = store.read('requiredDiscount', null);

/* ==========================================================================
   SCREEN TEMPLATES

   Starting points, not selections. Each one loads into the screener as an
   ordinary set of thresholds you can then change — nothing is hidden behind a
   name, and the name says what the screen tests rather than what the result
   is worth. None is called "best", "top picks" or "buy now", because a screen
   is a filter and calling its output a pick is the exact move this product
   exists not to make.
   ========================================================================== */
const SCREEN_TEMPLATES = [
  /* Section 18.1 of the migration specification, published under its own
     identifier and version so a saved screen can be traced back to the rule set
     it came from.

     Four of its five rules are testable here. The fifth — no critical
     governance flag — has no data behind it, because the governance register in
     section 8 does not exist yet. Section 4.1 is explicit about what that means:
     a hard gate whose input is missing produces manual review, never a pass. So
     the rule is carried on the screen, shown to the reader, and excluded from
     the filter rather than quietly dropped. A screen that tests four rules and
     claims five is the failure this product exists to avoid. */
  { id:'my_quality_reasonable_value_v1', name:'Quality at reasonable valuation', version:'1.0.0',
    spec:'section 18.1',
    why:'Business quality of 80 or better, valuation evidence of 60 or better, and a price at least 20% below the base-case model estimate — on companies with at least 80% data completeness.',
    untestable:[{ rule:'governance_critical_flags == 0',
      because:'No governance event register exists in this build, so the flag cannot be evaluated. Under section 4.1 an untested hard gate is manual review, not a pass — check governance yourself before treating a match as complete.' }],
    apply: (s) => { s.minCoverage = 80;
      s.crit = { qscore:{min:80}, vscore:{min:60}, mosBase:{min:20} };
      s.cols = ['qscore','vscore','mosBase','roic','ndEbit','dy']; } },

  { id:'div-cover', name:'Dividend cash coverage',
    why:'Companies paying a dividend that free cash flow actually covers, rather than one funded from the balance sheet.',
    apply: (s) => { s.crit = { dy:{min:3}, cashPayout:{max:80}, fcfy:{min:0} }; s.cols = ['dy','cashPayout','fcfy','payout','ndEbit','roe']; } },
  { id:'consistent', name:'Consistent profitability',
    why:'A steady operating record rather than one good year — low earnings variability and no deep revenue drawdown.',
    apply: (s) => { s.crit = { om:{min:8}, epsVol:{max:25}, revDD:{max:20} }; s.cols = ['om','epsVol','revDD','roic','rev5','fcfm']; } },
  { id:'conservative', name:'Conservative balance sheet',
    why:'Low borrowings against operating profit, with interest comfortably covered.',
    apply: (s) => { s.crit = { ndEbit:{max:1.5}, de:{max:0.6}, icov:{min:6} }; s.cols = ['ndEbit','de','icov','roic','om','fcfy']; } },
  { id:'my-banks', name:'Malaysian banks',
    why:'Bursa-listed deposit takers, shown on the measures that fit a bank balance sheet rather than on free cash flow.',
    apply: (s) => { s.universe='MY'; s.types=['bank']; s.crit = { roe:{min:8} }; s.cols = ['roe','pb','dy','payout','eps5','pe']; } },
  { id:'my-reits', name:'Malaysian REITs',
    why:'Bursa-listed property trusts, on distribution and gearing rather than earnings multiples.',
    apply: (s) => { s.universe='MY'; s.types=['reit']; s.crit = { dy:{min:4} }; s.cols = ['dy','pb','payout','de','dps5','pe']; } },
  { id:'plantation', name:'Plantation cycle watch',
    why:'Palm oil and agriculture, where margin swings with the commodity. Read the drawdown and the balance sheet before the multiple.',
    apply: (s) => { s.universe='MY'; s.sectors=['Consumer Staples','Materials']; s.crit = { revDD:{min:10}, ndEbit:{max:3} }; s.cols = ['om','revDD','ndEbit','roic','pe','dy']; } },
  { id:'infra', name:'Construction and infrastructure',
    why:'Contract-driven businesses, where order-book visibility and gearing matter more than a single year of earnings.',
    apply: (s) => { s.universe='MY'; s.sectors=['Industrials','Utilities']; s.crit = { ndEbit:{max:4}, icov:{min:3} }; s.cols = ['ndEbit','icov','om','rev5','roic','pe']; } },
  { id:'shariah', name:'Shariah-compliant universe',
    why:'Only companies flagged Shariah-compliant in this dataset. The flag is carried from the source, not assessed here.',
    apply: (s) => { s.universe='MY'; s.local = { ...s.local, shariahOnly:true }; s.cols = ['roic','om','ndEbit','dy','pe','fcfy']; } },
  { id:'no-pn17', name:'Excluding PN17 and GN3',
    why:'Removes companies under Bursa financial-distress classifications. This is an exclusion, not an endorsement of what remains.',
    apply: (s) => { s.universe='MY'; s.local = { ...s.local, excludePn17:true }; s.cols = ['roic','ndEbit','icov','om','dy','pe']; } },
];

function applyTemplate(t) {
  const s = blankScreen();
  t.apply(s);
  State.screen = s;
  State.appliedTemplate = t.id;
  render();
}

/* Whether the screen on the page is still the one a template produced. The
   section 18.1 banner — "matches below satisfy the rules that could be
   tested" — survived Reset, Clear all and every edited threshold, so it went
   on describing a screen that no longer had the template's rules. Rather than
   remembering to clear the flag in every handler that can change a criterion,
   the screen is compared with the template's own output: the same universe,
   filters, completeness floor and thresholds, or it is not that template.
   Columns and sort are presentation and do not count. */
function screenCriteriaKey(s) {
  const crit = Object.entries(s.crit || {})
    .filter(([, c]) => c && (c.min != null || c.max != null))
    .map(([k, c]) => [k, c.min ?? null, c.max ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return JSON.stringify([s.universe, [...(s.sectors || [])].sort(), [...(s.types || [])].sort(), s.mode,
    s.minCoverage, s.local?.shariahOnly, s.local?.excludePn17, s.local?.klciOnly, crit]);
}
function templateStillApplies(sc) {
  const t = SCREEN_TEMPLATES.find(x => x.id === State.appliedTemplate);
  if (!t) return null;
  const s = blankScreen();
  t.apply(s);
  return screenCriteriaKey(s) === screenCriteriaKey(sc) ? t : null;
}

/* Returns { pass, fails:[reason] } for one company — the "explain exclusion" data. */
function evaluateScreen(row, sc) {
  const fails = [];
  const { c, m } = row;
  if (sc.universe === 'US' && c.mkt !== 'US') fails.push('Not in the US universe');
  if (sc.universe === 'MY' && c.mkt !== 'MY') fails.push('Not in the Bursa universe');
  if (sc.universe === 'watchlist' && !State.watchlist.includes(c.id)) fails.push('Not on the watchlist');
  if (sc.sectors.length && !sc.sectors.includes(c.sector)) fails.push(`Sector ${c.sector} is not selected`);
  if (sc.types.length && !sc.types.includes(c.type)) fails.push(`Business model "${c.type}" is not selected`);
  if (m.coverage < sc.minCoverage) fails.push(`Data completeness ${m.coverage}% is below the ${sc.minCoverage}% threshold`);
  if (sc.local.shariahOnly && c.flags.shariah !== true) fails.push('Not recorded as Shariah-compliant in this dataset');
  if (sc.local.excludePn17 && c.flags.pn17) fails.push('Classified under PN17');
  if (sc.local.klciOnly && c.flags.idx !== 'FBM KLCI') fails.push('Not an FBM KLCI constituent');

  for (const [k, range] of Object.entries(sc.crit)) {
    if (range.min == null && range.max == null) continue;
    const f = FIELD_BY_K[k];
    const raw = critValue(row, k, sc);
    if (!isNum(raw)) {
      /* Missing data never passes a threshold silently. */
      fails.push(`${f.label} is not available${f.miss ? ' — ' + f.miss.replace(/\.$/, '') : ''}`);
      continue;
    }
    const shown = critFmt(f, raw, sc, row);
    if (range.min != null && raw < range.min) fails.push(`${f.label} ${shown} is below the ${critFmt(f, range.min, sc, row)} minimum`);
    if (range.max != null && raw > range.max) fails.push(`${f.label} ${shown} is above the ${critFmt(f, range.max, sc, row)} maximum`);
  }
  return { pass: fails.length === 0, fails };
}

/* THE CURRENCY A MONEY THRESHOLD IS READ IN.
   The market-cap filter compared m.mcap raw — billions of ringgit for a Bursa
   row, billions of dollars for a US one — while the column beside it showed
   both converted. "Market cap ≥ 100" under "Show money in USD" passed
   Maybank, whose own cell read $29.7B. A money threshold is now read in the
   screen's currency, and under "Local" in each company's own, which the rail
   and the chip then say. A saved screen carries the currency it was saved in,
   so re-running it later does not depend on where the toggle happens to be. */
const screenMoneyCcy = (sc) => sc.moneyCcy || screenCcy();
function critValue(row, k, sc) {
  if (sc.mode === 'pct') return metricPct(row, k, 'market');
  const v = row.m[k], ccy = screenMoneyCcy(sc);
  return FIELD_BY_K[k]?.money && ccy !== 'local' ? convertTo(v, row.c.ccy, ccy) : v;
}
/* How a threshold, or a value tested against one, reads — with the scale it is
   on. The same number is a percentile rank in one mode and a raw value in the
   other, and a chip that read "≥ 50" in both let a mode switch turn a median
   rank into a 50% floor without anything on screen changing. */
function critFmt(f, v, sc, row) {
  if (sc.mode === 'pct') return `${ord(v)} pct`;
  if (f.money) {
    const ccy = screenMoneyCcy(sc);
    if (ccy !== 'local') return fmtCap(v, ccy);
    return row ? fmtCap(v, row.c.ccy) : `${fmtNum(v, 1)}bn in each company’s own currency`;
  }
  return f.fmt(v, row);
}
/* The unit a threshold is typed in, for the rail beside its inputs. */
function critUnit(f, sc) {
  if (sc.mode === 'pct') return 'percentile';
  if (!f.money) return null;
  const ccy = screenMoneyCcy(sc);
  return ccy === 'local' ? 'bn, each company’s own currency' : `bn ${ccy}`;
}

/* Every active filter on a screen, in words, each with the way to remove it.
   The chips above the results and the definition written into an export
   both read from here, so the file cannot describe a different screen from
   the one on the page. */
function activeFilters(sc) {
  const active = [];
  if (sc.universe !== 'all') active.push({ label: `Universe: ${
    { US:'United States', MY:'Bursa Malaysia', watchlist:'Only companies I follow' }[sc.universe] || sc.universe }`,
    clear: () => { sc.universe = 'all'; } });
  if (sc.minCoverage > 0) active.push({ label: `Data completeness ≥ ${sc.minCoverage}%`, clear: () => { sc.minCoverage = 0; } });
  (sc.types || []).forEach(t => active.push({ label: `Type: ${t}`, clear: () => { sc.types = sc.types.filter(x => x !== t); } }));
  (sc.sectors || []).forEach(t => active.push({ label: `Sector: ${t}`, clear: () => { sc.sectors = sc.sectors.filter(x => x !== t); } }));
  Object.entries(sc.crit || {}).forEach(([k, c3]) => {
    if (!c3 || (c3.min == null && c3.max == null)) return;
    const f = FIELD_BY_K[k]; if (!f) return;
    const bits = [c3.min != null ? `≥ ${critFmt(f, c3.min, sc)}` : null, c3.max != null ? `≤ ${critFmt(f, c3.max, sc)}` : null].filter(Boolean).join(' and ');
    active.push({ label: `${f.label} ${bits}`, clear: () => { delete sc.crit[k]; } });
  });
  if (sc.local?.shariahOnly) active.push({ label: 'Shariah-compliant only', clear: () => { sc.local.shariahOnly = false; } });
  if (sc.local?.excludePn17) active.push({ label: 'Excluding PN17 / GN3', clear: () => { sc.local.excludePn17 = false; } });
  if (sc.local?.klciOnly) active.push({ label: 'FBM KLCI constituents only', clear: () => { sc.local.klciOnly = false; } });
  return active;
}

/* The value a results column sorts on, by column key — one definition for the
   table and for the export, so the file comes out in the order on screen. A
   metric that is not among the displayed columns sorts nothing, as in the
   table, where no header exists to sort it by. */
function screenSortGet(k, sc) {
  const fixed = { quality: r => r.scores.quality.score, value: r => r.scores.value.score, mos: r => r.val.mos?.base,
                  risk: r => r.risk.raw, coverage: r => r.m.coverage };
  if (fixed[k]) return fixed[k];
  const f = FIELD_BY_K[k];
  if (!f || !sc.cols.includes(k)) return null;
  const ccy = screenCcy();
  return f.money && ccy !== 'local' ? r => convertTo(r.m[k], r.c.ccy, ccy) : r => r.m[k];
}
function sortScreenRows(rows, sc) {
  const get = screenSortGet(sc.sort.k, sc);
  if (!get) return [...rows];
  return [...rows].sort((a, b) => {
    const av = get(a), bv = get(b);
    if (!isNum(av)) return 1; if (!isNum(bv)) return -1;
    return (av - bv) * sc.sort.dir;
  });
}

/* Re-render and hand focus back to the control that asked for it. render()
   replaces the whole view, so the focused slider, select or checkbox was
   destroyed under the reader: one arrow press moved the completeness slider,
   focus fell to <body>, and the next press did nothing. Controls that re-render
   carry an id, and focus returns to the new element with the same id. */
function renderKeepFocus() {
  const id = document.activeElement?.id;
  render();
  if (id) document.getElementById(id)?.focus({ preventScroll: true });
}

function renderScreener() {
  const sc = State.screen;
  /* A template whose criteria have since been changed is no longer applied —
     its pressed state and its banner go with it. */
  if (State.appliedTemplate && !templateStillApplies(sc)) State.appliedTemplate = null;
  const wrap = el('div', { class: 'screener-layout' });

  /* Absolute and percentile thresholds are different scales. The criteria used
     to survive the switch, so "ROIC min 50" — the median rank — silently became
     a 50% return floor when Absolute was pressed. A switch now clears them and
     says so, rather than reinterpreting numbers the reader typed for another
     scale. */
  const setMode = (mode) => {
    if (sc.mode === mode) return;
    const had = Object.values(sc.crit || {}).some(c => c && (c.min != null || c.max != null));
    sc.mode = mode;
    sc.crit = {};
    if (had) toast(`Thresholds cleared — ${mode === 'pct' ? 'percentile ranks' : 'raw values'} are a different scale from the ones you typed`);
    render();
  };

  /* ---------- filter rail ---------- */
  const rail = el('div', { class: 'card rail-sticky', style: 'padding:0;overflow:hidden' });
  const railHd = el('div', { style: 'padding:var(--md);border-bottom:1px solid var(--line)' });
  railHd.append(el('div', { class: 'row' }, [
    el('h3', { class: 'h-card' }, 'Filters'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { State.screen = blankScreen(); render(); } }, 'Reset'),
  ]));
  railHd.append(el('div', { class: 'segmented', style: 'margin-top:10px;width:100%' }, [
    el('button', { style: 'flex:1', 'aria-selected': sc.mode === 'abs' ? 'true' : 'false', onclick: () => setMode('abs') }, 'Absolute'),
    el('button', { style: 'flex:1', 'aria-selected': sc.mode === 'pct' ? 'true' : 'false',
      title: lim('percentileMode') ? null : 'Peer-percentile screening is part of Equities Research',
      onclick: () => { if (!lim('percentileMode')) { toast('Peer-percentile screening is part of Equities Research'); go('plans'); return; } setMode('pct'); } }, 'Peer percentile'),
  ]));
  railHd.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    sc.mode === 'abs' ? 'Thresholds are raw metric values. Switching mode clears them.' : 'Thresholds are percentile ranks within the same market cohort. Switching mode clears them.'));
  rail.append(railHd);

  /* The filter column was the second of three competing vertical scrollbars.
     It is sticky instead: it follows the reader down the results without
     trapping a wheel, and on a narrow screen where sticky would eat the whole
     viewport it simply flows with the page. */
  const railBody = el('div', { style: 'padding:var(--md)' });

  /* Templates first: a starting point beats an empty form, and each one states
     what it tests rather than what the result is worth. */
  const tpl = el('details', { style: 'margin-bottom:var(--md)' });
  tpl.append(el('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-2);padding:4px 0' },
    'Start from a template'));
  const tplList = el('div', { style: 'display:grid;gap:6px;margin-top:8px' });
  SCREEN_TEMPLATES.forEach(t => {
    const b = el('button', { class: 'ob-option', style: 'padding:9px 11px',
      'aria-pressed': State.appliedTemplate === t.id ? 'true' : 'false',
      onclick: () => applyTemplate(t) });
    b.append(el('div', { class: 'ob-option-t', style: 'font-size:13px' }, t.name));
    b.append(el('div', { class: 'ob-option-n' }, t.why));
    tplList.append(b);
  });
  tpl.append(tplList);
  tpl.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'A template only sets thresholds. Every one is visible above and yours to change.'));
  railBody.append(tpl);

  /* universe */
  const uni = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  uni.append(el('label', { for: 'uniSel' }, 'Universe'));
  const uniSel = el('select', { class: 'select', id: 'uniSel', onchange: e => { sc.universe = e.target.value; renderKeepFocus(); } });
  [['all', `All markets (${U.length})`], ['US', 'United States'], ['MY', 'Bursa Malaysia'], ['watchlist', 'Only companies I follow']]
    .forEach(([v, l]) => uniSel.append(el('option', { value: v, selected: sc.universe === v ? '' : null }, l)));
  uni.append(uniSel);
  railBody.append(uni);

  /* completeness */
  const cov = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  const covLabel = el('label', { for: 'covRange' }, `Minimum data completeness — ${sc.minCoverage}%`);
  cov.append(covLabel);
  /* While the slider moves, only its label follows; the results follow on
     change. Re-rendering on every input event replaced the slider under a
     dragging pointer, so a drag stopped after its first step. */
  cov.append(el('input', { type: 'range', id: 'covRange', min: 0, max: 100, step: 5, value: sc.minCoverage,
    oninput: e => { covLabel.textContent = `Minimum data completeness — ${e.target.value}%`; },
    onchange: e => { sc.minCoverage = +e.target.value; renderKeepFocus(); } }));
  cov.append(el('p', { class: 'metaline' }, 'Stops a company with thin data from passing a screen it was never tested against.'));
  railBody.append(cov);

  /* local (Malaysia) */
  const loc = el('div', { class: 'sunk', style: 'margin-bottom:var(--md)' });
  loc.append(el('div', { class: 'row', style: 'margin-bottom:6px' }, [el('span', { class: 'chip chip-my' }, 'MY'), el('span', { class: 'caption' }, 'Local filters')]));
  [['shariahOnly', 'Shariah-compliant only'], ['excludePn17', 'Exclude PN17 / GN3'], ['klciOnly', 'FBM KLCI constituents only']].forEach(([k, label]) => {
    const lab = el('label', { class: 'checkline' });
    lab.append(el('input', { type: 'checkbox', id: `loc-${k}`, checked: sc.local[k] ? '' : null, onchange: e => { sc.local[k] = e.target.checked; renderKeepFocus(); } }));
    lab.append(el('span', {}, label));
    loc.append(lab);
  });
  railBody.append(loc);

  /* business model */
  const bm = el('div', { style: 'margin-bottom:var(--md)' });
  bm.append(el('label', { class: 'caption', style: 'display:block;margin-bottom:4px;font-weight:600;color:var(--ink-2)' }, 'Business model'));
  const bmRow = el('div', { class: 'row row-wrap', style: 'gap:5px' });
  [...new Set(U.map(r => r.c.type))].forEach(t => {
    const on = sc.types.includes(t);
    bmRow.append(el('button', { class: 'chip' + (on ? ' chip-brand' : ''), style: 'cursor:pointer',
      onclick: () => { sc.types = on ? sc.types.filter(x => x !== t) : [...sc.types, t]; render(); } }, t));
  });
  bm.append(bmRow);
  railBody.append(bm);

  /* Six filters are visible; the rest are behind Advanced. Twenty-six numeric
     thresholds presented at once is a wall, and the six below are the ones that
     answer "is this worth opening" — how well it earns, how much it owes, what
     it costs and what it pays. */
  const PRIMARY = ['roic', 'roe', 'ndEbit', 'pe', 'dy'];
  const primaryFields = FIELDS.filter(f => PRIMARY.includes(f.k));

  const critRow = (f) => {
    const c = sc.crit[f.k] || {};
    const row = el('div', { style: 'display:grid;grid-template-columns:1fr 62px 62px;gap:6px;align-items:center;padding:3px 0' });
    const unit = critUnit(f, sc);
    row.append(el('button', { class: 'btn btn-quiet btn-sm', style: 'justify-content:flex-start;padding:0;font-size:12px;text-align:left',
      title: f.formula, onclick: () => openMetricInfo(f) }, unit ? `${f.label} (${unit})` : f.label));
    ['min', 'max'].forEach(side => {
      row.append(el('input', { class: 'input input-inline', type: 'number', placeholder: side, value: c[side] ?? '',
        id: `crit-${f.k}-${side}`,
        'aria-label': `${f.label} ${side}${unit ? `, ${unit}` : ''}`,
        onchange: e => {
          sc.crit[f.k] = { ...(sc.crit[f.k] || {}), [side]: e.target.value === '' ? null : +e.target.value };
          /* A number field commits on Tab as well as on Enter, and on Tab the
             focus is on its way to the next field when change fires. One tick
             later it has arrived, so that is the element focus returns to. */
          setTimeout(renderKeepFocus, 0);
        } }));
    });
    return row;
  };

  const prim = el('div', { style: 'border-top:1px solid var(--grid);padding:8px 0' });
  prim.append(el('p', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Main filters'));
  primaryFields.forEach(f => prim.append(critRow(f)));
  railBody.append(prim);

  const adv = el('details', { style: 'border-top:1px solid var(--grid);padding:8px 0' });
  const advActive = FIELDS.filter(f => !PRIMARY.includes(f.k) && sc.crit[f.k]
    && (sc.crit[f.k].min != null || sc.crit[f.k].max != null)).length;
  adv.append(el('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-2);padding:4px 0' },
    el('span', { class: 'row' }, ['Advanced filters',
      advActive ? el('span', { class: 'chip chip-brand', style: 'margin-left:auto' }, String(advActive)) : null])));
  if (advActive) adv.setAttribute('open', '');
  railBody.append(adv);

  /* metric families */
  FIELD_GROUPS.forEach(g => {
    const groupFields = FIELDS.filter(f => f.g === g && !PRIMARY.includes(f.k));
    if (!groupFields.length) return;
    const det = el('details', { style: 'border-top:1px solid var(--grid);padding:8px 0' });
    const activeCount = groupFields.filter(f => sc.crit[f.k] && (sc.crit[f.k].min != null || sc.crit[f.k].max != null)).length;
    det.append(el('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-2);padding:4px 0' },
      el('span', { class: 'row' }, [g, activeCount ? el('span', { class: 'chip chip-brand', style: 'margin-left:auto' }, String(activeCount)) : null])));
    if (activeCount) det.setAttribute('open', '');
    groupFields.forEach(f => det.append(critRow(f)));
    adv.append(det);
  });
  rail.append(railBody);

  const railFoot = el('div', { style: 'padding:var(--sm) var(--md);border-top:1px solid var(--line);display:flex;gap:6px' });
  railFoot.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'flex:1', onclick: () => saveScreen(), html: `${icon('plus', 13)} Save screen` }));
  railFoot.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'flex:1', onclick: () => exportScreen(), html: `${icon('down', 13)} Export` }));
  rail.append(railFoot);
  wrap.append(rail);

  /* ---------- results ---------- */
  const main = el('div', { style: 'min-width:0' });
  const evald = U.map(r => ({ r, ev: evaluateScreen(r, sc) }));
  const passed = evald.filter(x => x.ev.pass).map(x => x.r);
  const failed = evald.filter(x => !x.ev.pass);

  const resCard = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });

  /* A published screen that cannot test one of its own rules says so here,
     beside its results. Declaring it in the definition and not on the screen
     would be the same omission with extra steps. */
  const publishedScreen = SCREEN_TEMPLATES.find(t => t.id === State.appliedTemplate);
  if (publishedScreen?.untestable?.length) {
    resCard.append(el('div', { class: 'note', style: 'margin:0;border-radius:0;border-left:3px solid var(--warn)' }, [
      el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' },
        `${publishedScreen.name} (${publishedScreen.spec}, v${publishedScreen.version}) — ${publishedScreen.untestable.length} rule${publishedScreen.untestable.length > 1 ? 's' : ''} not evaluated`),
      ...publishedScreen.untestable.map(u => el('p', { class: 'metaline', style: 'margin-top:4px' },
        [el('code', {}, u.rule), ' — ', u.because].filter(Boolean))),
      el('p', { class: 'metaline', style: 'margin-top:6px' },
        'Matches below satisfy the rules that could be tested. They are not a complete pass of this screen.'),
    ]));
  }

  /* A filter on an observed-price field excludes every company that has no
     imported history, which can empty a screen entirely. Without this the
     result reads as "nothing qualifies" when it means "nothing has been
     measured" — the same distinction the trend engine makes everywhere else. */
  const PRICE_FIELDS = { rs12: '12-month price change', from52: 'distance from the 52-week high',
                         sma200d: 'distance from the 200-day average', range52: 'position in the 52-week range' };
  const usedPriceFields = (sc.rules || []).map(r => r.k).filter(k => PRICE_FIELDS[k]);
  if (usedPriceFields.length) {
    const backed = U.filter(r => r.m.pxPoints >= 20).length;
    if (backed < U.length) {
      resCard.append(el('div', { class: 'note', style: 'margin:0;border-radius:0;border-left:3px solid var(--bronze)' }, [
        el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' },
          `${U.length - backed} of ${U.length} companies have no observed price history`),
        el('p', { class: 'metaline' },
          `This screen filters on ${usedPriceFields.map(k => PRICE_FIELDS[k]).join(' and ')}, which ${usedPriceFields.length > 1 ? 'are' : 'is'} computed from imported closes rather than a stored figure. Companies without history are excluded — they are unmeasured, not unqualified. Add your own closes under My Investments → Your data.`),
      ]));
    }
  }

  /* Active filters, above the results, each removable where it stands. A screen
     that returns four companies is meaningless unless what produced it is
     visible — otherwise the reader cannot tell a strict screen from an empty
     universe. */
  const activeChips = el('div', { class: 'row row-wrap', style: 'gap:6px;padding:10px var(--lg);border-bottom:1px solid var(--line)' });
  const active = activeFilters(sc);

  activeChips.append(el('span', { class: 'metaline', style: 'margin-right:2px' },
    active.length ? `${active.length} active filter${active.length === 1 ? '' : 's'}:` : 'No filters applied — every company in the universe is shown.'));
  active.forEach(a => activeChips.append(el('button', { class: 'chip chip-brand', style: 'cursor:pointer;border:0',
    'aria-label': `Remove filter: ${a.label}`,
    onclick: () => { a.clear(); render(); } }, `${a.label} ✕`)));
  if (active.length) activeChips.append(el('button', { class: 'btn btn-quiet btn-sm',
    onclick: () => { State.screen = blankScreen(); render(); } }, 'Clear all'));

  const resHd = el('div', { style: 'padding:var(--md) var(--lg);border-bottom:1px solid var(--line)' });
  const hdRow = el('div', { class: 'row row-wrap', style: 'gap:var(--sm)' });
  hdRow.append(el('div', {}, [
    el('h3', { class: 'h-card' }, `${passed.length} of ${U.length} companies match`),
    el('p', { class: 'caption', style: 'margin-top:2px' }, 'Same as-of date, data version and model version reproduce this exact result.'),
  ]));

  /* Reporting currency for this screen. Distinct from the base currency on
     Home, which sets what the whole product reports in — this decides only
     whether a mixed table converts or leaves each company in its own currency.
     "Local" is the option that converts nothing, which is the right default for
     anyone comparing a Bursa company against its own history rather than
     against a US one. */
  const ccyRow = el('div', { class: 'row', style: 'gap:6px;align-items:center;margin-left:auto' });
  ccyRow.append(el('span', { class: 'caption' }, 'Show money in'));
  ccyRow.append(el('div', { class: 'segmented' }, [
    ['local', 'Local'], ['MYR', 'MYR'], ['USD', 'USD'],
  ].map(([v, label]) => el('button', {
    'aria-selected': screenCcy() === v ? 'true' : 'false',
    title: v === 'local' ? 'Each company in the currency it reports in. Nothing is converted.'
                         : `Everything converted to ${v} at the rate shown below the table.`,
    onclick: () => { State.screenCcy = v; store.write('screenCcy', v); render(); } }, label))));
  hdRow.append(ccyRow);
  hdRow.append(el('span', { class: 'spacer' }));
  hdRow.append(el('button', { class: 'btn btn-ghost btn-sm', 'aria-pressed': sc.showMedians !== false ? 'true' : 'false',
    onclick: () => { sc.showMedians = sc.showMedians === false; render(); },
    html: `${icon('scale', 13)} ${sc.showMedians !== false ? 'Hide' : 'Show'} medians` }));
  /* The count belongs on the button. A reader who has widened the table to
     fourteen columns cannot see how many they added without opening the
     drawer and counting ticks, and "Columns" alone gives no hint that the
     wide table they are squinting at is something they did. */
  hdRow.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openColumnPicker(),
    html: `${icon('grid', 13)} Columns · ${sc.cols.length}` }));
  /* Offered only once it would do something — a reset button beside a table
     already in its default state is a control that cannot be used. */
  if (!samePreset(sc.cols, COL_PRESETS[0])) hdRow.append(el('button', {
    class: 'btn btn-quiet btn-sm', title: COL_PRESETS[0].why,
    onclick: () => { sc.cols = [...COL_PRESETS[0].cols]; render(); } }, 'Essentials'));
  hdRow.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openExclusions(failed), html: `${icon('info', 13)} Explain exclusions` }));
  resHd.append(hdRow);
  resCard.append(resHd);
  resCard.append(activeChips);

  if (!passed.length) {
    resCard.append(emptyState('No company clears every criterion. Loosen a threshold, or open "Explain exclusions" to see which test each company failed.'));
  } else {
    const cols = [
      { k:'ident', label:'Company', sortable:false },
      { k:'quality', label:'Quality', get:r => r.scores.quality.score, fmt:(v, r) => scorePill(v, r.pct.quality) },
      { k:'value', label:'Value', get:r => r.scores.value.score, fmt:(v, r) => scorePill(v, r.pct.value) },
      { k:'mos', label:'vs base-case model estimate', get:r => r.val.mos?.base, fmt:v => `<span class="${diffClass(v)}">${withSign(v, 0)}</span>`, mfmt:v => withSign(v, 0) },
      /* A monetary column is converted to one currency and says which. It used
         to print r.m.mcap raw, so a screen across both markets stacked ringgit
         and dollars in the same column with nothing to tell them apart — and a
         Bursa company looked 4.4× larger than it is.

         Under "Local" nothing is converted, so the column header cannot name a
         single currency and each cell carries its own instead. A median across
         mixed currencies is not a quantity, so it is withheld rather than
         computed — mfmt is absent and the footer prints a dash. */
      ...sc.cols.map(k => {
        const f = FIELD_BY_K[k];
        if (!f.money) return { k, label:f.label, get:r => r.m[k], fmt:v => isNum(v) ? f.fmt(v) : NA, mfmt:f.fmt };
        if (screenCcy() === 'local') return {
          k, label:`${f.label} (local)`,
          get:r => r.m[k],
          fmt:(v, r) => isNum(v) ? `${fmtCap(v, r.c.ccy)} <span class="caption">${r.c.ccy}</span>` : NA,
          mfmt:null,
        };
        const target = screenCcy();
        return { k, label:`${f.label} (${target})`,
                 get:r => convertTo(r.m[k], r.c.ccy, target),
                 fmt:v => isNum(v) ? fmtCap(v, target) : NA,
                 mfmt:v => fmtCap(v, target) };
      }),
      { k:'risk', label:'Risk', get:r => r.risk.raw, fmt:(v, r) => riskPill(r.risk.band) },
      { k:'coverage', label:'Coverage', get:r => r.m.coverage, fmt:v => `${v}%`, mfmt:v => `${Math.round(v)}%` },
    ];
    cols[1].mfmt = v => String(Math.round(v));   /* quality */
    cols[2].mfmt = v => String(Math.round(v));   /* value */
    const sorted = sortScreenRows(passed, sc);

    /* ONE VERTICAL SCROLL PER PAGE.
       This was max-height:66vh with overflow:auto, so 11,094px of results lived
       inside a 320px window, inside a page that also scrolled, beside a filter
       column that scrolled too — three vertical scrollbars competing for the
       same wheel. Whichever one the pointer happened to be over moved, which is
       the kind of thing that reads as the page being broken.

       The table now grows and the page scrolls, which is what a reader's wheel
       and a browser's find-in-page both already expect. Horizontal scrolling
       stays: twelve columns genuinely do not fit a phone, and that scroll is
       one the reader initiates deliberately on the axis the content overflows. */
    const tw = el('div', { class: 'tablewrap', style: 'border:0;border-radius:0;overflow-x:auto' });
    const table = el('table', { class: 'dt', data: { density: State.density || 'comfortable' } });
    const thead = el('thead'); const htr = el('tr');
    cols.forEach(c2 => {
      const th = el('th', { class: (c2.k === 'ident' ? 'pin ' : '') + (c2.get ? 'sortable' : ''),
        'aria-sort': sc.sort.k === c2.k ? (sc.sort.dir === 1 ? 'ascending' : 'descending') : null,
        onclick: c2.get ? () => { if (sc.sort.k === c2.k) sc.sort.dir *= -1; else { sc.sort.k = c2.k; sc.sort.dir = -1; } render(); } : null,
        html: `${esc(c2.label)}${c2.get ? `<span class="sort-ind">${sc.sort.k === c2.k ? (sc.sort.dir === 1 ? '▲' : '▼') : '↕'}</span>` : ''}` });
      htr.append(th);
    });
    thead.append(htr); table.append(thead);
    const tb = el('tbody');
    sorted.forEach(r => {
      const tr = el('tr');
      cols.forEach(c2 => {
        if (c2.k === 'ident') {
          const th = el('th', { class: 'pin ident', scope: 'row' });
          th.append(tickerCell(r)); tr.append(th); return;
        }
        const v = c2.get(r);
        const td = el('td', { html: c2.fmt(v, r) });
        /* Any metric cell opens its own source drawer: what it is, the formula,
           the period, the prior period, where it came from and how complete the
           company's data is. This is the product's central claim made operable
           rather than asserted in copy. */
        const fld = FIELD_BY_K[c2.k] || FIELD_BY_K[SCORE_COL_FIELD[c2.k]];
        if (fld && isNum(v)) {
          td.classList.add('cell-sourced');
          td.setAttribute('role', 'button');
          /* The label reads what the cell shows. A money column holds the
             converted value, and fld.fmt on it would print it in the
             company's own currency — "$29.7B" announced as "RM29.7B". */
          td.setAttribute('aria-label', `${fld.label} for ${r.c.tk}: ${fld.money ? td.textContent.trim() : fld.fmt(v, r)} — show source`);
          td.addEventListener('click', () => openSourceDrawer(r, fld));
          td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSourceDrawer(r, fld); } });
        } else if (fld) {
          /* An empty cell says why — not reported, not applicable, withheld,
             no price, not meaningful — and opens the same drawer, which names
             the line or the flag behind the absence. "n/a" for everything was
             a claim that nothing could be said. */
          const st = metricStatus(r, fld.k);
          td.innerHTML = `<span class="caption cell-absent" title="${esc(st.text)}">${esc(st.label)}</span>`;
          td.classList.add('cell-sourced');
          td.setAttribute('role', 'button');
          td.setAttribute('aria-label', `${fld.label} for ${r.c.tk}: unavailable, ${st.reason} — show why`);
          td.addEventListener('click', () => openSourceDrawer(r, fld));
          td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSourceDrawer(r, fld); } });
        }
        tr.append(td);
      });
      tb.append(tr);
    });
    table.append(tb);

    /* Median comparison rows. A screen result means little on its own — what
       matters is whether it selected companies above the cohort it came from. */
    if (sc.showMedians !== false) {
      const universeRows = U.filter(r =>
        sc.universe === 'all' ? true :
        sc.universe === 'watchlist' ? State.watchlist.includes(r.c.id) : r.c.mkt === sc.universe);
      const bands = [
        ['Median — matches', sorted, 'Median across the companies this screen selected.'],
        ['Median — universe', universeRows, 'Median across every company in the selected universe, screened or not.'],
      ];
      if (sc.sectors.length === 1) bands.push(
        [`Median — ${sc.sectors[0]}`, U.filter(r => r.c.sector === sc.sectors[0]), 'Median across the whole sector.']);

      const tf = el('tfoot');
      bands.forEach(([label, rowSet, note]) => {
        const tr = el('tr', { style: 'background:var(--surface-sunk)' });
        cols.forEach(c2 => {
          if (c2.k === 'ident') {
            tr.append(el('td', { class: 'pin ident', style: 'background:var(--surface-sunk);font-weight:600', title: note }, label));
            return;
          }
          if (!c2.get || !c2.mfmt) { tr.append(el('td', { style: 'background:var(--surface-sunk)' }, '')); return; }
          const med = median(rowSet.map(c2.get));
          tr.append(el('td', { style: 'background:var(--surface-sunk);color:var(--ink-2)',
            html: isNum(med) ? c2.mfmt(med) : '<span class="caption">—</span>' }));
        });
        tf.append(tr);
      });
      table.append(tf);
    }

    /* One tab stop for the whole table, arrows inside it. Called after the
       body, the median rows and the header all exist. */
    gridKeyboard(table, `Screener results, ${sorted.length} companies by ${cols.length} measures. `
      + 'Use the arrow keys to move between cells and Enter on a measure to see where it came from.');
    tw.append(table);

    /* What was converted and what was not, stated where the mixed table is
       rather than on a methodology page. Only shown when the screen actually
       spans both markets, because on a single-market screen there is nothing to
       disambiguate. */
    const spansMarkets = new Set(sorted.map(r => r.c.ccy)).size > 1;
    const moneyCols = sc.cols.filter(k => FIELD_BY_K[k]?.money);
    if (spansMarkets) {
      const parts = [`This screen spans companies reporting in ${[...new Set(sorted.map(r => r.c.ccy))].sort().join(' and ')}.`];
      if (!moneyCols.length) {
        parts.push('No monetary column is shown, so nothing has been converted.');
      } else if (screenCcy() === 'local') {
        parts.push(`${moneyCols.map(k => FIELD_BY_K[k].label).join(', ')} ${moneyCols.length === 1 ? 'is' : 'are'} shown in each company’s own reporting currency, labelled per row. Nothing has been converted, so those values are not comparable across the two markets and no median is offered for them.`);
      } else {
        parts.push(`${moneyCols.map(k => FIELD_BY_K[k].label).join(', ')} ${moneyCols.length === 1 ? 'is' : 'are'} converted to ${screenCcy()} at USD/MYR ${FX.USDMYR.toFixed(2)}${FX.asOf ? `, ${FX.asOf}` : ''}${FX.source === 'sample' ? ' — a sample rate, undated because nobody observed it' : ''}.`);
      }
      parts.push('Every other column is a ratio, a multiple or a percentage and reads the same in either currency. Scores and percentile ranks are computed within each market cohort, not across the two.');
      tw.append(el('p', { class: 'metaline', style: 'padding:10px var(--md);border-top:1px solid var(--line)' },
        parts.join(' ')));
    }

    /* Below 768px a twenty-column table is unusable — it either overflows the
       viewport or shrinks the type past reading size. The same rows are
       rendered as cards, showing the four measures that decide whether a
       company is worth opening. Both are in the DOM and CSS chooses; the card
       list is not a reduced dataset, only a reduced set of columns. */
    const cards = el('div', { class: 'screener-cards' });
    sorted.forEach(r => {
      const card = el('a', { class: 'card screener-card', href: href(companyPath(r.c)),
        onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); openResearch(r.c.id); } });
      card.append(el('div', { class: 'row', style: 'gap:8px;align-items:baseline' }, [
        el('span', { style: 'font-weight:700' }, r.c.tk), illusChip(r.c),
        el('span', { class: 'metaline', style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.c.name),
        el('span', { class: r.c.mkt === 'US' ? 'chip chip-us' : 'chip chip-my' }, r.c.mkt),
      ]));
      const mini = el('div', { class: 'screener-card-metrics' });
      /* An absent score prints its reason, as the table cell does. String()
         on it printed the word "null" on 55 of 77 phone cards. */
      const score = (v, k) => isNum(v) ? String(v) : metricStatus(r, k).label;
      [['Quality', score(r.scores.quality.score, 'qscore')],
       ['Value', score(r.scores.value.score, 'vscore')],
       ['Yield', isNum(r.m.dy) ? fmtPct(r.m.dy, 2) : '—'],
       ['Completeness', `${r.m.coverage}%`]].forEach(([k, v]) => {
        /* Not `metaline`. On desktop these four are table column headings; in
           the phone card they are the label half of a labelled value the
           reader acts on, so they take the 14/20 decision floor rather than
           the 12/16 metadata one. The value beside them was already 14. */
        mini.append(el('div', {}, [
          el('div', { style: 'font-size:14px;line-height:20px;color:var(--ink-3)' }, k),
          el('div', { class: 'num', style: 'font-weight:600;font-size:14px' }, v),
        ]));
      });
      card.append(mini);
      cards.append(card);
    });
    tw.append(cards);
    resCard.append(tw);
    resCard.append(el('div', { style: 'padding:9px var(--lg);border-top:1px solid var(--line);display:flex;gap:var(--sm);align-items:center' }, [
      el('span', { class: 'metaline' }, `${sorted.length} rows · scroll the table for the rest`),
      el('div', { class: 'segmented', style: 'margin-left:var(--sm)' }, [
        el('button', { 'aria-selected': (State.density || 'comfortable') === 'comfortable' ? 'true' : 'false',
          onclick: () => { State.density = 'comfortable'; store.write('density', 'comfortable'); render(); } }, 'Comfortable'),
        el('button', { 'aria-selected': State.density === 'compact' ? 'true' : 'false',
          onclick: () => { State.density = 'compact'; store.write('density', 'compact'); render(); } }, 'Compact'),
      ]),
      el('span', { class: 'spacer' }),
      el('span', { class: 'metaline' }, `Sorted by ${cols.find(c2 => c2.k === sc.sort.k)?.label ?? '—'}, ${sc.sort.dir === 1 ? 'ascending' : 'descending'}`),
    ]));
  }
  main.append(resCard);

  /* saved screens */
  if (State.savedScreens.length) {
    const sv2 = el('div', { class: 'card', style: 'margin-top:var(--md)' });
    sv2.append(cardHead('Saved screens',
      'Each saved screen freezes its criteria, its result set and the score behind every match, so it can be reproduced rather than merely re-run.'));
    const l = el('div', { style: 'display:flex;flex-direction:column' });
    State.savedScreens.forEach((s, i) => {
      const diff = screenDiff(s);
      const row = el('div', { class: 'row row-wrap', style: `gap:10px;padding:9px 0;${i ? 'border-top:1px solid var(--grid)' : ''}` });
      const nm = el('button', { class: 'tickerbtn', onclick: () => openSavedScreen(i) });
      nm.append(el('span', { class: 'tk' }, s.name));
      nm.append(el('span', { class: 'nm', style: 'max-width:none' },
        `${(s.snapshot?.matches || []).length} matches when saved · ${s.snapshot?.saved ?? s.asOf}`));
      row.append(nm);
      row.append(el('span', { class: 'spacer' }));
      if (diff.entered.length) row.append(sevChip('good', `${diff.entered.length} new match${diff.entered.length === 1 ? '' : 'es'}`));
      if (diff.left.length) row.append(sevChip('warning', `${diff.left.length} dropped`));
      if (!diff.entered.length && !diff.left.length) row.append(el('span', { class: 'chip' }, 'No change'));
      /* alert-on-new-match toggle, per screen */
      const lab = el('label', { class: 'checkline', style: 'gap:6px', title: 'Alert me when a new company matches this screen' });
      lab.append(el('input', { type: 'checkbox', checked: s.alertOnMatch !== false ? '' : null,
        onchange: e => { s.alertOnMatch = e.target.checked; store.write('savedScreens', State.savedScreens); render(); } }));
      lab.append(el('span', {}, 'Alert on new match'));
      row.append(lab);
      row.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openSavedScreen(i) }, 'Detail'));
      l.append(row);
    });
    sv2.append(l);
    main.append(sv2);
  }

  /* The screen's own strip, not the first row's. provenance(U[0]) printed one
     company's price stamp, fiscal year, currency and coverage under a table
     of 138 — Maybank's, once the illustrative US twins retire — as though
     they described the screen. */
  {
    const filed = U.filter(r => r.c.real), yrs = U.map(r => latestFy(r.c)), priced = U.filter(r => isNum(r.c.px?.p));
    main.append(el('div', { class: 'prov', style: 'margin-top:var(--md)', html: [
      `<b>Companies</b> ${U.length} · ${filed.length} filed, ${U.length - filed.length} illustrative`,
      `<b>Period</b> each company's latest fiscal year, FY${Math.min(...yrs)}–FY${Math.max(...yrs)}`,
      `<b>Prices</b> ${priced.length} of ${U.length} carry one${priced.some(r => !r.c.real) ? ' — the illustrative set’s are sample figures' : ''}`,
      `<b>Model</b> ${MODEL_VERSION}`,
    ].join('<span class="dotsep"></span>') }));
  }
  wrap.append(main);
  return wrap;
}

function scorePill(v, pct) {
  if (!isNum(v)) return NA;
  const t = v / 100;
  const bg = cssVar(sequentialVar(t));
  return `<span style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end">
    <span class="num" style="font-weight:600;color:var(--ink)">${v}</span>
    <span style="width:26px;height:6px;border-radius:999px;background:${bg};flex:none" title="${isNum(pct) ? ord(pct) + ' percentile' : ''}"></span></span>`;
}
function riskPill(band) {
  const map = { Low:'--ok', Medium:'--warn', High:'--critical' };
  return `<span class="chip" style="background:color-mix(in srgb, var(${map[band]}) 13%, transparent);border-color:color-mix(in srgb, var(${map[band]}) 32%, transparent)">
    <span class="chip-dot" style="background:var(${map[band]})"></span>${band}</span>`;
}

/* ==========================================================================
   PROVENANCE — reported, calculated, or modelled

   These are three different kinds of claim and the product's whole argument
   rests on never presenting them as one. A reported figure came off a filed
   statement. A calculated one is arithmetic on reported figures and is exactly
   as reliable as they are. A modelled one is the output of assumptions someone
   chose, and could have been chosen differently.
   ========================================================================== */
const PROVENANCE = {
  reported:   { label: 'Reported',   cls: 'chip chip-ok',     note: 'Taken directly from a filed statement line. Not adjusted.' },
  calculated: { label: 'Calculated', cls: 'chip',             note: 'Arithmetic on reported lines. No assumption is involved, so it is exactly as reliable as the figures underneath it.' },
  modelled:   { label: 'Modelled',   cls: 'chip chip-bronze', note: 'An output of assumptions you can see and change. A different set of assumptions gives a different number.' },
  market:     { label: 'Market',     cls: 'chip',             note: 'Needs a price. The price comes from the source stated on the company page — an end-of-day close you supplied or a figure you entered — never from a licensed feed, because none is connected.' },
  /* Two more kinds the four above could not say. A figure on a synthetic
     company is arithmetic like any other, but on lines that describe no
     company; and an absence is not a kind of number at all, which is why it
     carries a reason instead. */
  illustrative: { label: 'Illustrative', cls: 'chip chip-bronze', note: 'Computed from a synthetic sample statement, not a filing. It demonstrates the interface and describes no company.' },
  unavailable:  { label: 'Unavailable',  cls: 'chip chip-bronze', note: 'No figure is shown and the reason is stated. Nothing is imputed, and an absent figure never passes a screen.' },
};
/* The five reasons a figure can be absent. `short` is what the screener cell
   prints; `legend` is what the Learn page says it means. The reason a
   particular cell gives is built by metricStatus from the company's own
   lines, so the legend describes the class and the cell names the instance. */
const ABSENCE = {
  'not reported':   { short: 'not reported', legend: 'A statement line the measure needs is not in the stored statements — for a filer, the XBRL tag did not resolve. The drawer names the line.' },
  'not applicable': { short: 'n/a',          legend: 'The measure has no meaning for this business model — enterprise value on a deposit-taking balance sheet — and is excluded from the count of applicable measures rather than counted as missing.' },
  'withheld':       { short: 'withheld',     legend: 'The inputs exist and disagree with each other, a corporate action sits inside the window, or the shipped statements assembled the line by a rule since corrected. A number could be computed; it would be wrong, so it is not.' },
  /* Two routes, because a single entered price fills the ratio measures and
     nothing else: the twelve-month change, the distance from the 52-week high
     and the 200-day average need hundreds of observed closes. */
  'needs a price':  { short: 'no price',     legend: 'The measure divides by or compares to a market price, and no licensed feed is connected. A price you enter on the company page fills the ratio measures, labelled as yours; the trend measures need a history of closes you import under Your data.' },
  'not meaningful': { short: 'n/m',          legend: 'Every input is present in every year the measure reads, but the ratio is not meaningful on them — earnings at or below zero under a price, a growth base at or below zero.' },
};
function provChip(kind) {
  const p = PROVENANCE[kind] || PROVENANCE.calculated;
  return el('span', { class: p.cls, title: p.note }, p.label);
}
/* The chip for a status, present or absent. */
function statusChip(st) {
  if (st.available) return provChip(st.id);
  return el('span', { class: 'chip chip-bronze', title: st.text }, `Unavailable — ${st.reason}`);
}

/* Which kind each screener field is when it is present. Statement lines are
   reported; everything derived from them is calculated; anything needing a
   price is market; anything that is an output of assumptions is modelled. */
const FIELD_PROVENANCE = {
  pe:'market', pb:'market', evebit:'market', pfcf:'market', dy:'market', fcfy:'market', rs12:'market',
  from52:'market', sma200d:'market', mcap:'market',
  qscore:'modelled', vscore:'modelled', mosBase:'modelled',
};
const provenanceOf = (k) => FIELD_PROVENANCE[k] || 'calculated';

/* Which stored lines each measure is arithmetic on. `price` is the quoted
   price and `history` the reader's own closes; everything else is a column
   of the statement tuple. The drawer lists them with their latest values and
   XBRL tags, and an absent figure names the line that is missing. */
const LINE_LABEL = { rev:'revenue', ebit:'operating profit (EBIT)', ni:'net income', ocf:'operating cash flow', capex:'capital expenditure',
  eq:'shareholders’ equity', debt:'total debt', cash:'cash and equivalents', sh:'shares in issue', dps:'dividend per share',
  price:'price', history:'price history' };
const LINE_COL = { rev:F.REV, ebit:F.EBIT, ni:F.NI, ocf:F.OCF, capex:F.CAPEX, eq:F.EQ, debt:F.DEBT, cash:F.CASH, sh:F.SH, dps:F.DPS };
/* Where the ingest fills one tuple column from more than one line. Debt is
   the sum of the non-current and current lines; the share count is the
   year-end instant where the filer reports one, and the weighted diluted
   count where it does not — the ingest's own order (sh ?? shWtd). */
const LINE_PROV = { debt: { keys: ['debtL', 'debtC'], mode: 'sum' }, sh: { keys: ['sh', 'shWtd'], mode: 'first' } };
const FIELD_INPUTS = {
  roic:['ebit','eq','debt','cash'], om:['ebit','rev'], nm:['ni','rev'], fcfm:['ocf','capex','rev'], roe:['ni','eq'], cashconv:['ocf','ni'],
  rev5:['rev'], eps5:['ni','sh'], fcf5:['ocf','capex'], dps5:['dps'],
  ndEbit:['debt','cash','ebit'], de:['debt','eq'], icov:['ebit'], netGearing:['debt','cash','eq'],
  pe:['price','ni','sh'], pb:['price','eq','sh'], evebit:['price','sh','debt','cash','ebit'], pfcf:['price','ocf','capex','sh'],
  dy:['price','dps'], fcfy:['price','sh','ocf','capex'], buyback:['sh'], payout:['dps','ni','sh'], cashPayout:['dps','sh','ocf','capex'],
  reinv:['capex','ocf'], epsVol:['ni'], revDD:['rev'], dilution:['sh'], ocfPosYears:['ocf'],
  rs12:['history'], from52:['history'], sma200d:['history'], mcap:['price','sh'],
  qscore:['rev','ebit','ni','ocf','capex','eq','debt','cash','sh'], vscore:['price','ni','ocf','capex','eq','sh'], mosBase:['price'],
};
/* How many of the latest stored years each measure reads, where it is more
   than the latest one — the window derive() slices for it. The four-year
   growth, variability and drawdown measures read the last five points; the
   share-count rate is cagr() over the whole series; return on equity averages
   this year's equity with last year's. */
const FIELD_SPAN = { rev5: 5, eps5: 5, fcf5: 5, dps5: 5, epsVol: 5, revDD: 5, ocfPosYears: 5,
                     buyback: Infinity, dilution: Infinity };
const FIELD_SPAN_LINE = { roe: { eq: 2 } };
/* Measures a type cannot carry that the coverage dictionary does not list —
   so they are not in INAPPLICABLE, whose length the coverage figure prints. */
const ALSO_INAPPLICABLE = { bank: ['netGearing'] };
const TYPE_NOUN = { bank: 'bank', insurer: 'insurer', early: 'pre-profit company', reit: 'REIT' };
/* Why a measure whose inputs are all present still has no number. Each is the
   guard in derive() for that measure, in words. */
const NM_WHY = {
  pe: 'Earnings per share are zero or negative, so a price-to-earnings multiple has no meaning.',
  pb: 'Book value per share is zero or negative.',
  pfcf: 'Free cash flow per share is zero or negative.',
  evebit: 'Operating profit (EBIT) is zero or negative, so enterprise value cannot be expressed as a multiple of it.',
  fcfy: 'Market capitalisation could not be formed, so there is nothing to divide free cash flow by.',
  mcap: 'The share count is zero or absent, so a price cannot be turned into a market capitalisation.',
  om: 'Revenue is zero or negative.', nm: 'Revenue is zero or negative.', fcfm: 'Revenue is zero or negative.',
  roe: 'Average shareholders’ equity over the last two years is zero or negative, so a return on it has no meaning.',
  roic: 'Invested capital (equity plus debt less cash) is zero or negative.',
  cashconv: 'Net income is zero or negative, or operating cash flow exceeds fifteen times it — a ratio that measures a one-off, not conversion.',
  rev5: 'The starting year’s revenue is zero or negative, so a compound growth rate has no meaning.',
  eps5: 'The starting year’s earnings per share are zero or negative, so a compound growth rate has no meaning.',
  fcf5: 'The starting year’s free cash flow is zero or negative, so a compound growth rate has no meaning.',
  dps5: 'No dividend was paid in the starting year, so a compound growth rate has no meaning.',
  ndEbit: 'Operating profit (EBIT) is zero or negative, so debt cannot be expressed as years of it.',
  de: 'Shareholders’ equity is zero or negative, so debt cannot be expressed against it.',
  netGearing: 'Shareholders’ equity is zero or negative, so gearing against it has no meaning.',
  payout: 'Earnings per share are zero or negative, so a payout ratio has no meaning.',
  cashPayout: 'Free cash flow is zero or negative, so dividends cannot be expressed as a share of it.',
  reinv: 'Operating cash flow is zero or negative.',
  dilution: 'The first share count in the window is zero or absent.', buyback: 'The first share count in the window is zero or absent.',
  epsVol: 'Fewer than two year-on-year changes in net income can be measured.',
  revDD: 'Fewer than two years of revenue are held.',
  ocfPosYears: 'No year of operating cash flow is held.',
  qscore: 'Too few of the quality pillar’s inputs are computable to score it.',
  vscore: 'Too few of the valuation inputs are computable to score them — every one of them needs a price.',
  mosBase: 'The base-case model produced no estimate for this company — its model pack needs inputs that are absent — so there is no difference to a price.',
};

/* THE STATUS OF ONE FIGURE. Present: which of the five kinds it is. Absent:
   which of the five reasons, with the sentence for this company — the line
   that is missing, the flag that withheld it, the price it needs. The screener
   cell, the drawer and the Learn legend all read from here, so they cannot
   say three different things about one cell. */
function metricStatus(r, k) {
  const c = r?.c, m = r?.m || {}, v = m[k], f = FIELD_BY_K[k];
  const inputs = FIELD_INPUTS[k] || [];
  if (isNum(v)) {
    const id = c?.real ? provenanceOf(k) : 'illustrative';
    return { id, available: true, label: PROVENANCE[id].label, text: PROVENANCE[id].note };
  }
  const why = (reason, text) => ({ id: 'unavailable', available: false, reason, label: ABSENCE[reason].short, text });
  const skip = [...(INAPPLICABLE[c?.type] || []), ...(ALSO_INAPPLICABLE[c?.type] || [])];
  if (skip.includes(k)) return why('not applicable', c.type === 'bank' && f?.miss
    ? f.miss
    : `Not meaningful for a ${TYPE_NOUN[c.type] || c.type}. Excluded from the count of applicable measures rather than imputed.`);
  if (k === 'icov') return why('not reported', f?.miss || 'Interest expense is not carried in the statement tuple, so interest cover is reported missing for every company, never estimated.');
  const W = [
    [['om', 'nm', 'fcfm'], m.revenueSuspect],
    [['roe'], m.roeWithheld],
    [['payout', 'nm', 'roe', 'pe', 'cashconv'], m.perShareScaleBroken],
    [['eps5', 'dps5', 'dilution', 'buyback'], m.shareSeriesBreak
      ? `The share count moves from ${fmtNum(m.shareSeriesBreak.from, 2)}bn to ${fmtNum(m.shareSeriesBreak.to, 2)}bn inside the window — a corporate action, not issuance, and no corporate-action source is licensed here to undo it. A rate over a per-share line across that boundary would measure the split, so it is withheld.`
      : null],
  ];
  for (const [keys, text] of W) if (text && keys.includes(k)) return why('withheld', text);
  const fin = c?.fin || [];
  /* A statement line the shipped file assembled wrongly and the loader
     withheld (withholdMisassembled) is not a tag that failed to resolve. */
  const fyNow = c?.real ? latestFy(c) : null;
  const heldBack = inputs.filter(l => c?.withheld?.[l]?.years?.includes(fyNow));
  if (heldBack.length) return why('withheld', heldBack.map(l => `${LINE_LABEL[l]} for FY${fyNow} is withheld: ${c.withheld[l].why}.`).join(' ') + ' The ingest rule has been corrected; the figure returns when the statements are regenerated.');
  const lastRow = fin[fin.length - 1] || [];
  const missingLines = inputs.filter(l => LINE_COL[l] != null && !isNum(lastRow[LINE_COL[l]]));
  const noPrice = inputs.includes('price') && !isNum(c?.px?.p);
  if (missingLines.length) return why('not reported', `${missingLines.map(l => LINE_LABEL[l]).join(', ')} ${missingLines.length === 1 ? 'is' : 'are'} not in the latest stored statements${c?.real ? ' — the XBRL tag did not resolve for this filer' : ''}. Nothing is imputed.${noPrice ? ' It also needs a price, which no licensed feed supplies — but a price alone would not fill it.' : ''}`);
  /* The latest year is not the only year a growth, variability or share-count
     measure reads. META's dividend line is absent in its early stored years,
     so its dividend CAGR has no base — and the cell said "n/m" with "every
     input is present", which was false. Each input is checked across the rows
     the measure actually reads, and a gap in any of them is named with its
     years. */
  const earlier = inputs.filter(l => LINE_COL[l] != null).map(l => {
    const span = FIELD_SPAN_LINE[k]?.[l] ?? FIELD_SPAN[k] ?? 1;
    const rows = fin.slice(-span), ys = yearsOf(c).slice(-rows.length);
    return { l, years: rows.map((row, j) => (isNum(row[LINE_COL[l]]) ? null : ys[j])).filter(y => y != null) };
  }).filter(x => x.years.length);
  if (earlier.length) return why('not reported', `${earlier.map(x => `${LINE_LABEL[x.l]} (FY${x.years.join(', FY')})`).join('; ')} ${earlier.length === 1 ? 'is' : 'are'} not in the stored statements for ${earlier.length === 1 && earlier[0].years.length === 1 ? 'a year' : 'years'} this measure reads${c?.real ? ' — the XBRL tag did not resolve for this filer' : ''}. Nothing is imputed.`);
  if (noPrice) return why('needs a price', 'No licensed market-data feed is connected, so a filed company carries no price. Enter one on the company page and this computes from it, labelled as a figure you supplied.');
  if (inputs.includes('history')) {
    const need = k === 'sma200d' ? 200 : 252;
    return why('needs a price', `Needs ${need} observed closes; ${m.pxPoints || 0} held. Computed only from price history you imported or captured.`);
  }
  return why('not meaningful', NM_WHY[k] || 'Every input is present, but the ratio is not meaningful on them — a zero or negative denominator, or a growth base at or below zero.');
}

/* The drawer behind any number, or any absence: what it is, how it was
   produced, from which lines, from which period, against what it was before,
   and how far to trust it. */
function openSourceDrawer(r, f) {
  const { c, m } = r;
  const v = m[f.k];
  const st = metricStatus(r, f.k);
  /* Same metric one year earlier, where the series supports it — and not for a
     measure that needs a price or the reader's price history: re-deriving it
     on last year's statements keeps today's price, which is no period at all. */
  const priceBased = (FIELD_INPUTS[f.k] || []).some(l => l === 'price' || l === 'history');
  const prev = priceBased ? null : (() => {
    try { const d2 = derive({ ...c, fin: c.fin.slice(0, -1) }); return d2.m[f.k]; } catch { return null; }
  })();

  const body = el('div', { class: 'stack' });
  body.append(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
    statusChip(st),
    el('span', { class: 'chip' }, `${c.tk} · ${c.name}`),
    illusChip(c),
  ]));
  /* A money figure in its own currency, with the converted value the screener
     cell showed beside it, so the drawer and the cell visibly state one
     quantity rather than two unlabelled numbers. */
  const target = screenCcy();
  const conv = f.money && isNum(v) && target !== 'local' && target !== c.ccy ? convertTo(v, c.ccy, target) : null;
  body.append(el('div', { class: 'panel' }, statTile(f.label, isNum(v) ? f.fmt(v, r) : `unavailable — ${st.reason}`,
    { sub: [isNum(conv) ? `≈ ${fmtCap(conv, target)} at USD/MYR ${FX.USDMYR.toFixed(2)}` : null,
            isNum(prev) && isNum(v) ? `was ${f.fmt(prev, r)} in the prior period` : null].filter(Boolean).join(' · ') || null })));

  const kv = el('dl', { class: 'kv' });
  const fy = latestFy(c);
  const rows = [
    [st.available ? 'What it is' : 'Why it is absent', st.text],
    ['Formula', f.formula],
    ['Reporting period', `FY${fy}${fyEndOf(c, fy) ? ` (ended ${fmtFyEnd(fyEndOf(c, fy))})` : ''}, as reported`],
    ['Prior period', priceBased ? 'not shown — this measure needs the price on the day, and no price history for the prior year is held' : isNum(prev) ? `FY${yearsOf(c)[yearsOf(c).length - 2]} · ${f.fmt(prev, r)}` : 'not computable'],
    ['Currency', c.ccy],
    ['Source', c.real
      ? (c.personal ? `Annual statements you supplied — personal research, retrieved ${c.retrieved}` : `SEC EDGAR companyfacts, CIK ${c.cik}, retrieved ${c.retrieved}`)
      : 'Synthetic sample statement — not a filing'],
    ['Transformation', c.real && !c.personal
      ? 'Filed values scaled to billions. Debt is the non-current plus the current line. Where a filer reports no year-end share count, the weighted diluted count stands in. The latest-filed value for each year is used, so a restatement replaces the original. Nothing else is adjusted.'
      : c.real ? 'Statements as supplied, scaled to billions. Nothing else is adjusted.' : 'Synthetic lines. Nothing is adjusted.'],
    ['Data completeness', `${m.coverage}% of applicable measures are computable for this company`],
    ['Model version', MODEL_VERSION],
    ['Computed', `at page load, from ${dataDateLabel(c)}`],
  ];
  if (c.real && c.provenance) {
    const mixed = Object.entries(c.provenance).filter(([, pv]) => pv.mixedTags).map(([kk]) => kk);
    if (mixed.length) rows.push(['Tag drift',
      `${mixed.join(', ')} assembled from more than one XBRL tag across the window. Comparability across peers is weaker where this happens.`]);
  }
  rows.forEach(([k2, v2]) => { kv.append(el('dt', {}, k2)); kv.append(el('dd', { style: 'text-align:left' }, v2)); });
  body.append(kv);

  /* THE INPUTS. Each line the measure is arithmetic on, with the value that
     went in, the period it belongs to and — for a filer — the XBRL concept
     that supplied it. The lineage the plan asks for on every figure, in the
     place a reader already looks for it. */
  const inputs = FIELD_INPUTS[f.k] || [];
  if (inputs.length) {
    body.append(el('h4', { class: 'h-card', style: 'margin:var(--md) 0 6px' }, 'Inputs'));
    const last = c.fin?.[c.fin.length - 1] || [];
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Line', 'Latest value', 'Period', 'Source'].map(h => el('th', {}, h)))));
    const tb = el('tbody');
    inputs.forEach(l => {
      let val, period, src, present = true;
      if (l === 'price') {
        present = isNum(c.px?.p);
        val = present ? `${fmtNum(c.px.p, 2)} ${c.ccy}` : 'none';
        period = present ? priceAsOfLabel(c) : '—';
        src = c.px?.eod ? (c.pricePersonal ? 'read from your screen' : 'end-of-day close') : present ? 'entered by you' : 'no licensed feed';
      } else if (l === 'history') {
        present = (m.pxPoints || 0) > 0;
        val = `${m.pxPoints || 0} closes`;
        period = '—';
        src = present ? 'your imported or captured history' : 'none held';
      } else {
        const x = last[LINE_COL[l]];
        present = isNum(x);
        val = present ? (l === 'sh' ? `${fmtNum(x, 3)}bn shares` : l === 'dps' ? `${fmtNum(x, 3)} per share` : `${fmtNum(x, 3)}bn ${c.ccy}`) : 'not reported';
        period = `FY${fy}`;
        if (c.real && c.provenance && typeof c.provenance === 'object') {
          const spec = LINE_PROV[l] || { keys: [l], mode: 'first' };
          const tagOf = (pk) => c.provenance[pk]?.byYear?.[fy] || c.provenance[pk]?.byYear?.[String(fy)] || null;
          const tags = spec.mode === 'sum' ? spec.keys.map(tagOf).filter(Boolean) : [spec.keys.map(tagOf).find(Boolean)].filter(Boolean);
          src = tags.length ? tags.join(' + ') : `no tag recorded for FY${fy}`;
          /* The corrected ingest records the route each assembled column took;
             a withheld cell says why it is empty. */
          if (c.withheld?.[l]?.years?.includes(fy)) src = `withheld — ${c.withheld[l].why}`;
          else if (c.basis?.[l]?.[fy]) src = c.basis[l][fy];
          else if (l === 'sh' && !tagOf('sh') && tagOf('shWtd')) src += ' (weighted diluted — no year-end count filed)';
        } else src = c.real ? 'statements you supplied' : 'synthetic sample';
      }
      tb.append(el('tr', {}, [
        el('td', { class: 'ident' }, LINE_LABEL[l] || l),
        el('td', { class: present ? '' : 'caption' }, val),
        el('td', {}, period),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal;max-width:260px' }, src),
      ]));
    });
    t.append(tb); tw.append(t); body.append(tw);
  }

  if (METRIC_HELP[f.k]) {
    body.append(el('button', { class: 'btn btn-ghost btn-sm',
      onclick: () => explainMetric(f.k) }, 'What does this measure mean?'));
  }
  openDrawer(f.label, body);
}

function openMetricInfo(f) {
  const body = el('div');
  body.append(el('p', { class: 'eyebrow' }, f.g));
  body.append(el('h3', { class: 'h-section', style: 'margin:4px 0 var(--sm)' }, f.label));
  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  [['Formula', f.formula], ['Reporting period', 'The latest fiscal year each company reports — the year is stated on every company page and in the source drawer behind each cell'],
   ['Source', 'Reported statement lines: SEC EDGAR companyfacts for the filed companies, synthetic sample lines for the illustrative ones. Each company page says which it is.'],
   ['Normalisation', 'None — the figure is computed directly from the stored lines'], ['Missing-data behaviour', f.miss || 'Reported as unavailable; never imputed and never passes a threshold.']]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, v)); });
  body.append(kv);

  const vals = U.map(r => ({ r, v: r.m[f.k] })).filter(x => isNum(x.v)).sort((a, b) => b.v - a.v);
  body.append(el('h4', { class: 'h-card', style: 'margin-bottom:6px' }, `Distribution across the universe (${vals.length} of ${U.length} computable)`));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Company'), el('th', {}, 'Value'), el('th', {}, 'Market pct')])));
  t.append(el('tbody', {}, vals.slice(0, 12).map(x => el('tr', {}, [
    el('td', { class: 'ident' }, x.r.c.tk + illusText(x.r.c)), el('td', {}, f.fmt(x.v, x.r)), el('td', {}, String(metricPct(x.r, f.k, 'market') ?? '—')),
  ]))));
  tw.append(t); body.append(tw);
  openDrawer('Metric definition', body);
}

function openExclusions(failed) {
  const body = el('div');
  /* Every excluded company, and the count. This was cut at forty with nothing
     to say so, and a drawer that ends at NFLX reads as a complete list — the
     other twenty-one simply did not exist. The universe is small enough to
     list whole. */
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    `${failed.length} ${failed.length === 1 ? 'company' : 'companies'} failed at least one active criterion, all listed below. The first failure is listed first — a company can fail several.`));
  failed.forEach(({ r, ev }) => {
    const item = el('div', { class: 'panel', style: 'margin-bottom:8px' });
    item.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' }, [
      el('span', { style: 'font-weight:600;font-size:13px' }, r.c.tk), illusChip(r.c), marketChip(r.c.mkt),
      el('span', { class: 'spacer' }),
      el('span', { class: 'chip' }, `${ev.fails.length} failed`),
    ]));
    const ul = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:4px' });
    ev.fails.forEach(f => ul.append(el('li', { class: 'evidence counter', style: 'font-size:12px' }, f)));
    item.append(ul);
    body.append(item);
  });
  openDrawer('Why these were excluded', body);
}

function openColumnPicker() {
  const sc = State.screen;
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' }, 'Pick up to eight metric columns. The identity, scores and coverage columns are always shown.'));

  /* Presets first, because getting back to a readable table is the request
     that brings most readers here. Each names a group of measures; none of
     them selects, orders or ranks companies. */
  body.append(el('h4', { class: 'eyebrow', style: 'margin:0 0 6px' }, 'Presets'));
  const pr = el('div', { class: 'row row-wrap', style: 'gap:8px' });
  COL_PRESETS.forEach(p => {
    const on = samePreset(sc.cols, p);
    pr.append(el('button', {
      class: `btn btn-sm ${on ? 'btn-ghost' : 'btn-quiet'}`,
      'aria-pressed': on ? 'true' : 'false',
      title: p.why,
      onclick: () => { sc.cols = [...p.cols]; render(); openColumnPicker(); },
    }, p.label));
  });
  body.append(pr);
  body.append(el('p', { class: 'metaline', style: 'margin:6px 0 var(--lg)' },
    'A preset chooses which columns are on screen. It does not filter, sort or rank anything.'));

  FIELD_GROUPS.forEach(g => {
    body.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 4px' }, g));
    FIELDS.filter(f => f.g === g).forEach(f => {
      const lab = el('label', { class: 'checkline' });
      lab.append(el('input', { type: 'checkbox', checked: sc.cols.includes(f.k) ? '' : null,
        onchange: e => {
          if (e.target.checked) { if (sc.cols.length >= 8) { e.target.checked = false; toast('Eight columns is the maximum'); return; } sc.cols = [...sc.cols, f.k]; }
          else sc.cols = sc.cols.filter(k => k !== f.k);
          render();
        } }));
      lab.append(el('span', {}, f.label));
      body.append(lab);
    });
  });
  openDrawer('Choose columns', body);
}

/* A saved screen freezes its result set, the scores behind each match and the
   model version. Without that snapshot a screen can be re-run but not
   reproduced — a later model change would give a different answer to the same
   saved question with nothing to compare against. This is what Epic C asks for. */
function screenSnapshot(def) {
  return {
    asOf: AS_OF,
    model: MODEL_VERSION,
    saved: new Date().toISOString().slice(0, 10),
    matches: U.filter(r => evaluateScreen(r, def).pass).map(r => ({
      id: r.c.id, tk: r.c.tk,
      quality: r.scores.quality.score,
      value: r.scores.value.score,
      strength: r.scores.strength.score,
      mos: isNum(r.val.mos?.base) ? +r.val.mos.base.toFixed(2) : null,
      coverage: r.m.coverage,
    })),
  };
}

/* A score change between a snapshot and now, only where both sides are a
   score. An unpriced filer's value score is null, and `now − null` counted a
   score appearing as a change of its whole size; `null − null` is 0 and hid
   nothing, but by accident. */
const scoreDelta = (now, then) => (isNum(now) && isNum(then) ? now - then : null);
const scoreText = (v) => (isNum(v) ? String(v) : '—');

/* What has changed since the screen was saved: companies that entered, that
   dropped out, and matches whose scores moved under a new model version. */
function screenDiff(saved) {
  const snapMatches = saved.snapshot?.matches || [];
  const now = U.filter(r => evaluateScreen(r, saved.def).pass);
  const before = new Set(snapMatches.map(m => m.id));
  const nowIds = new Set(now.map(r => r.c.id));
  return {
    now,
    entered: now.filter(r => !before.has(r.c.id)),
    left: snapMatches.filter(m => !nowIds.has(m.id)),
    rescored: now.map(r => {
      const m = snapMatches.find(x => x.id === r.c.id);
      if (!m) return null;
      const dq = scoreDelta(r.scores.quality.score, m.quality), dv = scoreDelta(r.scores.value.score, m.value);
      return (dq || dv) ? { r, m, dq, dv } : null;
    }).filter(Boolean),
    modelChanged: saved.snapshot?.model !== MODEL_VERSION,
  };
}

function saveScreen() {
  if (State.savedScreens.length >= lim('savedScreens')) {
    toast(`The ${planOf().name} plan saves ${lim('savedScreens')} screen${lim('savedScreens') === 1 ? '' : 's'}`); go('plans'); return;
  }
  const name = prompt('Name this screen', `Screen ${State.savedScreens.length + 1}`);
  if (!name) return;
  const def = JSON.parse(JSON.stringify(State.screen));
  /* The currency a money threshold was typed in travels with the screen. */
  def.moneyCcy = screenMoneyCcy(def);
  const snapshot = screenSnapshot(def);
  State.savedScreens = [...State.savedScreens, {
    name, def, snapshot, alertOnMatch: true, asOf: snapshot.asOf, model: snapshot.model }];
  store.write('savedScreens', State.savedScreens);
  toast(`Saved "${name}" — ${snapshot.matches.length} matches frozen with their scores`);
  render();
}

function openSavedScreen(idx) {
  const s = State.savedScreens[idx];
  const diff = screenDiff(s);
  const body = el('div');
  body.append(el('h3', { class: 'h-section', style: 'margin-bottom:2px' }, s.name));
  body.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' },
    `Saved ${s.snapshot?.saved ?? s.asOf} · as of ${s.snapshot?.asOf ?? s.asOf} · ${s.snapshot?.model ?? s.model}`));

  if (diff.modelChanged) body.append(el('div', { class: 'guardrail', style: 'margin-bottom:var(--md)',
    html: `${icon('alert')}<span>The model version has changed since this screen was saved. Scores below are shown both as saved and as they stand now.</span>` }));

  const stat = el('div', { class: 'grid g-3', style: 'margin-bottom:var(--md)' });
  [['Matches when saved', String((s.snapshot?.matches || []).length)],
   ['Matches now', String(diff.now.length)],
   ['New since saved', String(diff.entered.length)]]
   .forEach(([l, v]) => stat.append(el('div', { class: 'panel' }, statTile(l, v))));
  body.append(stat);

  const section = (title, note, node) => {
    body.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, title));
    if (note) body.append(el('p', { class: 'metaline', style: 'margin-bottom:6px' }, note));
    body.append(node);
  };

  if (diff.entered.length) {
    const l = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    diff.entered.forEach(r => l.append(el('div', { class: 'evidence support', style: 'font-size:13px' },
      `${r.c.tk} — ${r.c.name} now clears every criterion.`)));
    section('Entered the screen', null, l);
  }
  if (diff.left.length) {
    const l = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    diff.left.forEach(m => l.append(el('div', { class: 'evidence counter', style: 'font-size:13px' },
      `${m.tk} no longer clears the criteria it met when this screen was saved.`)));
    section('Dropped out', null, l);
  }
  if (!diff.entered.length && !diff.left.length) {
    section('Membership', null, el('p', { class: 'body', style: 'font-size:13px' },
      'No company has entered or left this screen since it was saved. On a live data feed this is where new entrants would appear.'));
  }

  /* As-saved vs now, side by side — the reproducibility check. */
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, ['Company', 'Quality as saved', 'Quality now', 'Value as saved', 'Value now'].map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, (s.snapshot?.matches || []).map(m => {
    /* An absent score is a dash on both sides, never the word "null" — the
       115 unpriced filers carry no value score, and every one of them read
       "null" as saved and "null" now. */
    const live = BY_ID.get(m.id);
    const dq = live ? scoreDelta(live.scores.quality.score, m.quality) : null;
    const dv = live ? scoreDelta(live.scores.value.score, m.value) : null;
    return el('tr', {}, [
      el('td', { class: 'ident' }, m.tk),
      el('td', {}, scoreText(m.quality)),
      el('td', { class: dq ? signClass(dq) : '' }, live ? `${scoreText(live.scores.quality.score)}${dq ? ` (${withSign(dq, 0, '')})` : ''}` : '—'),
      el('td', {}, scoreText(m.value)),
      el('td', { class: dv ? signClass(dv) : '' }, live ? `${scoreText(live.scores.value.score)}${dv ? ` (${withSign(dv, 0, '')})` : ''}` : '—'),
    ]);
  })));
  tw.append(t);
  section('Reproducibility check', 'The same saved definition, run against the stored scores and against today’s. Identical columns mean the screen reproduces exactly.', tw);

  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--lg)' });
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    /* Loaded criteria take the currency they were saved in onto the toggle,
       so the thresholds and the table beside them read in the same one. */
    const def = JSON.parse(JSON.stringify(s.def));
    if (def.moneyCcy) { State.screenCcy = def.moneyCcy; store.write('screenCcy', def.moneyCcy); delete def.moneyCcy; }
    State.screen = def; closeDrawer(); render(); toast(`Loaded "${s.name}"`);
  } }, 'Load these criteria'));
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    s.snapshot = screenSnapshot(s.def); store.write('savedScreens', State.savedScreens);
    closeDrawer(); render(); toast('Snapshot refreshed to today');
  } }, 'Mark reviewed — refresh snapshot'));
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    State.savedScreens = State.savedScreens.filter((_, i) => i !== idx);
    store.write('savedScreens', State.savedScreens); closeDrawer(); render(); toast('Screen deleted');
  } }, 'Delete'));
  body.append(acts);
  openDrawer('Saved screen', body);
}

function exportScreen() {
  if (!lim('exports')) { toast('Exports are part of Equities Research'); go('plans'); return; }
  const sc = State.screen;
  /* In the order on screen, with money as the table shows it and every column
     carrying its unit. The file used to come out in universe order, print
     market cap raw in each company's own currency under a bare "mcap", and
     claim a screen definition it did not contain. */
  const rows = sortScreenRows(U.filter(r => evaluateScreen(r, sc).pass), sc);
  const ccy = screenCcy();
  const unitOf = (f) => {
    if (f.money) return ccy === 'local' ? 'bn_local' : `bn_${ccy}`;
    /* Read off the formatter the table uses, so the header cannot name a
       different unit from the cell. */
    const s = String(f.fmt(1));
    return s.endsWith('%') ? 'pct' : s.endsWith('×') ? 'x' : null;
  };
  const metricVal = (r, k) => {
    const f = FIELD_BY_K[k];
    const v = f.money && ccy !== 'local' ? convertTo(r.m[k], r.c.ccy, ccy) : r.m[k];
    return isNum(v) ? v.toFixed(3) : '';
  };
  const csv = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const cols = ['ticker', 'name', 'market', 'currency', 'source', 'price_local', 'quality_score', 'value_score', 'mos_vs_base_pct',
    ...sc.cols.map(k => { const u = unitOf(FIELD_BY_K[k]); return u ? `${k}_${u}` : k; }), 'coverage_pct'];
  const lines = [cols.join(',')];
  rows.forEach(r => lines.push([
    r.c.tk, csv(r.c.name), r.c.mkt, r.c.ccy,
    r.c.real ? (r.c.personal ? 'statements you supplied (personal research)' : 'SEC EDGAR companyfacts') : 'illustrative (synthetic)',
    isNum(r.c.px?.p) ? r.c.px.p : '',
    isNum(r.scores.quality.score) ? r.scores.quality.score : '', isNum(r.scores.value.score) ? r.scores.value.score : '',
    isNum(r.val.mos?.base) ? r.val.mos.base.toFixed(2) : '',
    ...sc.cols.map(k => metricVal(r, k)), r.m.coverage,
  ].join(',')));
  lines.push('');
  lines.push(`# Quantum Tradeworks screen export · ${MODEL_VERSION}`);
  /* The definition, as the chips above the results state it, and whole as
     JSON so it can be loaded back or compared. */
  lines.push(`# Screen: ${sc.mode === 'pct' ? 'peer-percentile thresholds' : 'absolute thresholds'}; universe ${sc.universe}`);
  const filters = activeFilters(sc);
  if (filters.length) filters.forEach(a => lines.push(`# Criterion: ${a.label}`));
  else lines.push('# Criterion: none — every company in the universe');
  lines.push(`# Money columns: ${ccy === 'local' ? 'each company’s own currency, not converted' : `converted to ${ccy} at USD/MYR ${FX.USDMYR.toFixed(4)}${FX.asOf ? `, ${FX.asOf}` : ''}`}`);
  lines.push(`# Sorted by: ${sc.sort.k}, ${sc.sort.dir === 1 ? 'ascending' : 'descending'}`);
  lines.push(`# Definition (JSON): ${JSON.stringify({ ...sc, moneyCcy: screenMoneyCcy(sc) })}`);
  lines.push(`# ${coverageSentence('source')}`);
  lines.push('# Research only. Not for investment use.');
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'quantum-tradeworks-screen.csv' });
  document.body.append(a); a.click(); a.remove();
  toast(`Exported ${rows.length} rows with the screen definition`);
}

/* ------------------------------------------------------------ Value Radar */
/* yi is an index into YEARS: the fiscal year the radar is drawn as of. */
State.radar = { universe:'all', colorBy:'market', minConf:'all', yi:YEARS.length - 1, cohort:'market' };
const RADAR_MIN_YI = YEARS.length - 5;   /* keep at least six periods in every snapshot */

function renderRadar() {
  const rr = State.radar;
  const wrap = el('div');

  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('h2', { class: 'h-section' }, 'Quality vs Value Map'),
    el('p', { class: 'body', style: 'margin-top:4px' },
      'Quality against modelled valuation. Position is the answer; size is scale; colour is the chosen grouping. A mark far right on a low-confidence model is not the same finding as one on a high-confidence model.'),
  ]));
  wrap.append(hd);

  /* one filter row above everything it scopes */
  const bar = el('div', { class: 'card', style: 'padding:var(--sm) var(--md);margin-bottom:var(--md)' });
  const barRow = el('div', { class: 'row row-wrap', style: 'gap:var(--md)' });
  const mkSeg = (label, key, opts) => {
    const g = el('div', { class: 'row', style: 'gap:8px' });
    g.append(el('span', { class: 'caption', style: 'font-weight:600' }, label));
    g.append(el('div', { class: 'segmented' }, opts.map(([v, l]) =>
      el('button', { 'aria-selected': rr[key] === v ? 'true' : 'false', onclick: () => { rr[key] = v; render(); } }, l))));
    return g;
  };
  barRow.append(mkSeg('Universe', 'universe', [['all', 'All'], ['US', 'US'], ['MY', 'Bursa'], ['watchlist', 'Watchlist']]));
  barRow.append(mkSeg('Colour by', 'colorBy', [['market', 'Market'], ['risk', 'Risk band']]));
  barRow.append(mkSeg('Confidence', 'minConf', [['all', 'All'], ['med', 'Medium +'], ['high', 'High only']]));
  /* Sector-relative vs market-absolute: the same quality score, ranked against
     a different cohort. A utility looks unremarkable against the whole market
     and strong against other utilities — both readings are legitimate. */
  barRow.append(mkSeg('Quality cohort', 'cohort', [['market', 'Market-absolute'], ['sector', 'Sector-relative']]));
  bar.append(barRow);

  /* Time slider — each stop re-runs the whole derivation against statements
     truncated to that fiscal year and the price that applied then. */
  const timeRow = el('div', { class: 'row row-wrap', style: 'gap:var(--md);margin-top:10px;padding-top:10px;border-top:1px solid var(--grid)' });
  timeRow.append(el('span', { class: 'caption', style: 'font-weight:600' }, 'As of'));
  /* The chip follows the slider as it moves; the map is re-derived on change,
     and focus returns to the slider — re-rendering on every input event
     replaced it under a drag and dropped keyboard focus to the page. */
  const yiChip = el('span', { class: 'chip chip-brand' }, rr.yi === YEARS.length - 1 ? 'Latest' : `FY${YEARS[rr.yi]}`);
  const slider = el('input', { type: 'range', id: 'radarYear', min: RADAR_MIN_YI, max: YEARS.length - 1, step: 1, value: rr.yi,
    style: 'max-width:260px', 'aria-label': 'Fiscal year the radar is drawn as of',
    oninput: e => { const v = +e.target.value; yiChip.textContent = v === YEARS.length - 1 ? 'Latest' : `FY${YEARS[v]}`; },
    onchange: e => { rr.yi = +e.target.value; renderKeepFocus(); } });
  timeRow.append(slider);
  timeRow.append(yiChip);
  timeRow.append(el('span', { class: 'metaline' },
    rr.yi === YEARS.length - 1
      ? 'Latest reported period, current price.'
      : `Statements truncated to FY${YEARS[rr.yi]}, priced from the illustrative set's sample series for that year — the same models re-run, not today's answer replotted. Filed companies carry no sample series and drop out of past snapshots.`));
  bar.append(timeRow);
  wrap.append(bar);

  const asOfRows = universeAsOf(rr.yi);
  let scoped = asOfRows;
  if (rr.universe === 'US' || rr.universe === 'MY') scoped = scoped.filter(r => r.c.mkt === rr.universe);
  if (rr.universe === 'watchlist') scoped = scoped.filter(r => State.watchlist.includes(r.c.id));
  let rows = scoped.filter(r => r.val.mos);
  /* Who is not on the map, and why. At the latest stop 115 filed companies
     carry no price, so there is no difference to a model estimate to plot —
     and "23 eligible" under a 138-company universe said nothing about the
     other 115. The past-year text already named its drop-out; now the
     default view does too. */
  const unplotted = scoped.length - rows.length;
  const unpriced = scoped.filter(r => !r.val.mos && !isNum(r.price)).length;
  if (rr.minConf === 'med') rows = rows.filter(r => r.val.confBand !== 'Low');
  if (rr.minConf === 'high') rows = rows.filter(r => r.val.confBand === 'High');

  const RISK_VAR = { Low:'--seq-6', Medium:'--seq-4', High:'--seq-2' };
  const yOf = (r) => (rr.cohort === 'sector' ? r.qpctSector : r.qpctMarket) ?? 50;
  const points = rows.map(r => ({
    id: r.c.id, label: r.c.tk, name: r.c.name,
    x: r.val.mos.base, y: yOf(r), size: toBase(r.d.m.mcap, r.c.ccy),
    capLabel: fmtCap(toBase(r.d.m.mcap, r.c.ccy), State.baseCcy),
    model: r.val.pack.name, conf: r.val.confBand,
    varName: rr.colorBy === 'market' ? (r.c.mkt === 'US' ? '--s1' : '--s2')
                                     : RISK_VAR[BY_ID.get(r.c.id).risk.band],
  }));

  const card = el('div', { class: 'card' });
  const plot = el('div', { style: 'width:100%' });
  card.append(plot);

  /* legend is always present for two or more groups */
  const leg = el('div', { class: 'legend', style: 'margin-top:var(--sm);padding-top:var(--sm);border-top:1px solid var(--grid)' });
  if (rr.colorBy === 'market') {
    [['--s1', 'United States'], ['--s2', 'Bursa Malaysia']].forEach(([v, l]) =>
      leg.append(el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(${v})"></span>${l}` })));
  } else {
    [['--seq-6', 'Low risk'], ['--seq-4', 'Medium risk'], ['--seq-2', 'High risk']].forEach(([v, l]) =>
      leg.append(el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(${v})"></span>${l}` })));
  }
  leg.append(el('span', { class: 'legend-item', style: 'margin-left:auto' , html: `<span class="legend-key" style="background:var(--ink-3);width:6px;height:6px;border-radius:50%"></span>Mark area = market capitalisation in ${State.baseCcy}` }));
  card.append(leg);
  card.append(el('div', { style: 'margin-top:var(--sm)' },
    el('div', { class: 'prov', html: [
      `<b>Period</b> ${rr.yi === YEARS.length - 1 ? 'latest reported for each company' : `FY${YEARS[rr.yi]} reported`}`,
      `<b>Price</b> ${rr.yi === YEARS.length - 1 ? 'each company’s own basis — sample figure, entered close or end-of-day file, as its page states' : `sample series, FY${YEARS[rr.yi]}`}`,
      `<b>Cohort</b> ${rr.cohort === 'sector' ? 'sector-relative' : 'market-absolute'}`,
      `<b>Universe</b> ${rows.length} eligible of ${scoped.length}`,
      `<b>Model</b> ${MODEL_VERSION}`,
    ].join('<span class="dotsep"></span>') })));
  if (unplotted) card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    `${unplotted} of ${scoped.length} companies in this universe are not plotted: ${unpriced} carry no price${rr.yi === YEARS.length - 1 ? '' : ` for FY${YEARS[rr.yi]}`}, so no difference to a model estimate can be computed${unplotted > unpriced ? `; ${unplotted - unpriced} have a price but no base-case model estimate` : ''}.`));

  /* The table prints the percentile that exists, or says there is none. The
     midpoint is a plotting position for a company with no sector peers, and
     printed as "50" it read as a measured median rank. */
  const pctText = (r) => { const p = rr.cohort === 'sector' ? r.qpctSector : r.qpctMarket; return isNum(p) ? String(p) : `— (no ${rr.cohort === 'sector' ? 'sector peers' : 'rank'})`; };
  card.append(tableTwin('Show the table view of every plotted company',
    ['Company', 'Market', rr.yi === YEARS.length - 1 ? 'Price' : `Price FY${YEARS[rr.yi]}`, 'vs base-case model estimate', 'Quality pct', 'Market cap', 'Model', 'Confidence'],
    rows.map(r => [`${r.c.tk} — ${esc(r.c.name)}${illusText(r.c)}`, r.c.mkt, fmtMoney(r.price, r.c.ccy),
      withSign(r.val.mos.base, 1), pctText(r),
      fmtCap(toBase(r.d.m.mcap, r.c.ccy), State.baseCcy), esc(r.val.pack.name), r.val.confBand])));
  wrap.append(card);

  const cohortLabel = rr.cohort === 'sector' ? 'sector' : 'market';
  scatterChart(plot, {
    points,
    xLabel: 'Difference to model estimate vs base-case value — right of the line is below it, left is above it',
    xLabelShort: 'Difference to model estimate vs base-case model estimate',
    yLabel: `Quality percentile within ${cohortLabel} cohort`,
    yLabelShort: `Quality percentile (${cohortLabel})`,
    xFmt: v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
    onPick: id => openRadarDetail(id, rr.yi),
  });

  if (rr.cohort === 'sector') {
    const thin = rows.filter(r => r.qpctSector == null).length;
    if (thin) wrap.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      `${thin} of ${rows.length} companies have fewer than two peers in their sector within this sample, so no sector percentile can be computed for them. They are plotted at the midpoint rather than dropped, and should be read as "no sector ranking available".`));
  }
  wrap.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Language note: a mark on the right edge is the largest modelled discount among eligible companies — not "the most undervalued". Confidence and model applicability qualify every position.'));
  return wrap;
}

function openRadarDetail(id, yi = YEARS.length - 1) {
  const snap = universeAsOf(yi).find(x => x.id === id);
  const live = BY_ID.get(id);
  const r = snap || live;
  const latest = yi === YEARS.length - 1;
  const body = el('div');
  body.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:4px' }, [
    el('h3', { class: 'h-section' }, r.c.tk), illusChip(r.c), marketChip(r.c.mkt), el('span', { class: 'chip' }, r.c.sector),
    latest ? null : el('span', { class: 'chip chip-brand' }, `As of FY${YEARS[yi]}`)]));
  body.append(el('p', { class: 'caption', style: 'margin-bottom:var(--md)' }, r.c.name));

  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  [['Model pack selected', r.val.pack.name],
   ['Selection reason', r.val.pack.why],
   ['Data date', latest ? `FY${latestFy(r.c)} reported · price ${priceAsOfLabel(r.c)}` : `FY${YEARS[yi]} reported · price from the sample series for FY${YEARS[yi]}`],
   ['Price used', fmtMoney(r.price ?? r.c.px.p, r.c.ccy)],
   ['Confidence', `${r.val.confBand} (${r.val.conf}/100)`],
   ['Coverage', `${r.d.m.coverage}% of applicable metrics computable`]]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, v)); });
  body.append(kv);

  body.append(el('h4', { class: 'h-card', style: 'margin-bottom:6px' }, 'Three largest drivers of the range'));
  const drivers = driverImpact(r.c, r.d, r.inputs).slice(0, 3);
  const dl = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-bottom:var(--md)' });
  drivers.forEach(d => dl.append(el('div', { class: 'evidence support' },
    `${d.label} — a ${d.unit === 'pp' ? fmtNum(d.step, 2) + ' point' : d.unit} move changes the base-case model estimate by about ${fmtNum(d.span, 1)}%.`)));
  body.append(dl);

  /* Movement between the selected snapshot and today, so the slider answers
     "how did this position change" rather than only "where was it". */
  if (!latest) {
    body.append(el('h4', { class: 'h-card', style: 'margin-bottom:6px' }, `Movement from FY${YEARS[yi]} to today`));
    const mv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
    /* Each change only where both ends exist — `?? 0` turned a company with
       no estimate today into a move of its whole former difference. The model
       difference is in percentage points ("+21.1% points" doubled the unit)
       and takes diffClass, not the green of a gain: a wider gap to a model
       estimate is not a profit. The class is read from the number, not
       re-parsed from the text, where "−3.1" (a true minus) parsed as NaN and
       left every fall unclassed. */
    const dMos = scoreDelta(live.val.mos?.base, r.val.mos?.base);
    const dQ = scoreDelta(live.scores.quality.score, r.q.score);
    const dPx = isNum(live.c.px?.p) && isNum(r.price) && r.price > 0 ? (live.c.px.p - r.price) / r.price * 100 : null;
    [['Difference to model estimate', isNum(dMos) ? `${withSign(dMos, 1, '')} points` : '—', diffClass(dMos)],
     ['Quality score', withSign(dQ, 0, ''), signClass(dQ)],
     ['Price', withSign(dPx, 1), signClass(dPx)]]
     .forEach(([k, v, cls]) => { mv.append(el('dt', {}, k)); mv.append(el('dd', { class: cls }, v)); });
    body.append(mv);
  }

  body.append(el('h4', { class: 'h-card', style: 'margin-bottom:6px' }, 'What changed in the latest reported year'));
  const ch = changeSummary(r.c) || [];
  const cl = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  ch.forEach(x => { cl.append(el('dt', {}, x.label)); cl.append(el('dd', { class: signClass(x.v), title: x.withheld || null }, changeCell(x))); });
  body.append(cl);

  const acts = el('div', { class: 'row', style: 'gap:8px' });
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => { closeDrawer(); openResearch(id, 'valuation'); } }, 'Open Valuation Studio'));
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => toggleWatch(id) }, State.watchlist.includes(id) ? 'On watchlist' : 'Add to watchlist'));
  body.append(acts);
  openDrawer('Valuation detail', body);
}

/* --------------------------------------------------------- Research screens */
/* Every theme is a set of published rules evaluated against the dataset —
   there is no hidden list.

   Exclusions follow the same rule as inclusions. `excl` lists only those the
   test evaluates; `exclUntested` lists those it cannot — a yield trap, a
   special dividend, a debt-funded buyback, a going-concern note are not lines
   this dataset carries — and the Rules drawer marks them "Not evaluated", as
   it does untested inclusion rules. Stating an exclusion as applied when no
   test reads it is the same failure as stating a rule that is not tested.

   There is no rebalance schedule either. Membership is recomputed from the
   stored data every time the page loads; each card used to say "rebalanced
   quarterly", which described a process that does not exist. */
const THEMES = [
  { id:'compounders', name:'High-Quality Compounders', mkt:'Both',
    rules:['Return on invested capital above 12%', 'Operating margin above 15%', 'Free cash flow positive in the latest year', 'Net debt below 3× EBIT'],
    excl:['Banks and REITs (return on invested capital is not meaningful)', 'Revenue drawdown above 25% in the window'],
    test:r => r.c.type !== 'bank' && r.c.type !== 'reit' && r.m.roic > 12 && r.m.om > 15 && r.m.fcf > 0 && (r.m.ndEbit ?? 99) < 3 && r.m.revDD < 25 },
  { id:'divdur', name:'Dividend Durability', mkt:'Both',
    rules:['Dividend yield above 2.5%', 'Dividends below 85% of free cash flow, or a bank below an 85% payout', 'Net debt below 3.5× EBIT where applicable'],
    excl:['Companies whose dividends exceed free cash flow'],
    exclUntested:['One-off or special distributions — the dataset carries one dividend per share a year and does not separate a special payment from the regular one'],
    /* An unknown leverage figure does not clear a leverage rule: `?? 99`,
       as the neighbouring themes read it, not `?? 0`. But "where applicable"
       is part of the rule: net debt to EBIT has no meaning on a bank balance
       sheet (INAPPLICABLE), and `?? 99` failed every bank — so the bank
       branch of the payout rule could never admit anyone. */
    test:r => r.m.dy > 2.5 && ((isNum(r.m.cashPayout) && r.m.cashPayout < 85) || (r.c.type === 'bank' && (r.m.payout ?? 99) < 85))
      && ((INAPPLICABLE[r.c.type] || []).includes('ndEbit') || (r.m.ndEbit ?? 99) < 3.5) },
  { id:'divgrow', name:'Dividend Growth', mkt:'Both',
    rules:['Dividend per share CAGR above 5% over four years', 'Earnings CAGR above 3%', 'Payout ratio below 75%'],
    exclUntested:['Yield traps — a rising yield driven by a falling price with flat dividends. Rising dividends are required above, but the price path behind the yield is not tested'],
    test:r => (r.m.dps5 ?? -9) > 5 && (r.m.eps5 ?? -9) > 3 && (r.m.payout ?? 99) < 75 },
  { id:'qafp', name:'Quality at a Fair Price', mkt:'Both',
    rules:['Quality score above 60', 'Trading at or below the base-case value', 'Valuation confidence Medium or better'],
    excl:['Low-confidence valuations', 'Companies with data completeness below 70%'],
    test:r => r.scores.quality.score > 60 && (r.val.mos?.base ?? -99) > 0 && r.val.confBand !== 'Low' && r.m.coverage >= 70 },
  /* A rule the test does not evaluate is listed as such, under its own
     heading on the card — a theme that tests two rules and states three is
     the failure the section-18.1 template names. */
  { id:'netcash', name:'Net-Cash Growth', mkt:'Both',
    rules:['Cash exceeds total debt', 'Revenue CAGR above 6%'],
    untested:['Operating margin improving over the window — the margin path is not a screener field yet, so this is stated for the reader to check, not evaluated'],
    excl:['Banks and REITs'],
    exclUntested:['Cash offset by material lease or pension obligations — neither line is carried, so the net cash position is cash against borrowings only'],
    test:r => r.c.type !== 'bank' && r.c.type !== 'reit' && r.m.netCash === true && (r.m.rev5 ?? -9) > 6 },
  { id:'recovery', name:'Recovery Watch', mkt:'Both',
    rules:['Revenue drawdown above 20% in the window', 'Latest-year operating profit improving', 'Free cash flow positive in the latest year'],
    excl:['PN17 status', 'Severe dilution above 3% a year'],
    exclUntested:['Unresolved going-concern opinions — auditor opinions are not in the dataset'],
    /* A withheld dilution rate — the share series crosses a split — does not
       satisfy "not severely diluting"; it is unknown, and unknown fails. */
    test:r => (r.m.revDD ?? 0) > 20 && last(r.d.ebit) > r.d.ebit[r.d.ebit.length - 2] && (r.m.fcf ?? -1) > 0 && !r.c.flags.pn17 && (r.m.dilution ?? 99) < 3 },
  { id:'reit', name:'Bursa REIT Income', mkt:'MY',
    rules:['Malaysian REIT', 'Occupancy above 92%', 'Gearing below 40%', 'AFFO covers the distribution'],
    excl:['REITs with gearing near the regulatory ceiling'],
    exclUntested:['Income from asset revaluation presented as recurring — the dataset carries distribution cover, not the make-up of income'],
    test:r => r.c.mkt === 'MY' && r.c.type === 'reit' && r.m.occ > 92 && r.m.gearing < 40 && (r.m.dpuCover ?? 0) > 100 },
  { id:'bank', name:'Bursa Bank Quality', mkt:'MY',
    rules:['Malaysian bank', 'Return on equity above 9%', 'CET1 above 13%', 'Gross impaired loans below 2%'],
    excl:['Banks with incomplete capital or asset-quality disclosure'],
    test:r => r.c.mkt === 'MY' && r.c.type === 'bank' && r.m.roe > 9 && r.m.cet1 > 13 && r.m.npl < 2 },
  { id:'capreturn', name:'US Capital Return', mkt:'US',
    rules:['US listed', 'Share count falling', 'Free cash flow positive in the latest year', 'Net debt below 3× EBIT'],
    untested:['Free cash flow covers dividends and buybacks — the buyback outflow is not a line this dataset carries, so cover is stated for the reader to check, not evaluated'],
    excl:['Buybacks that only offset share-based compensation (tested through the share count: a buyback that only offsets issuance does not make it fall)'],
    exclUntested:['Debt-funded buybacks — the financing of a buyback is not a line this dataset carries'],
    test:r => r.c.mkt === 'US' && (r.m.buyback ?? -9) > 0.3 && (r.m.fcf ?? -1) > 0 && (r.m.ndEbit ?? 99) < 3 },
  { id:'shariah', name:'Shariah-Compliant Quality', mkt:'MY',
    rules:['Shariah-compliant in this sample dataset', 'Quality score above 50', 'Net debt below 3× EBIT'],
    exclUntested:['Companies whose Shariah status changed in the last review cycle — the dataset carries the current flag only, not its history'],
    test:r => r.c.flags.shariah === true && r.scores.quality.score > 50 && (r.m.ndEbit ?? 99) < 3 },
];

function renderIdeas() {
  const wrap = el('div');
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('h2', { class: 'h-section' }, 'Research screens'),
    el('p', { class: 'body', style: 'margin-top:4px' },
      'Each screen is a published rule set run against the universe. It is not a list of suggestions, and membership is not curated — a company appears because it clears the rules stated on the card, and a screen with no members is shown empty rather than loosened to fill the page. Clearing a screen is a fact about a company, not a view about it.'),
  ])));

  /* Themes vary a lot in constituent count, so a two-column masonry keeps the
     cards tight to their content instead of stretching short ones to match. */
  const grid = el('div', { class: 'masonry-2' });
  THEMES.forEach(t => {
    const members = U.filter(r => { try { return t.test(r); } catch { return false; } });
    const card = el('div', { class: 'card' });
    const hd = el('div', { class: 'card-hd card-hd-tight' });
    hd.append(el('div', {}, [
      el('div', { class: 'row', style: 'gap:6px;margin-bottom:2px' }, [
        el('h3', { class: 'h-card' }, t.name),
        t.mkt !== 'Both' ? marketChip(t.mkt) : null,
      ]),
      el('p', { class: 'metaline' }, `${members.length} constituent${members.length === 1 ? '' : 's'} · recomputed at page load`),
    ]));
    hd.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openThemeDetail(t, members) }, 'Rules'));
    card.append(hd);

    if (!members.length) {
      card.append(el('p', { class: 'caption', style: 'padding:var(--md) 0' }, 'No company in the universe carried here currently meets every rule. The theme is shown empty rather than relaxed.'));
    } else {
      const l = el('div', { style: 'display:flex;flex-direction:column;margin-top:6px' });
      members.slice(0, 5).forEach((r, i) => {
        /* theme-row: the name column shrinks and the sparkline drops on a
           phone, so price and model difference stay inside a 360px screen. */
        const row = el('div', { class: 'row theme-row', style: `gap:10px;padding:7px 0;${i ? 'border-top:1px solid var(--grid)' : ''}` });
        row.append(tickerCell(r));
        row.append(el('span', { class: 'spacer' }));
        row.append(sparkline(priceHistory(r.c)));
        row.append(el('span', { class: 'num', style: 'font-size:13px;font-weight:600;min-width:64px;text-align:right' }, fmtMoney(r.c.px.p, r.c.ccy)));
        row.append(el('span', { class: 'num ' + diffClass(r.val.mos?.base), style: 'font-size:12px;min-width:52px;text-align:right' }, withSign(r.val.mos?.base, 0)));
        l.append(row);
      });
      card.append(l);
      if (members.length > 5) card.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, `+ ${members.length - 5} more — open the rules panel for the full constituent list.`));
    }
    grid.append(card);
  });
  wrap.append(grid);
  return wrap;
}

function openThemeDetail(t, members) {
  const body = el('div');
  body.append(el('h3', { class: 'h-section', style: 'margin-bottom:var(--sm)' }, t.name));

  body.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Inclusion rules'));
  const inc = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px;margin-bottom:var(--md)' });
  t.rules.forEach(r => inc.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, r)));
  (t.untested || []).forEach(r => inc.append(el('li', { class: 'evidence', style: 'font-size:13px', title: 'Stated on the card, not evaluated by the test — a company shown here has not been checked against this rule.' }, `Not evaluated: ${r}`)));
  body.append(inc);

  body.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Exclusions'));
  const exc = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px;margin-bottom:var(--md)' });
  (t.excl || []).forEach(r => exc.append(el('li', { class: 'evidence counter', style: 'font-size:13px' }, r)));
  (t.exclUntested || []).forEach(r => exc.append(el('li', { class: 'evidence', style: 'font-size:13px', title: 'Stated on the card, not evaluated by the test — a company shown here has not been checked against this exclusion.' }, `Not evaluated: ${r}`)));
  body.append(exc);

  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  [['Membership', 'Recomputed from the stored data every time the page loads. There is no rebalance schedule.'], ['Data timestamp', 'Each company’s latest reported fiscal year; filed statements as retrieved from EDGAR, the illustrative set as of its fixed stamp — stated on each company’s page'],
   ['Model version', MODEL_VERSION], ['Turnover', 'Not shown — this prototype holds a single point in time'],
   ['Backtest', 'Not shown. A return series without delisting, survivorship, lag, cost and rebalance assumptions would mislead.']]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, v)); });
  body.append(kv);

  body.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, `Current constituents (${members.length})`));
  const tw = el('div', { class: 'tablewrap' });
  const tab = el('table', { class: 'dt' });
  tab.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Company'), el('th', {}, 'Quality'), el('th', {}, 'Yield'), el('th', {}, 'vs base')])));
  tab.append(el('tbody', {}, members.map(r => el('tr', {}, [
    el('td', { class: 'ident' }, r.c.tk + illusText(r.c)), el('td', {}, scoreText(r.scores.quality.score)),
    el('td', {}, fmtPct(r.m.dy, 2)), el('td', { class: diffClass(r.val.mos?.base) }, withSign(r.val.mos?.base, 0)),
  ]))));
  tw.append(tab); body.append(tw);

  body.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    `Limitations: the universe carried here is ${U.length} companies, so a theme can be empty or narrow. Constituency is computed live from the rules above — it is not a curated list.`));
  openDrawer('Theme rules', body);
}

/* ---------------------------------------------------------------- Heatmap */
State.heat = { mode:'d1', universe:'all' };
/* `fmt` prints a tile's level; `dfmt` prints a difference between two levels,
   which is what the attribution components are. The quality mode stores the
   score less 50 so the diverging scale centres on the midpoint, and its fmt
   adds the 50 back — which, applied to a component, printed a −3 point market
   component as "47". `price` separates the modes that are moves in a price
   from the two that are levels of a model output: a level is not a move, and
   the drawer does not call it one.

   "Today" was a label on a fixed-date change: c.px.d1 is a sample figure for
   the illustrative set and a price-file field for filers, and neither
   advances. It is the change against the previous close, as of the price
   date the caption states. */
const HEAT_MODES = [
  { id:'d1',  label:'Day change',   get:r => r.c.px.d1,  full:3,  fmt:v => withSign(v, 2), price:true },
  { id:'m1',  label:'1 month',      get:r => r.c.px.m1,  full:8,  fmt:v => withSign(v, 1), price:true },
  { id:'m3',  label:'3 months',     get:r => r.c.px.m3,  full:15, fmt:v => withSign(v, 1), price:true },
  { id:'m12', label:'12 months',    get:r => r.c.px.m12, full:35, fmt:v => withSign(v, 0), price:true },
  { id:'val', label:'vs base-case model estimate',get:r => r.val.mos?.base, full:40, fmt:v => withSign(v, 0), dfmt:v => withSign(v, 0, ' pts') },
  { id:'qual',label:'Quality score',get:r => isNum(r.scores.quality.score) ? r.scores.quality.score - 50 : null, full:50, fmt:v => String(Math.round(v + 50)), dfmt:v => withSign(v, 0, ' pts') },
];

/* Move attribution: market component, sector component, then the residual. */
function attribution(row, mode) {
  const m = HEAT_MODES.find(x => x.id === mode);
  /* No observed change, no attribution: `?? 0` drew a priced filer with no
     day change as an exactly-0.00% mover and then explained the move. */
  const val = m.get(row);
  if (!isNum(val)) return null;
  const peersMkt = U.filter(r => r.c.mkt === row.c.mkt && isNum(m.get(r)) && isNum(r.m.mcap));
  const capW = (arr) => { const tot = sum(arr.map(r => r.m.mcap)); return tot > 0 ? sum(arr.map(r => m.get(r) * r.m.mcap)) / tot : 0; };
  const market = capW(peersMkt);
  const peersSec = peersMkt.filter(r => r.c.sector === row.c.sector);
  const sector = peersSec.length > 1 ? capW(peersSec) - market : 0;
  const specific = val - market - sector;
  const docs = documents(row.c);
  return { val, market, sector, specific, doc: docs[0], m };
}

function renderHeatmap() {
  const st = State.heat;
  const wrap = el('div');
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('h2', { class: 'h-section' }, 'Heatmap'),
    el('p', { class: 'body', style: 'margin-top:4px' },
      'Tile area is market capitalisation; fill is the selected measure on a diverging scale with a neutral midpoint. Select a tile, with the pointer or with Tab and Enter, for how its figure splits into market, sector and company parts.'),
  ])));

  const bar = el('div', { class: 'card', style: 'padding:var(--sm) var(--md);margin-bottom:var(--md)' });
  const row = el('div', { class: 'row row-wrap', style: 'gap:var(--md)' });
  row.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('span', { class: 'caption', style: 'font-weight:600' }, 'Measure'),
    el('div', { class: 'segmented' }, HEAT_MODES.map(m =>
      el('button', { 'aria-selected': st.mode === m.id ? 'true' : 'false', onclick: () => { st.mode = m.id; render(); } }, m.label))),
  ]));
  row.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('span', { class: 'caption', style: 'font-weight:600' }, 'Universe'),
    /* Named for what they filter — the market — as on the value map. "FBM
       KLCI" drew eighteen Bursa tiles, four of them not index constituents;
       "S&P 500" was every US row carried here. */
    el('div', { class: 'segmented' }, [['all', 'All'], ['US', 'US'], ['MY', 'Bursa'], ['watchlist', 'Watchlist']].map(([v, l]) =>
      el('button', { 'aria-selected': st.universe === v ? 'true' : 'false', onclick: () => { st.universe = v; render(); } }, l))),
  ]));
  bar.append(row);
  wrap.append(bar);

  let scoped = U;
  if (st.universe === 'US' || st.universe === 'MY') scoped = scoped.filter(r => r.c.mkt === st.universe);
  if (st.universe === 'watchlist') scoped = scoped.filter(r => State.watchlist.includes(r.c.id));
  let rows = scoped.filter(r => isNum(r.m.mcap));      /* area comes from market cap */
  /* The companies with no market capitalisation — every filer without a
     price — have no tile area and are not drawn. "23 companies" under a
     138-company universe used to say nothing about the other 115. */
  const noCap = scoped.length - rows.length;
  const mode = HEAT_MODES.find(m => m.id === st.mode) || HEAT_MODES[0];
  /* Only tiles with an observed value for the chosen mode. A priced filer
     carries no day, month or quarter change, and drawing it as 0.00% in the
     neutral colour asserted a move that was never observed. */
  const inScope = rows.length;
  rows = rows.filter(r => isNum(mode.get(r)));
  const unobserved = inScope - rows.length;

  const card = el('div', { class: 'card' });

  /* A single tree across both markets is unreadable: the largest US company is
     roughly a hundred times the largest Bursa company, so every Malaysian tile
     collapses to a sliver. When both markets are in scope, each gets its own
     panel and its area is normalised within that market. */
  const groups = (st.universe === 'all' || st.universe === 'watchlist') && new Set(rows.map(r => r.c.mkt)).size > 1
    ? [['United States', rows.filter(r => r.c.mkt === 'US')], ['Bursa Malaysia', rows.filter(r => r.c.mkt === 'MY')]]
    : [[null, rows]];

  const panels = el('div', { class: groups.length > 1 ? 'grid g-2' : '' });
  const mounts = [];
  groups.forEach(([label, gr]) => {
    if (!gr.length) return;
    const box = el('div', { style: 'min-width:0' });
    if (label) box.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:8px' }, [
      marketChip(gr[0].c.mkt),
      el('span', { class: 'h-card', style: 'font-size:13px' }, label),
      el('span', { class: 'metaline' }, `${gr.length} companies · area scaled within this market`),
    ]));
    const host = el('div', { style: 'width:100%' });
    box.append(host);
    panels.append(box);
    mounts.push([host, gr]);
  });
  card.append(panels);

  /* scale legend — required for any continuous colour scale */
  const leg = el('div', { class: 'row row-wrap', style: 'gap:var(--md);margin-top:var(--md);padding-top:var(--sm);border-top:1px solid var(--grid)' });
  const ramp = el('div', { class: 'row', style: 'gap:0' });
  DIVERGING.forEach(v => ramp.append(el('span', { style: `width:20px;height:9px;background:var(${v})` })));
  leg.append(el('span', { class: 'legend-item' }, [el('span', { class: 'metaline' }, mode.fmt(-mode.full)), ramp, el('span', { class: 'metaline' }, mode.fmt(mode.full))]));
  const missingWhat = mode.price ? `observed ${mode.id === 'd1' ? 'day' : mode.label} change` : mode.label.toLowerCase().replace(/^vs /, 'difference to ');
  /* A price move is dated by the prices it is computed from, which are fixed
     files and sample figures, not a feed — so the caption names their dates. */
  const pxDates = mode.price ? [...new Set(rows.map(r => priceAsOfLabel(r.c)))] : [];
  leg.append(el('span', { class: 'caption', style: 'margin-left:auto' }, `${rows.length} companies · ${mode.label}${mode.id === 'd1' ? ' vs previous close' : ''}${pxDates.length ? ` · prices as of ${pxDates.join('; ')}` : ''}${unobserved ? ` · ${unobserved} priced but with no ${missingWhat}, not drawn` : ''}`));
  card.append(leg);
  if (noCap) {
    const unpriced = scoped.filter(r => !isNum(r.m.mcap) && !isNum(r.c.px?.p)).length;
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `${noCap} of ${scoped.length} companies in this universe have no market capitalisation to size a tile — ${unpriced} carry no price${noCap > unpriced ? `, ${noCap - unpriced} no usable share count` : ''} — so they are not drawn.`));
  }
  card.append(tableTwin('Show the table view of every tile',
    ['Company', 'Market', mode.label, 'Market cap'],
    rows.map(r => [`${r.c.tk} — ${esc(r.c.name)}${illusText(r.c)}`, r.c.mkt, mode.fmt(mode.get(r)), fmtCap(toBase(r.m.mcap, r.c.ccy), State.baseCcy)])));
  wrap.append(card);

  mounts.forEach(([host, gr]) => treemap(host, {
    items: gr.map(r => ({
      id: r.c.id, label: r.c.tk, name: r.c.name + illusText(r.c),
      value: toBase(r.m.mcap, r.c.ccy), change: mode.get(r),
      capLabel: fmtCap(toBase(r.m.mcap, r.c.ccy), State.baseCcy),
      metricLabel: mode.label,
    })),
    valueFmt: mode.fmt, full: mode.full,
    pickNote: mode.price ? 'Select for the "Why moved?" attribution' : 'Select for the market, sector and company split',
    onPick: id => openWhyMoved(id, st.mode),
  }));
  return wrap;
}

function openWhyMoved(id, mode) {
  const r = BY_ID.get(id);
  const a = attribution(r, mode);
  /* A score or a model difference is a level, not a move. The same split
     applies — market, sector, the rest — but the drawer does not call it a
     move, colour it as a gain, or look for a company event that explains it,
     and its components are printed as point differences (dfmt), not through
     the tile formatter that adds the quality midpoint back. */
  const HM = HEAT_MODES.find(x => x.id === mode) || HEAT_MODES[0];
  const isMove = !!HM.price;
  const title = isMove ? 'Why moved?' : 'How this figure splits';
  const body = el('div');
  body.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:2px' }, [el('h3', { class: 'h-section' }, r.c.tk), illusChip(r.c), marketChip(r.c.mkt)]));
  if (!a) {
    body.append(el('p', { class: 'body', style: 'font-size:13px' }, isMove
      ? `${r.c.name} carries no observed change for this period, so there is no move to attribute.`
      : `${r.c.name} carries no ${HM.label.toLowerCase().replace(/^vs /, 'difference to ')}, so there is nothing to split.`));
    openDrawer(title, body);
    return;
  }
  const dfmt = a.m.dfmt || a.m.fmt;
  body.append(el('p', { class: 'caption', style: 'margin-bottom:var(--md)' }, `${r.c.name} · ${a.m.label}`));

  body.append(statTile(a.m.label, a.m.fmt(a.val), { tone: isMove ? (a.val >= 0 ? '--ok-text' : '--dn-text') : null }));

  body.append(el('h4', { class: 'h-card', style: 'margin:var(--md) 0 6px' }, isMove ? 'Attribution' : 'Split'));
  const parts = isMove ? [
    ['Market component', a.market, 'The cap-weighted move of the whole market cohort.'],
    ['Sector component', a.sector, 'The sector’s move over and above the market.'],
    ['Company-specific', a.specific, 'The residual after market and sector are removed.'],
  ] : [
    ['Market component', a.market, mode === 'qual'
      ? 'How far the cap-weighted average score of the market cohort sits from the midpoint of 50.'
      : 'The cap-weighted average difference to the base-case model estimate across the market cohort.'],
    ['Sector component', a.sector, 'The sector’s cap-weighted average over and above the market’s.'],
    ['Company-specific', a.specific, 'The residual after market and sector are removed.'],
  ];
  const maxAbs = Math.max(...parts.map(p => Math.abs(p[1])), 0.01);
  parts.forEach(([label, v, note]) => {
    const p = el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--grid)' });
    p.append(el('div', { class: 'row' }, [
      el('span', { style: 'font-size:13px;color:var(--ink-2)' }, label),
      el('span', { class: 'spacer' }),
      el('span', { class: 'num ' + (isMove ? signClass(v) : ''), style: 'font-size:13px;font-weight:600' }, dfmt(v)),
    ]));
    const track = el('div', { style: 'height:6px;background:var(--surface-sunk);border-radius:999px;margin:5px 0 4px;position:relative;overflow:hidden' });
    track.append(el('i', { style: `position:absolute;left:50%;${v >= 0 ? '' : 'transform:translateX(-100%);'}width:${Math.abs(v) / maxAbs * 50}%;height:100%;background:var(${v >= 0 ? '--up-4' : '--dn-4'});border-radius:999px;display:block` }));
    p.append(track);
    p.append(el('p', { class: 'metaline' }, note));
    body.append(p);
  });

  if (isMove) {
    body.append(el('h4', { class: 'h-card', style: 'margin:var(--md) 0 6px' }, 'Candidate explanations'));
    const evid = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    /* Only an illustrative company has a document here — documents() returns
       nothing for a filed one — and the list it comes from is a labelled
       sample. Cited as a prompt, then, not as evidence. */
    if (Math.abs(a.specific) > Math.abs(a.market) * 0.8 && a.doc) {
      evid.append(el('div', { class: 'evidence' },
        `The sample document list carries a ${a.doc.form} dated ${a.doc.date}: “${a.doc.title}”. That list is illustrative — nothing in it was retrieved from any exchange — so this is a prompt to check the real filing index, not evidence that anything was published.`));
    }
    const ch = changeSummary(r.c) || [];
    const big = ch.filter(x => isNum(x.v) && Math.abs(x.v) > 8);
    if (big.length) evid.append(el('div', { class: 'evidence support' },
      `Latest reported year: ${big.map(x => `${x.label.toLowerCase()} ${withSign(x.v, 0)}`).join(', ')}.`));
    if (!evid.children.length || Math.abs(a.specific) < 1) {
      evid.append(el('div', { class: 'evidence' },
        'No reliable company event in the data carried here explains this move. It is reported as unexplained rather than attributed to a cause the data does not support.'));
    }
    body.append(evid);
  }

  body.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' }, isMove
    ? 'Attribution is arithmetic on the prices carried here. It identifies where a move came from, not whether the move was justified.'
    : `This split is arithmetic on the ${mode === 'qual' ? 'quality scores' : 'base-case model estimates'} carried here: how much of the figure is shared with the market and the sector, and how much is particular to the company. It explains no price move and is not a view on the company.`));

  const acts = el('div', { class: 'row', style: 'gap:8px;margin-top:var(--md)' });
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => { closeDrawer(); openResearch(id); } }, 'Open research'));
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { closeDrawer(); openResearch(id, 'filings'); } }, 'Read filings'));
  body.append(acts);
  openDrawer(title, body);
}

VIEWS.discover = () => {
  const wrap = el('div');
  const hd = el('div', { style: 'margin-bottom:var(--lg)' });
  hd.append(el('p', { class: 'eyebrow' }, 'Discover'));
  hd.append(el('h1', { style: 'font-size:24px;margin:2px 0 var(--md)' }, 'Narrow the universe to what is worth reading'));
  const sub = el('div', { class: 'subnav' });
  DISCOVER_TABS.forEach(t => sub.append(el('button', {
    role: 'tab', 'aria-selected': State.discoverTab === t.id ? 'true' : 'false',
    /* Through the address: /discover/screener and /discover/value-map have
       routes of their own, the other two ride on ?tab=. */
    onclick: () => go('discover', { tab: t.id }) }, t.label)));
  hd.append(sub);
  wrap.append(hd);

  /* With a fallback: a tab id this view does not know renders the screener
     rather than throwing out of render() and leaving the previous page on
     screen under a /discover address. */
  const panel = { screener: renderScreener, radar: renderRadar, ideas: renderIdeas, heatmap: renderHeatmap }[State.discoverTab] || renderScreener;
  wrap.append(panel());
  return wrap;
};

