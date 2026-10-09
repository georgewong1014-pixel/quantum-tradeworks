/* ==========================================================================
   VIEW — RESEARCH QUEUE (Equities Research)

   This was the whole of /app until Release A. The root URL used to drop a
   visitor inside the application, so the dashboard was the equities research
   queue: market context, FX, freshness, a change feed and a watchlist. Release
   A makes /app the visitor's own dashboard (VIEW — MY DASHBOARD, below) and
   moves this page, unchanged in substance, to /research/queue under Equities
   Research. The first-run "What this is, in three lines" band stayed behind:
   the homepage and the dashboard's first-time checklist now answer "what is
   this, and where do I start", and a band repeating it on an equities page
   was a third copy of the same orientation.
   ========================================================================== */

/* It names companies throughout, so it waits for the filings like the page it
   was (35-ui.js explains why a universe view never paints the sample set
   first). Registered from here, as the scanner's pages register theirs, so
   the route table's owner and this file do not edit the same lines. */
UNIVERSE_VIEWS.add('researchQueue');

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

/* Whether the active watchlist is still the seeded sample (isSeededWL,
   50-views-studio.js). */
const activeWLIsSample = () => { try { const w = activeWL(); return !!w && typeof isSeededWL === 'function' && isSeededWL(w); } catch { return false; } };
VIEWS.researchQueue = () => {
  const wrap = el('div');

  /* -- header: the one head (pageHead, 36-layouts.js; Release B) ---------- */
  const hr = el('div', { class: 'row row-wrap', style: 'gap:8px' });
  /* Each names the tool it opens, so the shell's gate draws it as text
     where that tool cannot be used here (gateToolLink, 35-ui.js). */
  hr.append(el('button', { class: 'btn btn-ghost btn-sm', 'data-tool-path': '/discover/screener', onclick: () => go('discover', { tab: 'screener' }), html: `${icon('filter')} Open screener` }));
  hr.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openDashboardCustomiser(), html: `${icon('grid')} Customise` }));
  hr.append(el('button', { class: 'btn btn-primary btn-sm', 'data-tool-path': '/discover/value-map', onclick: () => go('discover', { tab: 'radar' }), html: `${icon('target')} Quality vs Value Map` }));
  wrap.append(pageHead({ title: 'Research queue', lede: 'What changed in the reported figures, your watchlist first.',
    note: 'Research, not recommendations. Everything below is derived from the statement lines held for each company — audited filings for the SEC-filed set, illustrative figures for the Malaysian one, and each page says which. No figure is asserted without the inputs behind it, and nothing here tells you what to do with it. Open any number to see its formula, period and coverage.',
    action: hr }));

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
      el('button', { 'aria-pressed': State.baseCcy === cc ? 'true' : 'false', onclick: () => { State.baseCcy = cc; store.write('baseCcy', cc); render(); } }, cc))),
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
      /* Loaded from this site, not from SEC EDGAR. The statements were
         retrieved from EDGAR when the dataset was built and ship in
         data/us.json; the page cannot reach sec.gov at all (the CSP allows
         connections to its own origin only), so "loading filings from SEC
         EDGAR" described a request that is never made — the claim the
         loading card was corrected for. */
      realStatus === null ? 'Loading the filed statements…'
      : realStatus.ok ? `${n} companies’ statements loaded — retrieved from SEC EDGAR when this dataset was built, not fetched now. Statements are audited and real. `
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
    /* The illustrative marker every other company surface carries, as the
       watchlist rows and the differences panel beside this feed do: an event
       computed from synthetic figures (a discount, a payout ratio) is a
       synthetic event, and the page's META says each company is labelled. */
    const fr = BY_ID.get(f.id);
    if (fr) { const ic = dataChip(fr.c); if (ic) t.append(ic); }
    if (State.watchlist.includes(f.id)) t.append(el('span', { class: 'chip chip-brand' }, activeWLIsSample() ? 'Sample watchlist' : 'Watchlist'));
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
  /* A seeded list says it is one here, as the dashboard and the Watchlists
     page do: the reader did not choose these companies. */
  State.watchlists.forEach((w, i) => wlSel.append(el('option', { value: i, selected: i === State.wlIdx ? '' : null },
    `${w.name} (${w.ids.length})${typeof isSeededWL === 'function' && isSeededWL(w) ? ' · sample' : ''}`)));
  wlHead.append(wlSel);
  wlHead.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openWatchlistManager(), html: `${icon('grid', 13)} Manage` }));
  wl.append(wlHead);
  if (activeWLIsSample()) wl.append(el('p', { class: 'metaline', style: 'margin:-4px 0 6px' }, [el('span', { class: 'chip chip-bronze' }, 'Sample'),
    ' A list written into this browser so the page has something to show — not one you chose.']));
  const wlRows = State.watchlist.map(id => BY_ID.get(id)).filter(Boolean);
  if (!wlRows.length) wl.append(emptyState('No companies on the watchlist yet.'));
  else {
    const t = el('div', { style: 'display:flex;flex-direction:column' });
    wlRows.forEach((r, i) => {
      const row = el('button', { class: 'row', style: `width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;gap:10px;${i ? 'border-top:1px solid var(--grid)' : ''}`,
        onclick: () => openResearch(r.c.id) });
      const nm = el('div', { style: 'min-width:0;flex:1' });
      nm.append(el('div', { class: 'row', style: 'gap:6px;font-size:13px;font-weight:600' }, [r.c.tk, dataChip(r.c)]));
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
    'An arithmetic sort of the universe by the distance between price and the modelled base case, in either direction, restricted to Medium confidence or better. A sort, not a selection — the order carries no view about which company is worth owning.'));
  /* By the size of the distance, the sign kept on each row. The sort was on
     the signed difference, so the card listed the five largest discounts
     only — PCHEM +69% down to PETGAS +28% — while Tenaga at −61% and Nestlé
     at −53%, both High confidence, never appeared: a "five cheapest against
     the model" list under a heading and a description that disclaim one. */
  const top = U.filter(r => r.val.mos && isNum(r.val.mos.base) && r.val.confBand !== 'Low')
    .sort((a, b) => (Math.abs(b.val.mos.base) - Math.abs(a.val.mos.base)) || String(a.c.tk).localeCompare(String(b.c.tk))).slice(0, 5);
  const dl = el('div', { style: 'display:flex;flex-direction:column' });
  top.forEach((r, i) => {
    const row = el('button', { class: 'row', style: `width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;gap:10px;${i ? 'border-top:1px solid var(--grid)' : ''}`,
      onclick: () => openResearch(r.c.id, 'valuation') });
    const nm = el('div', { style: 'min-width:0;flex:1' });
    nm.append(el('div', { class: 'row', style: 'gap:6px' }, [el('span', { style: 'font-size:13px;font-weight:600' }, r.c.tk), dataChip(r.c), marketChip(r.c.mkt)]));
    nm.append(el('div', { class: 'metaline' }, `${r.val.pack.name} · ${r.val.confBand} confidence`));
    row.append(nm);
    /* diffClass, not `pos`. A gap to a model estimate is not a gain, and the
       green of one — on the card that opens with "It is not a
       recommendation" — made the five largest read as five picks. */
    row.append(el('div', { class: 'num ' + diffClass(r.val.mos.base), style: 'font-size:13px;font-weight:700' }, withSign(r.val.mos.base, 0)));
    dl.append(row);
  });
  disc.append(dl);
  disc.append(el('p', { class: 'metaline', style: 'margin-top:10px' }, 'Sorted by modelled gap, not by conviction. A large gap usually means the model and the market disagree — which is a reason to read the company, not a reason to act.'));
  CARDS.discounts = disc;

  /* research loop */
  const loop = el('div', { class: 'card' });
  loop.append(cardHead('The research loop', 'Each pass leaves evidence behind, so the next one starts further along.'));
  /* The two company steps open the last company the reader opened, named on
     the step, or the way in at /research when there is none. Both called
     go('research'), which falls back to the seeded State.ticker: in a fresh
     browser "Build a valuation range" opened Apple's Snapshot — not its
     valuation — and on Free spent one of the month's five reports on a
     company nobody chose. A navigation link never chooses a security. */
  const lastOpened = (State.recentCompanies || []).map(id => BY_ID.get(id)).find(Boolean) || null;
  const companyStep = (tab) => () => lastOpened ? openResearch(lastOpened.c.id, tab) : go('researchHome');
  const steps = [['Discover candidates', () => go('discover')], ['Inspect evidence', companyStep(null), true],
    ['Build a valuation range', companyStep('valuation'), true], ['Save a thesis', () => go('thesis')],
    ['Monitor changes', () => go('alerts')], ['Review decision quality', () => go('thesis')]];
  const ol = el('ol', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:2px' });
  steps.forEach(([label, act, onCompany], i) => {
    /* tap-row: one line of 13px text in 7px padding is a 34px target, six of
       them stacked 2px apart — the 44px floor comes from the stylesheet on a
       phone, where a fingertip is what presses them. */
    ol.append(el('li', {}, el('button', {
      class: 'row tap-row', style:'width:100%;gap:10px;background:none;border:0;cursor:pointer;padding:7px 0;text-align:left',
      /* The screener step names its tool, for the shell's gate. */
      'data-tool-path': label === 'Discover candidates' ? '/discover' : null,
      onclick: act }, [
      el('span', { style: 'width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--brand-wash);color:var(--brand)' }, String(i + 1)),
      el('span', { style: 'display:flex;flex-direction:column;min-width:0' }, [
        el('span', { style: 'font-size:13px;color:var(--ink-2)' }, label),
        onCompany ? el('span', { class: 'metaline' }, lastOpened ? `${lastOpened.c.tk}, the last company you opened` : 'choose a company') : null,
      ]),
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

/* ----------------------------------------------- research queue customising */
/* The store key stays 'dash': it is what a reader's saved arrangement of these
   cards has always been kept under, and renaming it would reset every one. */
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
    'Reorder the research queue, move a card between the main column and the side rail, or hide it. Saved in this browser.'));
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
    saveDash(); closeDrawer(); render(); toast('Research queue reset');
  } }, 'Reset to default'));
  openDrawer('Customise the research queue', body);
}

/* ==========================================================================
   VIEW — MY DASHBOARD (/app)

   The visitor's own page, not a product's. It answers five questions — what
   changed since my last visit, did any of my setups match, what am I
   monitoring, what have I saved, what next — and every answer is read from
   what this browser holds or from the scanner's own record. There is no
   account, so there is nobody's activity to show but the visitor's, and no
   figure here is sample data: the lists, holdings, cases and price alerts
   seeded on a first visit (50-views-studio.js) are said to be samples and
   are never counted as the visitor's.

   Two states, chosen by that one fact. With nothing of the visitor's own
   saved, the page is an onboarding checklist whose ticks are read from real
   state — no tiles of zeros, no empty charts. With something saved, it is
   four counts that each open the page they count, the latest matches of the
   visitor's setups, the items to continue, and the first steps not yet taken.

   The previous visit's time is kept in the store (dashVisit), so "since your
   last visit" means since this browser last had the dashboard open: a visit
   ends after thirty minutes away from it, and a reload inside one does not
   start another.
   ========================================================================== */

/* The four products — names and actions — are the shell's (PRODUCTS,
   productById in 35-ui.js), and every badge here is a tool's, from the one
   registry (TOOLS, toolBadge), so the dashboard cannot describe a product or
   a tool differently from the header, the sidebar, the tabs and How it
   works. */

/* A real anchor, so every tile and row is a link the browser understands —
   middle-click, a new tab, the address in the status bar — and through the
   shell's one gate (gateDetached, 35-ui.js): a count or a step whose tool
   cannot be used here is drawn as text with the reason, not as a door. */
function myDashLink(path, attrs = {}, kids = []) {
  const a = el('a', { ...attrs, href: href(path),
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(path); } }, kids);
  return myDashGate(a);
}
const myDashGate = (n) => (typeof gateDetached === 'function' ? gateDetached(n) : n);
/* The one route helper that decides whether a link may be drawn at all: a
   path that ends at the not-found card is never offered. */
const myDashRoutes = (path) => { const r = matchRoute(path.split('?')[0]); return !!(r && VIEWS[r.view]); };

/* ---------------------------------------------------------------- visits */
/* { prev, seen }: `seen` is the last time the dashboard was drawn, `prev` the
   end of the visit before this one. A draw more than thirty minutes after the
   last one starts a visit, and the one that ended at `seen` becomes `prev`;
   any draw inside a visit — a reload, a theme switch, coming back from a
   company page — keeps the same `prev`, so the count of what is new does not
   fall to nought the moment the page is looked at. */
const MYDASH_VISIT_GAP_MS = 30 * 60 * 1000;
function myDashVisit(now = new Date()) {
  const raw = store.read('dashVisit', null);
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const seen = Date.parse(v.seen), prev = Date.parse(v.prev);
  const at = now.toISOString();
  const next = !Number.isFinite(seen) ? { prev: null, seen: at }
    : now.getTime() - seen > MYDASH_VISIT_GAP_MS ? { prev: new Date(seen).toISOString(), seen: at }
    : { prev: Number.isFinite(prev) ? new Date(prev).toISOString() : null, seen: at };
  store.write('dashVisit', next);
  return next;
}
/* The reader's own clock: the time of day greets them, and the previous visit
   is given in their local time, which is the only clock they were looking at. */
const myDashGreeting = (d = new Date()) => { const h = d.getHours(); return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening'; };
const myDashWhen = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const myDashPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------ the visitor's own */
/* Everything the page counts, from the stores that hold it. The samples are
   left out by the rules that already decide what is a sample (a seeded list
   or alert the reader has since changed is theirs). The scanner is counted
   twice over, because it lives in two places: the setups saved in this
   browser, and data/scan-setups.json, which is what the worker runs and is
   only ever visible on the machine it runs on. */
/* THE COMPANIES IN A LIST THAT ARE THE VISITOR'S OWN. A seeded list stopped
   being a sample the moment anything touched it (isSeededWL reads updatedAt),
   so one "Add to watchlist" on a company page — which adds to the active
   list, the seeded Core watchlist on a fresh profile, and is the second step
   of the journey /how-it-works describes — made all six seeded companies
   "yours": the tile read 7 instruments in a list of your own, the checklist
   ticked "Create a watchlist" when none had been created, and "Continue"
   listed the sample list beside a note saying samples are not counted. A
   member carries the date it was added (06-watchlists.js); the seed's
   members were migrated with none, so in a seeded list only a dated member
   is the visitor's. Any other list is theirs whole. */
function myDashOwnIds(w) {
  const seedIds = typeof SEEDED_WL_IDS !== 'undefined' ? SEEDED_WL_IDS : [];
  const ids = Array.isArray(w?.ids) ? w.ids : [];
  return seedIds.includes(w?.id) ? ids.filter(id => w.added && w.added[id]) : ids;
}
function myDashOwn() {
  const seededPA = (pa) => (typeof isSeededPA === 'function' ? isSeededPA(pa) : false);
  const seededPF = typeof SEEDED_PF_IDS !== 'undefined' ? SEEDED_PF_IDS : [];
  const seedIds = typeof SEEDED_WL_IDS !== 'undefined' ? SEEDED_WL_IDS : [];
  const all = (State.watchlists || []).filter(Boolean);
  /* Lists holding at least one company the visitor put there, and the lists
     they made themselves (the checklist's "Create a watchlist"). */
  const lists = all.filter(w => myDashOwnIds(w).length);
  /* A seeded list holding only companies the visitor added — the samples
     cleared out of it (clearSeededData), or removed one by one — is theirs
     now, as /my/watchlists calls it. Judged by its id alone, a list kept
     through "Clear" could never tick the step, and on Free no other list
     could be made. */
  const createdLists = all.filter(w => (w.ids || []).length && myDashOwnIds(w).length === w.ids.length);
  /* Seeded lists still holding a seeded company: whatever is in them that the
     visitor did not add is a sample, and is not counted. */
  const sampleLists = all.filter(w => seedIds.includes(w.id) && myDashOwnIds(w).length < (w.ids || []).length);
  const instruments = new Set(lists.flatMap(myDashOwnIds));
  const scanSt = typeof scanStoreRead === 'function' ? scanStoreRead() : null;
  const setups = scanSt && typeof scanBrowserSetups === 'function' ? scanBrowserSetups({ st: scanSt }) : [];
  const setupsDoc = typeof scanSetupsFile !== 'undefined' ? scanSetupsFile : null;
  const alertsDoc = typeof scanAlertsFile !== 'undefined' ? scanAlertsFile : null;
  const scan = (setupsDoc || alertsDoc) && typeof scanOpsStatus === 'function' ? scanOpsStatus() : null;
  const fileActive = setupsDoc && scan ? scan.active : null;
  const alerts = alertsDoc && typeof scanAlertsInOrder === 'function' ? scanAlertsInOrder() : null;
  const saved = typeof workspaceItems === 'function' ? workspaceItems().filter(i => !i.sample) : [];
  const portfolios = (State.portfolios || []).filter(p => p && !seededPF.includes(p.id) && (p.holdings || []).length);
  const priceAlerts = (State.priceAlerts || []).filter(pa => pa && !seededPA(pa));
  const d = State.deal;
  const dealStarted = dealIsTheReaders(d);
  /* A snapshot of the calculator's sample inputs is not a start on a model
     of the reader's own (workIsSample): it ticked the step and turned the
     first-time checklist into the returning dashboard. */
  const propertySnaps = typeof loadWork === 'function' ? loadWork().filter(w => w?.kind === 'property' && !workIsSample(w)).length : 0;
  const researched = (State.recentCompanies || []).filter(id => BY_ID.has(id));
  /* SAVED PROPERTIES (D12, 8 Oct 2026): the properties saved in this
     browser (pmIsProperty), newest first, each called a saved property —
     never the "Tool snapshot" the saved-work store files it under. One
     holding only the calculator's sample inputs is not the reader's
     (workIsSample) and is named apart, never counted. */
  const propsAll = typeof pmAll === 'function' ? pmAll() : [];
  const propTime = (r) => Date.parse((typeof pmUpdated === 'function' ? pmUpdated(r) : null) || '') || 0;
  const savedProps = propsAll.filter(r => !workIsSample(r)).sort((a, b) => propTime(b) - propTime(a));
  const sampleProps = propsAll.length - savedProps.length;
  /* YOUR ALERTS (D12): the research alerts (an investment case of the
     reader's own with a condition to break), the price alerts and the
     screen alerts they set, and the scanner's matches where its record is
     held here. The seeded cases and price alerts are samples, left out. */
  const seededTh = typeof SEEDED_THESIS_IDS !== 'undefined' ? SEEDED_THESIS_IDS : [];
  const researchAlerts = (State.theses || []).filter(t => t && !seededTh.includes(t.id) && (t.conds || []).length);
  const screenAlerts = (State.savedScreens || []).filter(s => s && s.alertOnMatch !== false);
  const setupsKnown = setups.length + (fileActive ? fileActive.valid : 0);
  /* The scanner's record counts as the visitor's own: its matches are of their
     setups. With a record and no readable setups file (renamed, or every setup
     in it invalid) the page drew the first-time checklist and hid the matches
     the sidebar was counting as unread on the same screen. */
  const hasOwn = lists.length + setupsKnown + saved.length + portfolios.length + priceAlerts.length + propertySnaps + (alerts?.length || 0) > 0 || dealStarted;
  return { lists, createdLists, sampleLists, instruments, scanSt, setups, setupsDoc, scan, fileActive, alerts, saved, portfolios,
           priceAlerts, dealStarted, propertySnaps, researched, setupsKnown, hasOwn, savedProps, sampleProps, researchAlerts, screenAlerts,
           samples: typeof hasSeededData === 'function' && hasSeededData() };
}

/* The four first steps, each ticked from the state that proves it and each
   with its one action. Research is ticked by a company report having been
   read here (recentCompanies is written when one renders); a watchlist by a
   list of the reader's own that holds a company; a setup by one saved here or
   in the worker's file; a property model by an edit to the calculator's deal
   or a saved snapshot of one. */
function myDashSteps(o) {
  const eq = productById('equities'), sc = productById('scanner'), pr = productById('property');
  const lastCo = o.researched.length ? BY_ID.get(o.researched[0]) : null;
  const createdIds = new Set(o.createdLists.flatMap(w => w.ids || []));
  const inList = o.createdLists.length ? `${myDashPlural(o.createdLists.length, 'list')} of your own, ${myDashPlural(createdIds.size, 'company', 'companies')}` : '';
  /* Companies added to a sample list are the visitor's, but no list was
     created: the step says where they went rather than ticking itself. */
  const inSample = !o.createdLists.length && o.instruments.size
    ? `${myDashPlural(o.instruments.size, 'company', 'companies')} you added ${o.instruments.size === 1 ? 'sits' : 'sit'} in a sample list. A list of your own keeps your companies apart from the samples.` : '';
  const setupsText = [o.setups.length ? `${o.setups.length} saved in this browser` : '', o.fileActive?.valid ? `${o.fileActive.valid} in the worker’s file` : ''].filter(Boolean).join(' · ');
  return [
    { k: 'research', product: 'equities', tool: 'overview', title: 'Research a company', done: !!lastCo,
      /* A name that ends in a full stop (Apple Inc.) ends the sentence. */
      note: lastCo ? `Last opened: ${lastCo.c.tk} — ${lastCo.c.name}${lastCo.c.real ? '' : ' (illustrative figures)'}`.replace(/\.?$/, '.')
        : 'Statements, ratios and a valuation range, every figure with its formula and its source.',
      action: eq?.action || 'Start research', path: eq?.actionPath || '/research' },
    { k: 'watchlist', product: null, tool: 'watchlists', title: 'Create a watchlist', done: o.createdLists.length > 0,
      note: o.createdLists.length ? `${inList}.` : inSample || 'The companies you follow, in a list of your own — the scanner can take it as the universe it checks.',
      action: toolById('watchlists')?.action.label || 'Create a watchlist', path: '/my/watchlists' },
    { k: 'setup', product: 'scanner', tool: 'setups', title: 'Create a scanner setup', done: o.setupsKnown > 0,
      note: o.setupsKnown ? `${setupsText}.` : 'Conditions you choose, checked on each daily close of the price history you supply, with a record of every bar on which they held.',
      action: sc?.action || 'Create a setup', path: sc?.actionPath || '/app/scanner/setups/new' },
    /* The property step opens Property's landing, the Scenario Lab (D12; N3
       made /property the Lab): the price, the rent and the loan moved and
       the figures following, before anything is typed into the calculator. */
    { k: 'property', product: 'property', tool: 'lab', title: 'Start a property model', done: o.dealStarted || o.propertySnaps > 0,
      note: o.dealStarted || o.propertySnaps
        ? [o.dealStarted ? 'A deal in progress in the calculator' : '', o.propertySnaps ? `${myDashPlural(o.propertySnaps, 'saved property', 'saved properties')}` : ''].filter(Boolean).join(' · ') + '.'
        : 'Move the price, the rent and the loan in the Scenario Lab; the monthly position, the yield and the cash needed follow.',
      action: pr?.action || 'Analyse a property', path: '/property' },
  ];
}

/* EACH STEP'S PICTURE (D12, 8 Oct 2026): a schematic of what the step
   makes — a statement and its lens, a list, a line meeting a condition, a
   house and three sliders — drawn without a figure, a name or a count, so
   it can never be read as anyone's data. Decorative (aria-hidden): the
   step's words say what it is. */
const MYDASH_PICS = {
  research: '<rect x="7" y="6" width="32" height="36" rx="4"/><path d="M13 14h20M13 20h13"/><path class="dsp-2" d="M14 36v-6M20 36v-9M26 36v-4M32 36v-11"/><circle cx="45" cy="29" r="7"/><path d="m50 34 7 7"/>',
  watchlist: '<rect x="7" y="7" width="50" height="34" rx="4"/><path class="dsp-2" d="m15 13.6 1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z"/><path d="M25 18h24"/><circle cx="15" cy="27" r="1.8"/><path d="M25 27h18"/><circle cx="15" cy="34.5" r="1.8"/><path d="M25 34.5h21"/>',
  setup: '<path d="M6 41h52" opacity=".45"/><path class="dsp-2" d="M6 20h52" stroke-dasharray="3 3"/><path d="m6 35 9-6 8 4 9-11 8 3 8-12 10 3"/><circle class="dsp-dot" cx="40" cy="19" r="3.4"/>',
  property: '<path d="M6 25 20 13l14 12"/><path d="M10 22v18h20V22"/><path d="M17 40v-8h6v8"/><path d="M40 15h18M40 26h18M40 37h18"/><circle class="dsp-dot" cx="47" cy="15" r="3"/><circle class="dsp-dot" cx="53" cy="26" r="3"/><circle class="dsp-dot" cx="44" cy="37" r="3"/>',
};
const myDashPic = (k) => el('span', { class: 'dash-step-pic', 'aria-hidden': 'true',
  html: `<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">${MYDASH_PICS[k] || ''}</svg>` });

const MYDASH_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const MYDASH_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

/* One step as a row: its mark, its title and product, what it is or what was
   done, and its action. Only the first step not yet done carries the primary
   button, so the page has one thing to do next rather than four. */
function myDashStepRow(s, primary) {
  const li = el('li', { class: 'dash-step', data: { done: s.done ? '1' : '0', step: s.k } });
  li.append(el('span', { class: 'dash-step-mark', 'aria-hidden': 'true', html: s.done ? MYDASH_CHECK : '' }));
  li.append(myDashPic(s.k));
  const body = el('div', { class: 'dash-step-body' });
  body.append(el('div', { class: 'dash-step-t' }, [
    el('h3', { class: 'h-card' }, [el('span', { class: 'sr-only' }, s.done ? 'Done: ' : 'Not done yet: '), s.title]),
    s.tool ? toolBadge(s.tool) : s.product ? productBadge(s.product) : null,
  ]));
  body.append(el('p', { class: 'caption' }, s.note));
  li.append(body);
  li.append(myDashLink(s.path, { class: `btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm dash-step-go` }, s.action));
  return li;
}

/* A count that opens the page it counts. `value` is text, so an absent record
   reads as what it is ("No record") and never as a nought. */
/* A metric card of the layout system (37-layout-system.js): its label, its
   value and its data badge — the kind of what it shows (D6): the reader's
   own, counted from this browser, or a company's own kind. */
function myDashTile({ icon: ic, label, value, sub, path, note, kind = 'yours', fine = 'Counted from what you made in this browser', tile = null }) {
  const badge = kindBadge(kind, { fine, link: false });
  badge.classList.add('ls-badge');
  return myDashLink(path, { class: 'dash-tile ls-card ls-l1', 'data-card': 'metric', 'data-level': '1', 'data-tile': tile }, [
    el('span', { class: 'dash-tile-hd ls-card-hd' }, [el('span', { class: 'dash-tile-ic', 'aria-hidden': 'true', html: icon(ic, 16) }), el('span', { class: 'stat-label ls-card-label' }, label)]),
    el('span', { class: 'dash-tile-v ls-card-value' + (/^\d+$/.test(value) ? '' : ' is-text') }, value),
    el('span', { class: 'stat-sub ls-card-sub' }, sub),
    note ? el('span', { class: 'dash-tile-note' }, note) : null,
    badge,
    el('span', { class: 'dash-tile-go', 'aria-hidden': 'true', html: MYDASH_CHEVRON }),
  ]);
}

/* WHAT IS THE READER'S, BY SECTION (D12, 8 Oct 2026). The five parts of
   the workspace — the company last opened, the saved properties, the
   watchlists, the setups and the alerts — read from the same stores in
   both states. A first visit lists them with what each holds now, which
   is nothing: "None yet", never a count; a returning reader gets them as
   five counts (myDashTiles). Samples are never one of them. */
const myDashRecent = (o) => o.researched.map(id => BY_ID.get(id)).filter(Boolean);
const myDashPropPath = (rec) => `/property?model=${encodeURIComponent(rec.id)}`;
function myDashSections(o) {
  const sec = el('section', { class: 'card ls-section dash-secs', 'aria-labelledby': 'dash-secs-hd' });
  sec.append(el('h2', { id: 'dash-secs-hd', class: 'h-card' }, 'Your workspace'));
  sec.append(el('p', { class: 'caption dash-secs-lede' }, 'What you make here is listed here, and nothing else is: sample data is never shown as yours.'));
  const recent = myDashRecent(o)[0] || null;
  const row = ({ k, ic, name, path, t, s, chip = null }) => el('li', { 'data-sec': k }, myDashLink(path, { class: 'dash-row dash-sec' }, [
    el('span', { class: 'dash-sec-ic', 'aria-hidden': 'true', html: icon(ic, 16) }),
    el('span', { class: 'dash-row-main' }, [
      el('span', { class: 'dash-row-k' }, name),
      el('span', { class: 'dash-row-t' }, [el('strong', {}, t), chip]),
      el('span', { class: 'dash-row-s' }, s),
    ]),
    el('span', { class: 'dash-row-go', 'aria-hidden': 'true', html: MYDASH_CHEVRON }),
  ]));
  const kindOf = (c) => { const b = kindBadge(rowKind(c), { link: false }); b.classList.add('ls-badge'); return b; };
  sec.append(el('ul', { class: 'dash-list dash-sec-list' }, [
    recent
      ? row({ k: 'recent', ic: 'search', name: 'Recently opened', path: companyPath(recent.c), t: `${recent.c.tk} — ${recent.c.name}`,
          s: 'The company you opened last. Open it again from here.', chip: kindOf(recent.c) })
      : row({ k: 'recent', ic: 'search', name: 'Recently opened', path: '/research', t: 'None yet',
          s: 'The company you open last is listed here, one press away.' }),
    row({ k: 'properties', ic: 'home', name: 'Saved properties', path: '/property/models', t: 'None yet',
      s: o.sampleProps ? 'Saved with only the sample inputs, a property is not counted as yours.' : 'A property you save in the Scenario Lab or the calculator.' }),
    row({ k: 'watchlists', ic: 'list', name: 'Watchlists', path: '/my/watchlists', t: 'None of your own yet',
      s: o.sampleLists.length ? 'The sample lists are not yours, and are not counted.' : 'The companies you follow, in a list of your own.' }),
    row({ k: 'setups', ic: 'target', name: 'Scanner setups', path: '/app/scanner/setups', t: 'None yet',
      s: 'Conditions you write, checked on the price history you supply.' }),
    row({ k: 'alerts', ic: 'bell', name: 'Your alerts', path: '/my/alerts', t: 'None yet',
      s: 'Research, price and screen alerts you set, and your setups’ matches where the scanner’s record is held. Sample alerts are not counted.' }),
  ]));
  return sec;
}

/* The five counts of a returning reader, each a door to the page it counts. */
function myDashTiles(o, visit, st) {
  const tiles = el('div', { class: 'dash-tiles' });
  /* Recently opened: the last company, by name, a press away. */
  const recent = myDashRecent(o);
  const last = recent[0] || null;
  tiles.append(last
    ? myDashTile({ icon: 'search', label: 'Recently opened', tile: 'recent', path: companyPath(last.c), value: last.c.tk,
        sub: `${last.c.name}${recent.length > 1 ? ` · before it ${recent.slice(1, 3).map(r => r.c.tk).join(', ')}` : ''}`,
        kind: rowKind(last.c), fine: { filed: 'Its statements, as filed with the US SEC', yours: 'Statements you supplied' }[rowKind(last.c)] || ILLUS_TITLE.replace(/\.$/, '') })
    : myDashTile({ icon: 'search', label: 'Recently opened', tile: 'recent', path: '/research', value: 'None yet',
        sub: 'The company you open last is listed here' }));
  /* Saved properties: the reader's own, the newest named. */
  const props = o.savedProps;
  tiles.append(myDashTile({ icon: 'home', label: 'Saved properties', tile: 'properties', path: '/property/models', value: String(props.length),
    sub: props.length ? `Newest: “${props[0].name}”` : 'None saved yet',
    note: o.sampleProps ? `${myDashPlural(o.sampleProps, 'property', 'properties')} with only the sample inputs, not counted` : null }));
  tiles.append(myDashTile({ icon: 'grid', label: 'Instruments watchlisted', tile: 'watchlists', path: '/my/watchlists',
    value: String(o.instruments.size),
    sub: o.instruments.size ? `Added by you, in ${myDashPlural(o.lists.length, 'list')}` : 'None added by you yet',
    note: o.sampleLists.length ? 'Sample companies not counted' : null }));
  const fa = o.fileActive;
  /* Active as the worker counts it: enabled, and not past its expiry date. */
  const today = new Date().toISOString().slice(0, 10);
  const browserOn = o.setups.filter(s => s.enabled !== false && !(s.expires && s.expires < today)).length;
  tiles.append(myDashTile({ icon: 'target', label: 'Active setups', tile: 'setups', path: '/app/scanner/setups',
    value: String(fa ? Math.max(0, fa.enabled - fa.expired) : browserOn),
    sub: fa ? `Of ${fa.valid} valid in the worker’s file${o.setups.length ? ` · ${o.setups.length} saved here` : ''}`
      : o.setups.length ? `Of ${myDashPlural(o.setups.length, 'setup')} saved in this browser — the worker runs them once exported` : 'None saved yet' }));
  /* YOUR ALERTS. The research, price and screen alerts the reader set, and
     the scanner's matches where its record is held here — new since the
     last visit, else unread as the sidebar's badge counts them
     (scanUnreadCount: a muted setup's left out, and named). Each part is
     said; the seeded samples are not one of them, and the line says so. */
  const alertTime = (a) => Date.parse(a?.detectedAt || a?.recordedAt || '');
  const since = o.alerts && visit.prev ? o.alerts.filter(a => alertTime(a) > Date.parse(visit.prev)) : null;
  const undated = o.alerts ? o.alerts.filter(a => !Number.isFinite(alertTime(a))).length : 0;
  const newN = o.alerts && typeof scanAlertStatus === 'function' ? o.alerts.filter(a => scanAlertStatus(a, st) === 'NEW').length : null;
  const counted = newN !== null && typeof scanUnreadCount === 'function' ? scanUnreadCount() : null;
  const unread = counted ?? newN;
  const mutedN = counted !== null ? newN - counted : 0;
  const scanN = !o.alerts ? 0 : since ? since.length : unread;
  const scanSaid = !o.alerts ? (o.setupsKnown ? 'scanner matches: the record stays on the machine the worker runs on' : null)
    : since ? `${myDashPlural(since.length, 'new scanner match', 'new scanner matches')} since ${myDashWhen(visit.prev)} · ${unread} unread${undated ? ` · ${undated} with no recorded time` : ''}`
    : `${myDashPlural(unread, 'unread scanner match', 'unread scanner matches')}`;
  const mutedSaid = mutedN > 0 ? `${mutedN} more from muted setups, not counted` : null;
  const parts = [
    o.researchAlerts.length ? myDashPlural(o.researchAlerts.length, 'research alert') : null,
    o.priceAlerts.length ? myDashPlural(o.priceAlerts.length, 'price alert') : null,
    o.screenAlerts.length ? myDashPlural(o.screenAlerts.length, 'screen alert') : null,
    scanSaid, mutedSaid,
  ].filter(Boolean);
  const total = o.researchAlerts.length + o.priceAlerts.length + o.screenAlerts.length + scanN;
  tiles.append(myDashTile({ icon: 'bell', label: 'Your alerts', tile: 'alerts', path: '/my/alerts', value: String(total),
    sub: `${parts.length ? parts.join(' · ') : 'No research, price or screen alert set'} · sample alerts not counted` }));
  return tiles;
}

VIEWS.home = () => {
  const visit = myDashVisit();
  const o = myDashOwn();
  const steps = myDashSteps(o);
  /* On the layout system (37-layout-system.js; D12): its metric cards, its
     named sections, its type scale and its measure. */
  const wrap = el('div', { class: 'dash ls-page' });

  /* -- header ------------------------------------------------------------ */
  /* New is by when the worker recorded the match (detectedAt), not by its
     bar: a bar is a session's date, and a match found today can sit on
     yesterday's. A record written with no time cannot be placed either side
     of the visit, so it is named rather than counted. */
  const alertTime = (a) => Date.parse(a?.detectedAt || a?.recordedAt || '');
  const since = o.alerts && visit.prev ? o.alerts.filter(a => alertTime(a) > Date.parse(visit.prev)) : null;
  const undated = o.alerts ? o.alerts.filter(a => !Number.isFinite(alertTime(a))).length : 0;
  /* The lede is one line — what changed — and what qualifies it is the
     head's note (pageHead, 36-layouts.js; Release B). */
  const [lede, ledeNote] = !o.hasOwn
    ? ['Your first steps, each with its one action.', 'As you take them, this page fills with your own work — never with sample data or anyone else’s activity.']
    : !visit.prev ? ['This is the first visit this browser has recorded.', 'From the next one, the line above says what changed in between.']
    : !o.alerts ? [`Welcome back — you were last here ${myDashWhen(visit.prev)}.`, o.setupsKnown ? 'The scanner’s record of matches stays on the machine its worker runs on, so nothing new can be counted from it here.' : null]
    : since.length ? [`Since you were last here — ${myDashWhen(visit.prev)} — the scanner recorded ${myDashPlural(since.length, 'new match', 'new matches')} of your setups.`, null]
    : [`Nothing new in the scanner’s record since you were last here, ${myDashWhen(visit.prev)}.`, undated ? `${myDashPlural(undated, 'match', 'matches')} with no recorded time cannot be placed either side of it.` : null];
  /* The page's name is part of its heading. As an eyebrow <p> above an h1
     reading only "Good morning", heading navigation and the rotor never
     named the page, so the heading says "My Dashboard: Good morning". The
     eyebrow is My workspace's, as on every workspace page (pageKicker), and
     the page's name — the current tab of the header above — is the
     heading's first words for a screen reader.
     The greeting is the reader's clock's (data-now, NOW, 35-ui.js): the page
     is served drawn at a fixed clock (prerender.mjs), where it said "Good
     morning" at any hour, to a reader with no script for good, and turned
     into "Good evening" under the rest when the page was drawn. Served, it
     says "Welcome", true at any hour (and is kept out of sight while the
     script that greets at the hour it is comes down). */
  wrap.append(pageHead({ cls: 'dash-hd', title: [el('span', { class: 'sr-only' }, 'My Dashboard: '),
    el('span', { 'data-now': 'Welcome' }, myDashGreeting())], lede, note: ledeNote }));

  /* -- first time: the steps, and what the workspace holds (nothing yet) --- */
  if (!o.hasOwn) {
    const card = el('section', { class: 'card ls-section dash-start', 'aria-labelledby': 'dash-start-hd' });
    const top = el('div', { class: 'dash-start-top' });
    top.append(el('div', {}, [
      el('h2', { id: 'dash-start-hd', class: 'h-section' }, 'Set up your workspace'),
      /* "…and stays ticked once it is true" was kept by nothing: each step
         is read afresh, so Clear recent, which forgets the companies opened,
         un-ticked "Research a company". The step follows what it reads.
         No count of steps done (D12: a first visit shows no counts); each
         step's mark says whether it is. */
      el('p', { class: 'caption dash-start-lede' }, 'Each step is ticked from what this browser holds now.'),
    ]));
    card.append(top);
    const firstOpen = steps.findIndex(s => !s.done);
    card.append(el('ol', { class: 'dash-steps' }, steps.map((s, i) => myDashStepRow(s, i === firstOpen))));
    /* Beside the steps, the two ways in that are not steps: the preferences
       questions and the goal launcher. */
    const ways = el('section', { class: 'card ls-section dash-ways', 'aria-labelledby': 'dash-ways-hd' });
    ways.append(el('h2', { id: 'dash-ways-hd', class: 'h-card' }, 'Other ways in'));
    ways.append(el('div', { class: 'dash-more' }, [
      myDashLink('/welcome', { class: 'dash-more-link' }, [el('strong', {}, 'Set your preferences'),
        el('span', { class: 'caption' }, onboarded() && !State.onboarding?.skipped ? 'Answered — change your market, currency or level of detail.' : 'Four questions: your goal, your experience, your market and your currency.')]),
      myDashLink('/start', { class: 'dash-more-link' }, [el('strong', {}, 'Not sure where to start?'),
        el('span', { class: 'caption' }, 'Pick what you want to find out, and the right tool opens.')]),
    ]));
    /* The workspace's five parts, each "None yet" — and the company last
       opened, which a first visit can already have (D12 (b), (d)). */
    const main = el('div', { class: 'dash-side' }, [card, myDashSections(o)]);
    const aside = el('div', { class: 'dash-side' }, [ways, o.samples ? myDashSampleNote() : null]);
    wrap.append(el('div', { class: 'dash-first' }, [main, aside]));
    wrap.append(myDashFoot());
    return wrap;
  }

  /* -- returning: the reader's work first, as five counts, each a door ----- */
  /* (D12 (e)): the company last opened, the saved properties, the
     watchlists, the setups and the alerts, before any step not yet taken.
     Unread scanner matches are as the sidebar's badge counts them
     (scanUnreadCount): a setup muted in the scanner's settings is left out,
     and named. */
  const st = typeof scanAlertStateRead === 'function' ? scanAlertStateRead() : {};
  wrap.append(myDashTiles(o, visit, st));

  /* ONE NEXT ACTION (audit 1, #9). A returning reader's next action is to
     carry on with the most recent thing they made, so "Continue" on it is the
     page's one primary button; the first step not taken was a second one, of
     the same weight, on the same screen. With nothing to continue — a
     scanner record and nothing saved — the first step keeps it.
     The card holding that action leads the left column, above the record;
     the steps not taken move to the right. On a phone the page stacks in
     that order, so the one action is the first thing under the counts, not
     below three steps; with nothing to continue, the record and the steps
     keep the left, as before. */
  const split = el('div', { class: 'dash-split' });
  const main = el('div', { class: 'dash-side' });
  const side = el('div', { class: 'dash-side' });
  const cont = myDashContinue(o);
  const continues = !!cont.querySelector('.dash-continue.btn-primary');
  if (continues) main.append(cont);
  main.append(myDashMatches(o, st));
  const open = steps.filter(s => !s.done);
  if (open.length) {
    const ns = el('section', { class: 'card ls-section', 'aria-labelledby': 'dash-next-hd' });
    ns.append(el('div', { class: 'card-hd card-hd-tight' }, el('div', {}, [
      el('h2', { id: 'dash-next-hd', class: 'h-card' }, 'Next steps'),
      el('p', { class: 'caption', style: 'margin-top:2px' }, `${myDashPlural(open.length, 'first step')} not taken yet.`),
    ])));
    ns.append(el('ol', { class: 'dash-steps dash-steps-sm' }, open.map((s, i) => myDashStepRow(s, !continues && i === 0))));
    (continues ? side : main).append(ns);
  }
  if (!continues) side.append(cont);
  if (o.samples) side.append(myDashSampleNote());
  split.append(main, side);
  wrap.append(split);
  wrap.append(myDashFoot());
  return wrap;
};

/* The latest matches, from the worker's record in date order — the alerts
   page's own order, which is never a ranking. Each row opens its alert. The
   setup's name is the reader's own title, quoted and attributed as theirs
   ("your setup"), so a name like "Buy on the cross" reads as what they called
   a rule, not as something this page says. */
function myDashMatches(o, st) {
  const card = el('section', { class: 'card ls-section dash-matches', 'aria-labelledby': 'dash-matches-hd' });
  const hd = el('div', { class: 'card-hd' });
  hd.append(el('div', {}, [
    el('h2', { id: 'dash-matches-hd', class: 'h-card' }, 'Latest setup matches'),
    el('p', { class: 'caption', style: 'margin-top:2px;max-width:60ch' }, 'Newest bar first, from the scanner’s record: the bars on which your own conditions held. A record, not a signal.'),
  ]));
  if (o.alerts?.length) hd.append(myDashLink('/app/scanner/alerts', { class: 'btn btn-ghost btn-sm' }, 'All alerts'));
  card.append(hd);
  const S = o.scan && typeof SCAN_STATE !== 'undefined' ? SCAN_STATE[o.scan.state] : null;
  if (S && o.scan.state !== 'never') {
    const ls = o.scan.lastSuccess, at = ls ? String(ls.finishedAt || ls.startedAt || '').slice(0, 10) : null;
    card.append(el('div', { class: 'row row-wrap dash-scanline' }, [sevChip(S.sev, S.label),
      el('span', { class: 'metaline' }, at ? `Last successful scan ${at}, on bars to ${ls.asOf || 'an unrecorded date'}.` : 'No scan has succeeded yet.'),
      myDashLink('/app/scanner', { class: 'dash-inline' }, 'Scanner status')]));
  }
  const empty = (title, text, path, label) => el('div', { class: 'dash-empty' }, [
    el('p', { class: 'dash-empty-t' }, title), el('p', { class: 'caption' }, text),
    myDashLink(path, { class: 'btn btn-ghost btn-sm' }, label)]);
  if (!o.alerts) {
    card.append(o.setupsKnown
      ? empty('No record can be seen from here', 'The worker writes its record of matches on the machine it runs on, and it never leaves that machine — so on this site there is nothing to list. Where the worker runs, run it once and reload.', '/app/scanner', 'Open the scanner')
      : empty('No setup yet', 'A setup is the conditions you look for. Write one, and each bar on which it holds is recorded here.', '/app/scanner/setups/new', productById('scanner')?.action || 'Create a setup'));
    return card;
  }
  if (!o.alerts.length) {
    card.append(empty('Nothing recorded yet', 'No setup of yours has matched on a bar the worker has evaluated. An empty record is the normal state of tight conditions, not a fault.', '/app/scanner/setups', 'Your setups'));
    return card;
  }
  const EVENT = { NEW_MATCH: 'new match', MATCH: 'match', FIRST_OBSERVED: 'first observed' };
  const nameOf = (a) => o.scanSt?.setups?.[a.setupId]?.name || a.setupName || a.setupId || 'a setup';
  const ul = el('ul', { class: 'dash-list' });
  o.alerts.slice(0, 5).forEach(a => {
    const isNew = typeof scanAlertStatus === 'function' && scanAlertStatus(a, st) === 'NEW';
    const bar = scanAlertBar(a) || 'an unrecorded bar';
    ul.append(el('li', {}, myDashLink(scanAlertPath(a), { class: 'dash-row' }, [
      el('span', { class: 'dash-row-main' }, [
        el('span', { class: 'dash-row-t' }, [el('strong', {}, a.symbol || a.instrumentId || '—'),
          el('span', { class: 'metaline' }, bar), isNew ? el('span', { class: 'chip chip-brand' }, 'new') : null]),
        el('span', { class: 'dash-row-s' }, `Your setup “${nameOf(a)}”${a.setupVersion != null ? ` v${a.setupVersion}` : ''} · ${EVENT[a.eventType] || 'match'}`),
      ]),
      el('span', { class: 'dash-row-go', 'aria-hidden': 'true', html: MYDASH_CHEVRON }),
    ])));
  });
  card.append(ul);
  if (o.alerts.length > 5) card.append(el('p', { class: 'metaline', style: 'margin-top:var(--xs)' },
    `The five newest of ${o.alerts.length} recorded matches.`));
  return card;
}

/* The most recent things the reader made, with the action that reopens each —
   the workspace's own open, so an item behaves here as it does there — and
   the companies they last read. A company with illustrative figures says so
   wherever it is named. */
function myDashContinue(o) {
  const card = el('section', { class: 'card ls-section dash-cont-card', 'aria-labelledby': 'dash-cont-hd' });
  card.append(el('div', { class: 'card-hd card-hd-tight' }, el('div', {}, [
    el('h2', { id: 'dash-cont-hd', class: 'h-card' }, 'Continue where you left off'),
    el('p', { class: 'caption', style: 'margin-top:2px' }, 'Your most recent work in this browser, newest first.'),
  ])));
  const t = (v) => { const n = Date.parse(String(v || '').replace(' ', 'T') + (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(String(v || '')) ? 'Z' : '')); return Number.isFinite(n) ? n : -Infinity; };
  const kindOne = typeof WORKSPACE_KIND_ONE !== 'undefined' ? WORKSPACE_KIND_ONE : {};
  const rows = [
    /* A saved property is called one (D12), not a "Tool snapshot", and
       reopens where Property opens — the Scenario Lab, at its own address
       (/property?model=…, labArrive), a link like any other. */
    ...o.saved.map(i => (i.prop
      ? { at: t(i.created), when: i.created, kind: 'Saved property', name: i.name, detail: i.detail,
          moved: ['model', 'data', 'both'].includes(i.diff?.status) ? i.diff : null, path: myDashPropPath({ id: i.key }) }
      : { at: t(i.created), when: i.created, kind: kindOne[i.kind] || 'Saved item', name: i.name, detail: i.detail,
          illus: i.illustrative, moved: ['model', 'data', 'both'].includes(i.diff?.status) ? i.diff : null, open: () => i.open(), opens: i.path || null,
          act: el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `${i.kind === 'work' ? 'Resume' : 'Open'} ${i.name}`, 'data-tool-path': i.path || null, onclick: () => i.open() }, i.kind === 'work' ? 'Resume' : 'Open') })),
    /* A list names what the visitor put in it; a sample list says how many of
       its companies are samples. Its chip is the workspace's rule: every
       company illustrative, or some. */
    ...o.lists.map(w => {
      const own = myDashOwnIds(w).length, rest = (w.ids || []).length - own;
      const rows = (w.ids || []).map(id => BY_ID.get(id)).filter(Boolean);
      const illN = rows.filter(r => !r.c.real).length;
      return { at: t(w.updatedAt || w.createdAt), when: w.updatedAt || w.createdAt, kind: rest ? 'Watchlist · sample list' : 'Watchlist', name: w.name,
        detail: rest ? `${myDashPlural(own, 'company', 'companies')} added by you · ${rest} sample` : myDashPlural(own, 'company', 'companies'),
        illus: illN && illN === rows.length ? 'all' : illN ? 'some' : null, path: '/my/watchlists' };
    }),
    ...o.setups.map(s => ({ at: t(s.updated || s.created), when: s.updated || s.created, kind: 'Scanner setup', name: s.name || s.id,
      detail: `v${s.version} · ${s.enabled === false ? 'disabled' : 'enabled'}`, path: scanSetupPath(s.id) })),
    ...o.portfolios.map(p => ({ at: -Infinity, when: null, kind: 'Portfolio', name: p.name, detail: myDashPlural(p.holdings.length, 'holding'), path: '/my/portfolio' })),
    /* In progress only while it holds unsaved work: a saved property left as
       saved is already listed as itself, and was listed twice. */
    ...(o.dealStarted && (typeof propertyHasUnsavedWork !== 'function' || propertyHasUnsavedWork()) ? [{ at: -Infinity, when: null, kind: 'Property deal in progress', name: typeof WORK_KINDS !== 'undefined' ? WORK_KINDS.property.name() : 'Your deal',
      detail: 'Kept in this browser as you edit', path: '/property/calculator' }] : []),
    ...(o.priceAlerts.length ? [{ at: -Infinity, when: null, kind: 'Price alerts', name: myDashPlural(o.priceAlerts.length, 'price alert') + ' of your own',
      detail: 'Kept in this browser', path: '/my/alerts' }] : []),
  ].sort((a, b) => b.at - a.at).slice(0, 6);
  if (!rows.length) {
    card.append(el('div', { class: 'dash-empty' }, [
      el('p', { class: 'dash-empty-t' }, 'Nothing saved in this browser yet'),
      el('p', { class: 'caption' }, 'A saved property, a valuation run, a comparison, a screen or an investment case appears here with the action that reopens it.'),
      myDashLink('/my/workspace', { class: 'btn btn-ghost btn-sm' }, 'Saved models')]));
  } else {
    card.querySelector('.card-hd').append(myDashLink('/my/workspace', { class: 'btn btn-ghost btn-sm dash-all' }, 'All saved work'));
    const ul = el('ul', { class: 'dash-list dash-cont' });
    rows.forEach((r, i) => {
      /* One clock on the page: the reader's. The lede gives the last visit in
         local time; these rows gave UTC with an ISO date, so a list edited an
         hour ago read as older than a visit five hours ago. A bare date has no
         time of day to convert and is printed as the date it is. */
      const when = !r.when ? null : String(r.when).length <= 10
        ? new Date(`${String(r.when)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : Number.isFinite(r.at) ? myDashWhen(r.at) : null;
      const meta = [r.detail, when].filter(Boolean).join(' · ');
      const chips = [
        r.illus === 'all' ? el('span', { class: 'chip chip-bronze', title: ILLUS_TITLE }, 'illustrative figures')
          : r.illus === 'some' ? el('span', { class: 'chip chip-bronze', title: 'Some of the companies in it carry synthetic figures.' }, 'partly illustrative') : null,
        r.moved ? el('span', { class: 'chip chip-warn', title: r.moved.text }, r.moved.label) : null,
      ].filter(Boolean);
      const main = el('span', { class: 'dash-row-main' }, [
        el('span', { class: 'dash-row-k' }, r.kind),
        el('span', { class: 'dash-row-t' }, [el('strong', {}, r.name), ...chips]),
        el('span', { class: 'dash-row-s' }, meta),
      ]);
      /* The newest carries the page's one primary action, "Continue" — its
         own open where it has one (a saved item reopens as the workspace
         reopens it), else the page it lives on. The button names the tool
         it reopens and passes the shell's gate now, as the link does, so
         a saved screen or comparison whose tool cannot be used here is
         text, and the page's one primary action falls to the first step. */
      if (i === 0) {
        const name = `Continue: ${r.name}`;
        const go = r.open
          ? myDashGate(el('button', { type: 'button', class: 'btn btn-primary btn-sm dash-continue', 'aria-label': name, 'data-tool-path': r.opens, onclick: r.open }, 'Continue'))
          : myDashLink(r.path, { class: 'btn btn-primary btn-sm dash-continue', 'aria-label': name }, 'Continue');
        ul.append(el('li', {}, el('div', { class: 'dash-row dash-row-act dash-row-first' }, [main, go])));
        return;
      }
      ul.append(el('li', {}, r.path
        ? myDashLink(r.path, { class: 'dash-row' }, [main, el('span', { class: 'dash-row-go', 'aria-hidden': 'true', html: MYDASH_CHEVRON })])
        : el('div', { class: 'dash-row dash-row-act' }, [main, r.act])));
    });
    card.append(ul);
  }
  const recent = o.researched.slice(0, 5).map(id => BY_ID.get(id)).filter(Boolean);
  if (recent.length) {
    card.append(el('p', { class: 'stat-label', style: 'margin-top:var(--md)' }, 'Recently opened companies'));
    card.append(el('div', { class: 'dash-cos' }, recent.map(r => myDashLink(companyPath(r.c), { class: 'dash-co', title: r.c.real ? r.c.name : `${r.c.name} — ${ILLUS_TITLE}` },
      [el('strong', {}, r.c.tk), illusChip(r.c)]))));
  }
  return card;
}

/* The seeded samples are real rows in this browser's store; the page leaves
   them out of every count, and says so, so the Watchlists page's two lists
   and this page's "no list of your own" do not read as a contradiction. */
function myDashSampleNote() {
  return el('div', { class: 'dash-note' }, [
    el('span', { class: 'chip chip-bronze' }, 'Sample data'),
    /* What this browser was given is said by the page drawn in it (NOW,
       35-ui.js): served to a reader whose browser runs no script, it was
       given nothing. */
    el('p', { class: 'caption', 'data-now': 'Sample watchlists, holdings, investment cases and price alerts are given to a browser running this page’s script, so other pages have something to show. This page counts none of them.' },
      'This browser was given sample watchlists, holdings, investment cases and price alerts so the other pages have something to show. They are not yours, and nothing on this page counts them.'),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { clearSeededData(); focusAfterRedraw('#views h1'); } }, 'Clear the sample data'),
  ]);
}

/* Where all of this lives, said once, and the way to the copy that travels. */
function myDashFoot() {
  const p = el('p', { class: 'caption dash-foot' }, [
    'Everything on this page is read from this browser and the scanner’s own record — there is no account, and nothing syncs. The export on ',
    myDashLink('/my/data', { class: 'dash-inline' }, 'Your data & settings'), ' is the copy that travels.',
  ]);
  /* The research queue this page used to be, while its address resolves. */
  if (myDashRoutes('/research/queue')) p.append(' The equities research queue — market context and what changed across companies — is now the ',
    myDashLink('/research/queue', { class: 'dash-inline' }, 'Research queue'), ' tab of Equities Research.');
  return p;
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
/* Every field publishes its formula, period and missing-data behaviour — as
   a projection of the metric registry (13-metrics.js), which is where a
   measure is defined. A blocked measure (a line the statements do not carry)
   is in the registry and the dictionary but not here, so no screener column
   offers a figure that can never arrive; interest cover is the exception,
   kept as the column it has always been and reported missing on every row. */
const FIELDS = METRICS.filter(x => x.screener !== false).map(metricField);
const FIELD_BY_K = Object.fromEntries(FIELDS.map(f => [f.k, f]));
const FIELD_GROUPS = [...new Set(FIELDS.map(f => f.g))];
/* The screener's three fixed score columns carry their own keys and their own
   pill renderers. This maps them to the fields behind them, so an absent score
   says why and a present one opens its drawer like any other cell. */
const SCORE_COL_FIELD = { quality: 'qscore', value: 'vscore', mos: 'mosBase' };
/* WHICH MEASURES NEED A PRICE (9 Oct audit #8). Read from the registry, not
   listed by hand: a measure whose inputs include the quoted price or the
   reader's own price history. The SEC-filed companies carry no licensed
   price, so on them every such measure is unavailable — and a template,
   a default column or a main filter built on one promised a result that
   universe cannot give. A fixed score column is read through the field
   behind it. */
const PRICE_INPUTS = ['price', 'history'];
/* How many measures a phone's result card carries, chosen by the reader. */
const CARD_MAX = 4;
const needsPrice = (k) => (METRIC_BY_K[SCORE_COL_FIELD[k] || k]?.inputs || []).some(l => PRICE_INPUTS.includes(l));

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
  /* On the SEC-filed companies, which carry no price, Essentials leads with
     what their statements hold — margins, returns, growth, leverage and cash
     flow — rather than three columns that read "no price" on every row. */
  { id:'essentials', label:'Essentials',
    cols:['roic', 'om', 'pe', 'dy', 'fcfy', 'ndEbit'],
    filed:['roic', 'om', 'fcfm', 'rev5', 'ndEbit', 'cashconv'],
    why:'The set the screener opens with — one measure from each group. On the SEC-filed companies, which carry no price, cash flow and growth stand in for the price measures.' },
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
/* A preset's columns on one evidence class: its filed set where it has one. */
const presetCols = (p, cls) => (cls === 'filed' && p.filed ? p.filed : p.cols);
const samePreset = (cols, p, cls = screenClassOf(State.screen)) => {
  const want = presetCols(p, cls);
  return cols.length === want.length && want.every(k => cols.includes(k));
};

/* Sector-specific measures are not general screener fields, but thesis
   conditions and alerts still need to render them with their units. */
const SECTOR_FMT = {
  npl: v => fmtPct(v, 2), cet1: v => fmtPct(v, 1), nim: v => fmtPct(v, 2), cir: v => fmtPct(v, 1),
  casa: v => fmtPct(v, 1), ldr: v => fmtPct(v, 1), occ: v => fmtPct(v, 1), gearing: v => fmtPct(v, 1),
  cap: v => fmtPct(v, 1), wale: v => `${fmtNum(v, 1)} yrs`, dpuCover: v => fmtPct(v, 0), pnav: v => fmtX(v, 2),
};
const fmtFor = (k) => FIELD_BY_K[k]?.fmt || SECTOR_FMT[k] || ((v) => fmtNum(v, 2));

function blankScreen(cls = 'filed') {
  return { evidence:cls, universe:'all', sectors:[], types:[], mode:'abs', minCoverage:60,
           crit:{}, local:{ shariahOnly:false, excludePn17:true, klciOnly:false },
           cols:[...presetCols(COL_PRESETS[0], cls)], sort:{ k:'quality', dir:-1 } };
}
/* A screen moved to another evidence class takes that class's Essentials
   if it was showing the other's; columns the reader chose stay. */
function setScreenClass(s, k) {
  const was = screenClassOf(s);
  if (was === k) return s;
  if (Array.isArray(s.cols) && samePreset(s.cols, COL_PRESETS[0], was)) s.cols = [...presetCols(COL_PRESETS[0], k)];
  s.evidence = k;
  return s;
}

/* THE TWO EVIDENCE CLASSES ARE NEVER MIXED BY DEFAULT (the owner's second
   track, 8 Oct 2026). The screener ranked 119 companies' audited SEC
   statements and 19 illustrative companies' synthetic figures in one table,
   under one count and one set of medians — the filed set with no price, the
   synthetic set with sample prices — so a price filter emptied the filed
   half and a quality sort interleaved real and made-up numbers. A screen now
   covers one class: SEC-filed (the default) or Illustrative, chosen in the
   Coverage selector above the results. Both together stays available, as an
   explicit choice that says in one line what mixing means. A screen saved
   before this carries no class and is read as both together, as it ran. */
const SCREEN_CLASSES = {
  filed:        { label: 'SEC-filed',    note: 'Audited annual statements filed with the US SEC. No licensed prices, so every price-based measure is unavailable for these companies — the screen leads with revenue, margins, returns, leverage and cash flow.' },
  illustrative: { label: 'Illustrative', note: 'Synthetic figures that describe no real company, with sample prices. For trying the screener, not for research.' },
};
const SCREEN_MIX_WARNING = 'Both classes together: illustrative figures are synthetic, and the SEC-filed companies have no licensed prices — the two are not comparable.';
const screenClassOf = (sc) => (sc && (sc.evidence === 'filed' || sc.evidence === 'illustrative' || sc.evidence === 'mixed') ? sc.evidence : 'mixed');
const inScreenClass = (row, cls) => cls === 'mixed' || (cls === 'filed' ? !!row.c.real : !row.c.real);
/* The kind a result's figures are (D6): a filer's Filed, the owner's own
   statements Yours, a synthetic company Illustrative. */
const rowKind = (c) => (c.real ? (c.personal ? 'yours' : 'filed') : 'illustrative');
/* No company filed with the SEC is listed on Bursa Malaysia: the Bursa set
   is illustrative only. A screen that asks for Bursa on the filed class —
   a template, the research home's Bursa card, the market chosen at
   onboarding — covers the illustrative set instead, rather than coming up
   empty. */
function screenFitClass(s) {
  if (s && s.universe === 'MY' && screenClassOf(s) === 'filed') setScreenClass(s, 'illustrative');
  return s;
}
/* The market chosen at onboarding, or in the launcher's "Screen a market",
   is the screener's default from then on — the question says it "sets the
   default market filter on the screener". Both wrote it to storage and
   nothing read it back, so it lasted until the next reload. Only the market
   is taken back: the rest of a screen is the session's. */
State.screen = State.screen || (() => {
  const s = blankScreen(), kept = store.read('screen', null);
  if (['US', 'MY'].includes(kept?.universe)) s.universe = kept.universe;
  return screenFitClass(s);
})();
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
/* Interest cover is blocked (13-metrics.js): interest expense has no column
   in the stored statements, so as a threshold it failed every company, and
   the two templates that set one returned nothing, ever — "Conservative
   balance sheet" 0 of 138, every company excluded for a figure no company
   carries. The rule is carried the way section 18.1 carries its governance
   rule: stated beside the results and not applied, rather than applied to
   empty the screen or dropped without a word. */
const ICOV_UNTESTABLE = (min) => ({ rule: `interest cover ≥ ${min}×`,
  because: `${METRIC_BY_K.icov.blocked} As a threshold it would exclude every company, so it is stated here and not applied — check interest cover in the filings before treating a match as complete.` });
const SCREEN_TEMPLATES = [
  /* THE FILED-FRIENDLY TEMPLATES FIRST (9 Oct audit #8). Each tests only
     measures the SEC-filed statements carry — revenue, margins, returns,
     leverage and cash flow — so it runs on the filed companies as it does on
     the illustrative set. A threshold is the rule the name states, not a
     judgement that clearing it is good. */
  { id:'returns-capital', name:'High returns on capital',
    why:'A return on invested capital and a return on equity both of 15% or more in the latest year — both, so a return on equity raised by borrowing alone does not clear it.',
    apply: (s) => { s.crit = { roic:{min:15}, roe:{min:15} }; s.cols = ['roic','roe','om','fcfm','ndEbit','rev5']; } },
  { id:'cash-backed', name:'Profit that arrives as cash',
    why:'Operating cash flow of at least 90% of net income, a free cash flow margin of 5% or more, and operating cash flow above zero in at least four of the last five years.',
    apply: (s) => { s.crit = { cashconv:{min:90}, fcfm:{min:5}, ocfPosYears:{min:4} }; s.cols = ['cashconv','fcfm','ocfm','ocfPosYears','reinv','roic']; } },
  { id:'growth-margins', name:'Growth with margins intact',
    why:'Revenue compounding at 5% a year or more over four years, with an operating margin of at least 10% and a free cash flow margin of zero or more in the latest year — growth that is not bought at a loss.',
    apply: (s) => { s.crit = { rev5:{min:5}, om:{min:10}, fcfm:{min:0} }; s.cols = ['rev5','revYoY','om','fcfm','eps5','revDD']; } },
  { id:'consistent', name:'Consistent profitability',
    why:'A steady operating record rather than one good year — low earnings variability and no deep revenue drawdown.',
    apply: (s) => { s.crit = { om:{min:8}, epsVol:{max:25}, revDD:{max:20} }; s.cols = ['om','epsVol','revDD','roic','rev5','fcfm']; } },
  { id:'conservative', name:'Conservative balance sheet',
    why:'Low borrowings against operating profit, with interest comfortably covered.',
    untestable:[ICOV_UNTESTABLE(6)],
    apply: (s) => { s.crit = { ndEbit:{max:1.5}, de:{max:0.6} }; s.cols = ['ndEbit','de','icov','roic','om','fcfm']; } },
  { id:'net-cash', name:'Net cash balance sheet',
    why:'Cash and equivalents at or above total debt at the latest year-end. It says what the balance sheet holds, not whether the cash is needed in the business.',
    apply: (s) => { s.crit = { netGearing:{max:0} }; s.cols = ['netGearing','de','ndEbit','fcfm','cashconv','roe']; } },

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
    untestable:[ICOV_UNTESTABLE(3)],
    apply: (s) => { s.universe='MY'; s.sectors=['Industrials','Utilities']; s.crit = { ndEbit:{max:4} }; s.cols = ['ndEbit','icov','om','rev5','roic','pe']; } },
  { id:'shariah', name:'Shariah-compliant universe',
    why:'Only companies flagged Shariah-compliant in this dataset. The flag is carried from the source, not assessed here.',
    apply: (s) => { s.universe='MY'; s.local = { ...s.local, shariahOnly:true }; s.cols = ['roic','om','ndEbit','dy','pe','fcfy']; } },
  { id:'no-pn17', name:'Excluding PN17 and GN3',
    why:'Removes companies under Bursa financial-distress classifications. This is an exclusion, not an endorsement of what remains.',
    apply: (s) => { s.universe='MY'; s.local = { ...s.local, excludePn17:true }; s.cols = ['roic','ndEbit','icov','om','dy','pe']; } },
];

/* WHERE A TEMPLATE CAN RUN (9 Oct audit #8). Read from what the template
   sets, not from a list kept beside it: a threshold on a measure that needs
   a price (needsPrice, from the registry) can only be met where prices are
   held — the illustrative set — and a Bursa market holds no SEC-filed
   company. On a class that cannot answer it the template is shown off, with
   its reason and the way to run it on the illustrative set; it never runs
   silently over companies whose figure is unavailable. Both classes
   together counts as covering the filed companies: half the screen would
   be excluded for a price it cannot hold. */
const TEMPLATE_OFF = {
  price: 'Needs a price; filed companies carry none — available on the illustrative set',
  bursa: 'Covers Bursa Malaysia, where no company is SEC-filed — available on the illustrative set',
};
function templateNeeds(t) {
  const s = blankScreen();
  t.apply(s);
  const priced = Object.entries(s.crit || {})
    .filter(([k, c]) => c && (c.min != null || c.max != null) && needsPrice(k)).map(([k]) => k);
  return { priced, bursa: s.universe === 'MY' };
}
function templateOff(t, cls) {
  if (cls === 'illustrative') return null;
  const n = templateNeeds(t);
  if (n.priced.length) return TEMPLATE_OFF.price;
  if (n.bursa && cls === 'filed') return TEMPLATE_OFF.bursa;
  return null;
}
/* The screen a template produces on a class: on the class asked for where
   it can run there, on the illustrative set where it cannot. A template
   sets thresholds, not the evidence class, so otherwise the class stays. */
function templateScreen(t, cls = 'filed') {
  const s = blankScreen(cls);
  t.apply(s);
  if (templateOff(t, cls)) setScreenClass(s, 'illustrative');
  return screenFitClass(s);
}
function applyTemplate(t, onClass = null) {
  State.screen = templateScreen(t, onClass || (State.screen ? screenClassOf(State.screen) : 'filed'));
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
  /* The evidence class first: a company of the other class is outside the
     screen, whatever its figures. */
  const cls = screenClassOf(sc);
  if (!inScreenClass(row, cls)) fails.push(cls === 'filed' ? 'Illustrative figures — this screen covers the SEC-filed companies' : 'Filed with the SEC — this screen covers the illustrative set');
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
      /* Missing data never passes a threshold silently, and is never read
         as a zero — which would pass a maximum and fail a minimum for a
         figure nobody holds. The company is excluded as not held, with the
         reason its figure is absent (metricStatus: no price, n/a, not
         reported, withheld, n/m). */
      const st = metricStatus(row, k);
      fails.push(`${f.label} is not held${st.reason ? ` (${st.reason})` : ''} — excluded, never counted as zero${f.miss ? '. ' + f.miss.replace(/\.$/, '') : ''}`);
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
  /* A company without the figure sorts after every company with one, in
     either direction, and never as a zero. Two without it keep their order:
     "both missing" answered 1, which is no ordering at all, so where they
     landed depended on the engine's sort. */
  return [...rows].sort((a, b) => {
    const av = get(a), bv = get(b), ah = isNum(av), bh = isNum(bv);
    if (!ah || !bh) return ah === bh ? 0 : (ah ? -1 : 1);
    return (av - bv) * sc.sort.dir;
  });
}

/* Re-render and hand focus back to the control that asked for it. render()
   replaces the whole view, so the focused slider, select or checkbox was
   destroyed under the reader: one arrow press moved the completeness slider,
   focus fell to <body>, and the next press did nothing. Controls that re-render
   carry an id, and focus returns to the new element with the same id.
   At once, by id; render() then puts back the caret or the selection the
   field had (noteFocusForRedraw, 35-ui.js), so a figure Tab selected is
   still selected for typing to replace. */
function renderKeepFocus() {
  const id = document.activeElement?.id;
  render();
  if (id) document.getElementById(id)?.focus({ preventScroll: true });
}

/* What the screener last said its count was, and the live region that says
   a new one. The region is emptied a moment later, so the words do not sit
   in the page after they have been read. */
let screenMatchSaid = null, liveSayTimer = null;
function liveSay(text) {
  const live = $('#liveStatus');
  if (!live) return;
  live.textContent = text;
  clearTimeout(liveSayTimer);
  liveSayTimer = setTimeout(() => { if (live.textContent === text) live.textContent = ''; }, 5000);
}
function renderScreener() {
  const sc = State.screen;
  /* A template whose criteria have since been changed is no longer applied —
     its pressed state and its banner go with it. */
  if (State.appliedTemplate && !templateStillApplies(sc)) State.appliedTemplate = null;
  /* With no filed company held — the filed statements did not load, and the
     page paints the illustrative sample, labelled — the SEC-filed class
     would cover nothing: the screen covers the illustrative set, and the
     selector says so. */
  if (screenClassOf(sc) === 'filed' && !U.some(r => r.c.real)) setScreenClass(sc, 'illustrative');
  const wrap = el('div', { class: 'screener-layout' });
  /* The evidence class the screen covers, and the companies in it: every
     count, exclusion and median below is of these. */
  const cls = screenClassOf(sc);
  const scope = U.filter(r => inScreenClass(r, cls));
  const page = el('div', { class: 'scr-page' }, [screenClassBar(sc, cls), wrap]);

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
  const railHd = el('div', { class: 'scr-rail-hd', style: 'padding:var(--md);border-bottom:1px solid var(--line)' });
  railHd.append(el('div', { class: 'row' }, [
    el('h3', { class: 'h-card' }, 'Filters'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { State.screen = blankScreen(); render(); } }, 'Reset'),
  ]));
  /* Each strip of choices on the screener is a group named for what it
     chooses: a screen reader reached "Absolute, toggle button, pressed" and
     "MYR, toggle button, pressed" with no word of what either decided. */
  railHd.append(el('div', { class: 'segmented', role: 'group', 'aria-label': 'Thresholds as', style: 'margin-top:10px;width:100%' }, [
    el('button', { style: 'flex:1', 'aria-pressed': sc.mode === 'abs' ? 'true' : 'false', onclick: () => setMode('abs') }, 'Absolute'),
    el('button', { style: 'flex:1', 'aria-pressed': sc.mode === 'pct' ? 'true' : 'false',
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
  const railBody = el('div', { class: 'scr-rail-body', style: 'padding:var(--md)' });
  /* Two groups, in reading order: which companies are screened (a template,
     the universe, completeness, the local filters), then what they must
     clear (business model, the main thresholds, the advanced ones). Beside
     the results they run one under the other, as before; with the rail
     stacked above the results, across the page, they stand side by side
     instead of stretching every row to the page's width (styles.css,
     .screener-layout). The order a reader and the keyboard meet them is the
     same either way. */
  const railScope = el('div', { class: 'scr-rail-group' });
  const railRules = el('div', { class: 'scr-rail-group' });
  railBody.append(railScope, railRules);

  /* Templates first: a starting point beats an empty form, and each one states
     what it tests rather than what the result is worth. */
  const tpl = el('details', { style: 'margin-bottom:var(--md)' });
  tpl.append(el('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-2);padding:4px 0' },
    'Start from a template'));
  const tplList = el('div', { class: 'scr-tpl-list' });
  /* The templates this class can answer, as before; then, apart, the ones it
     cannot — off, each with its reason and the way to run it where it can
     run (templateOff). */
  const tplOff = SCREEN_TEMPLATES.map(t => [t, templateOff(t, cls)]);
  tplOff.filter(([, off]) => !off).forEach(([t]) => {
    const b = el('button', { class: 'ob-option', style: 'padding:9px 11px', 'data-template': t.id,
      'aria-pressed': State.appliedTemplate === t.id ? 'true' : 'false',
      onclick: () => applyTemplate(t) });
    b.append(el('div', { class: 'ob-option-t', style: 'font-size:13px' }, t.name));
    b.append(el('div', { class: 'ob-option-n' }, t.why));
    tplList.append(b);
  });
  const offList = tplOff.filter(([, off]) => off);
  if (offList.length) {
    tplList.append(el('p', { class: 'scr-tpl-off-hd', id: 'scr-tpl-off-hd' }, `Illustrative set only · ${offList.length}`));
    offList.forEach(([t, off]) => {
      const nameId = `scr-tpl-${t.id}`;
      tplList.append(el('div', { class: 'scr-tpl-off', role: 'group', 'aria-labelledby': nameId, 'data-template': t.id, 'data-off': '' }, [
        el('div', { class: 'ob-option-t', id: nameId }, t.name),
        el('div', { class: 'ob-option-n' }, t.why),
        el('p', { class: 'scr-tpl-why' }, off),
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm scr-tpl-run', id: `scr-tpl-run-${t.id}`,
          'aria-label': `Run ${t.name} on the illustrative set`,
          onclick: () => applyTemplate(t, 'illustrative') }, ['Run on the illustrative set', el('span', { 'aria-hidden': 'true' }, ' →')]),
      ]));
    });
  }
  tpl.append(tplList);
  tpl.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'A template only sets thresholds. Every one is visible above and yours to change.'));
  railScope.append(tpl);

  /* universe */
  const uni = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  uni.append(el('label', { for: 'uniSel' }, 'Universe'));
  const uniSel = el('select', { class: 'select', id: 'uniSel', onchange: e => {
    sc.universe = e.target.value;
    const was = screenClassOf(sc);
    screenFitClass(sc);
    if (screenClassOf(sc) !== was) toast('Bursa Malaysia is held as illustrative figures only, so the screen now covers the illustrative set');
    renderKeepFocus();
  } });
  [['all', `All markets (${scope.length})`], ['US', 'United States'], ['MY', 'Bursa Malaysia'], ['watchlist', 'Only companies I follow']]
    .forEach(([v, l]) => uniSel.append(el('option', { value: v, selected: sc.universe === v ? '' : null }, l)));
  uni.append(uniSel);
  railScope.append(uni);

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
  railScope.append(cov);

  /* local (Malaysia) */
  const loc = el('div', { class: 'sunk', style: 'margin-bottom:var(--md)' });
  loc.append(el('div', { class: 'row', style: 'margin-bottom:6px' }, [el('span', { class: 'chip chip-my' }, 'MY'), el('span', { class: 'caption' }, 'Local filters')]));
  [['shariahOnly', 'Shariah-compliant only'], ['excludePn17', 'Exclude PN17 / GN3'], ['klciOnly', 'FBM KLCI constituents only']].forEach(([k, label]) => {
    const lab = el('label', { class: 'checkline' });
    lab.append(el('input', { type: 'checkbox', id: `loc-${k}`, checked: sc.local[k] ? '' : null, onchange: e => { sc.local[k] = e.target.checked; renderKeepFocus(); } }));
    lab.append(el('span', {}, label));
    loc.append(lab);
  });
  railScope.append(loc);

  /* business model */
  const bm = el('div', { style: 'margin-bottom:var(--md)' });
  /* The chips' group is named by this caption. A <label> for no control
     names nothing, so "bank, toggle button" was heard with no word that it
     filters by business model; aria-labelledby makes it the group's name. */
  bm.append(el('label', { class: 'caption', id: 'scr-bm-label', style: 'display:block;margin-bottom:4px;font-weight:600;color:var(--ink-2)' }, 'Business model'));
  const bmRow = el('div', { class: 'row row-wrap', role: 'group', 'aria-labelledby': 'scr-bm-label', style: 'gap:5px' });
  [...new Set(U.map(r => r.c.type))].forEach(t => {
    const on = sc.types.includes(t);
    /* aria-pressed: the on state was only the chip's colour. */
    bmRow.append(el('button', { class: 'chip' + (on ? ' chip-brand' : ''), style: 'cursor:pointer', 'aria-pressed': on ? 'true' : 'false',
      onclick: () => { sc.types = on ? sc.types.filter(x => x !== t) : [...sc.types, t]; render(); } }, t));
  });
  bm.append(bmRow);
  railRules.append(bm);

  /* Six filters are visible; the rest are behind Advanced. Twenty-six numeric
     thresholds presented at once is a wall, and the six below are the ones that
     answer "is this worth opening" — how well it earns, how much it owes, what
     it costs and what it pays. */
  /* On the SEC-filed companies, which carry no price, a P/E or yield
     threshold can exclude every one of them and pass none: the main filters
     there are what their statements hold — margin and cash flow in the
     place of the two price measures (9 Oct audit #8). The price measures
     stay among the advanced filters, for a price the reader enters. */
  const PRIMARY = cls === 'filed' ? ['roic', 'roe', 'om', 'ndEbit', 'fcfm'] : ['roic', 'roe', 'ndEbit', 'pe', 'dy'];
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
  railRules.append(prim);

  /* THE ADVANCED FILTERS AFTER THE RESULTS (the owner's second track, 8 Oct
     2026). Thirty-odd thresholds in six families sat in the rail, above the
     results in the page's order: on a phone, where the rail stands over the
     results, a reader passed the whole metric directory before the first
     company, and a fetch read it before the count. They are a section of
     their own after the results now, each family a collapsible group (open
     where it holds an active threshold); the rail keeps the main filters and
     a link down to the rest. */
  const advActive = FIELDS.filter(f => !PRIMARY.includes(f.k) && sc.crit[f.k]
    && (sc.crit[f.k].min != null || sc.crit[f.k].max != null)).length;
  const adv = el('section', { class: 'card scr-adv', id: 'scr-advanced', 'aria-labelledby': 'scr-advanced-h' });
  adv.append(el('div', { class: 'row', style: 'gap:8px;align-items:baseline' }, [
    el('h3', { class: 'h-card', id: 'scr-advanced-h' }, 'Advanced filters'),
    advActive ? el('span', { class: 'chip chip-brand' }, `${advActive} active`) : null,
  ]));
  adv.append(el('p', { class: 'metaline', style: 'margin-top:2px' }, 'Every other measure, by family. Open a family to set a minimum or a maximum.'));
  railRules.append(el('p', { class: 'scr-adv-link' }, el('a', { href: '#scr-advanced',
    onclick: (e) => { e.preventDefault(); const t = document.getElementById('scr-advanced'); if (t) lsGoTo(t, t.querySelector('summary')); } },
    [`Advanced filters${advActive ? ` · ${advActive} active` : ''}`, el('span', { 'aria-hidden': 'true' }, ' ↓')])));

  /* metric families */
  FIELD_GROUPS.forEach(g => {
    const groupFields = FIELDS.filter(f => f.g === g && !PRIMARY.includes(f.k));
    if (!groupFields.length) return;
    const det = el('details', { class: 'scr-adv-group' });
    const activeCount = groupFields.filter(f => sc.crit[f.k] && (sc.crit[f.k].min != null || sc.crit[f.k].max != null)).length;
    det.append(el('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600;color:var(--ink-2);padding:4px 0' },
      el('span', { class: 'row' }, [g, activeCount ? el('span', { class: 'chip chip-brand', style: 'margin-left:auto' }, String(activeCount)) : null])));
    if (activeCount) det.setAttribute('open', '');
    groupFields.forEach(f => det.append(critRow(f)));
    adv.append(det);
  });
  rail.append(railBody);

  const railFoot = el('div', { class: 'scr-rail-foot', style: 'padding:var(--sm) var(--md);border-top:1px solid var(--line);display:flex;gap:6px' });
  railFoot.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'flex:1', onclick: () => saveScreen(), html: `${icon('plus', 13)} Save screen` }));
  railFoot.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'flex:1', onclick: () => exportScreen(), html: `${icon('down', 13)} Export` }));
  rail.append(railFoot);
  wrap.append(rail);

  /* ---------- results ---------- */
  const main = el('div', { style: 'min-width:0' });
  const evald = scope.map(r => ({ r, ev: evaluateScreen(r, sc) }));
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
        `${publishedScreen.name}${publishedScreen.spec ? ` (${publishedScreen.spec}, v${publishedScreen.version})` : ''} — ${publishedScreen.untestable.length} rule${publishedScreen.untestable.length > 1 ? 's' : ''} not evaluated`),
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
  /* Read from the thresholds the screen actually holds. This read sc.rules,
     which no screen has ever carried, so the note never appeared: a
     threshold on the 12-month price change emptied the screen and it read
     "No company clears every criterion" with nothing to say why. */
  const usedPriceFields = Object.entries(sc.crit || {})
    .filter(([k, c]) => PRICE_FIELDS[k] && c && (c.min != null || c.max != null)).map(([k]) => k);
  if (usedPriceFields.length) {
    const backed = scope.filter(r => r.m.pxPoints >= 20).length;
    if (backed < scope.length) {
      resCard.append(el('div', { class: 'note', style: 'margin:0;border-radius:0;border-left:3px solid var(--bronze)' }, [
        el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' },
          `${scope.length - backed} of ${scope.length} companies have no observed price history`),
        el('p', { class: 'metaline' },
          `This screen filters on ${usedPriceFields.map(k => PRICE_FIELDS[k]).join(' and ')}, which ${usedPriceFields.length > 1 ? 'are' : 'is'} computed from imported closes rather than a stored figure. Companies without history are excluded — they are unmeasured, not unqualified. Add your own closes under Your data & settings.`),
      ]));
    }
  }

  /* A threshold on a measure that needs a price (P/E, yield, market
     capitalisation…) is never met by a company with no price: its figure is
     unavailable, not zero (evaluateScreen). Said beside the results, where
     a filed screen would otherwise read "nothing qualifies". */
  const usedPriced = Object.entries(sc.crit || {})
    .filter(([k, c]) => (FIELD_INPUTS[k] || []).includes('price') && c && (c.min != null || c.max != null)).map(([k]) => k);
  const unpriced = scope.filter(r => !isNum(r.c.px?.p)).length;
  if (usedPriced.length && unpriced) {
    resCard.append(el('div', { class: 'note', style: 'margin:0;border-radius:0;border-left:3px solid var(--bronze)' }, [
      el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' }, `${unpriced} of ${scope.length} companies have no price`),
      el('p', { class: 'metaline' },
        `${usedPriced.map(k => FIELD_BY_K[k]?.label).filter(Boolean).join(' and ')} ${usedPriced.length > 1 ? 'need' : 'needs'} a price, and no licensed feed supplies one. A company without one is excluded as unavailable — never counted as a zero.`),
    ]));
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
  /* Every chip shown, cleared the way its own ✕ clears it. This reset to
     blankScreen(), whose defaults ARE two of the chips — completeness ≥ 60%
     and PN17 / GN3 excluded — so on a fresh screen it did nothing, and after
     a threshold was added it removed only that. Columns and sort stay. */
  if (active.length) activeChips.append(el('button', { class: 'btn btn-quiet btn-sm',
    onclick: () => { active.forEach(a => a.clear()); render(); } }, 'Clear all'));

  const resHd = el('div', { style: 'padding:var(--md) var(--lg);border-bottom:1px solid var(--line)' });
  const hdRow = el('div', { class: 'row row-wrap', style: 'gap:var(--sm)' });
  /* The count, said when a change moves it. A filter set, a chip removed or
     the universe switched redraws the page with focus back on the control,
     and the new count sat in a heading above it that nothing announced: a
     screen reader changed a threshold and heard nothing of what it did.
     Said through the live region that outlives the redraw (#liveStatus,
     index.template.html) whenever it differs from the count last drawn;
     the first draw after a load has nothing to differ from. */
  const matchSaid = `${passed.length} of ${scope.length} companies match`;
  if (screenMatchSaid !== null && screenMatchSaid !== matchSaid) liveSay(matchSaid);
  screenMatchSaid = matchSaid;
  hdRow.append(el('div', {}, [
    el('h3', { class: 'h-card' }, matchSaid),
    el('p', { class: 'caption', style: 'margin-top:2px' }, `${cls === 'mixed' ? 'Both evidence classes together.' : `${SCREEN_CLASSES[cls].label} companies only.`} Same as-of date, data version and model version reproduce this exact result.`),
  ]));

  /* Reporting currency for this screen. Distinct from the base currency on
     Home, which sets what the whole product reports in — this decides only
     whether a mixed table converts or leaves each company in its own currency.
     "Local" is the option that converts nothing, which is the right default for
     anyone comparing a Bursa company against its own history rather than
     against a US one. */
  const ccyRow = el('div', { class: 'row', style: 'gap:6px;align-items:center;margin-left:auto' });
  ccyRow.append(el('span', { class: 'caption', id: 'scr-ccy-label' }, 'Show money in'));
  ccyRow.append(el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'scr-ccy-label' }, [
    ['local', 'Local'], ['MYR', 'MYR'], ['USD', 'USD'],
  ].map(([v, label]) => el('button', {
    'aria-pressed': screenCcy() === v ? 'true' : 'false',
    title: v === 'local' ? 'Each company in the currency it reports in. Nothing is converted.'
                         : `Everything converted to ${v} at the rate shown below the table.`,
    onclick: () => { State.screenCcy = v; store.write('screenCcy', v); render(); } }, label))));
  hdRow.append(ccyRow);
  hdRow.append(el('span', { class: 'spacer' }));
  /* By id: its words change with each press (see co-watch, 45-views-research.js).
     Its words say what a press does, so it is an action, not a toggle: it
     also carried aria-pressed, and a screen reader said "Hide medians,
     toggle button, pressed" — pressed meaning the medians were showing,
     read beside words saying to hide them. */
  hdRow.append(el('button', { class: 'btn btn-ghost btn-sm', id: 'scr-medians',
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
    /* The two fixed score columns that need a price — the valuation score
       and the difference to the model estimate — are set aside where no
       company in the screen holds one (the SEC-filed class): a column that
       reads "no price" on every row answers nothing. A column the reader
       chose stays, and says why each cell is empty. */
    const scopePriced = scope.some(r => isNum(r.c.px?.p));
    if (!scopePriced) {
      for (let i = cols.length - 1; i >= 0; i--) if (SCORE_COL_FIELD[cols[i].k] && needsPrice(cols[i].k)) cols.splice(i, 1);
      if (SCORE_COL_FIELD[sc.sort.k] && !cols.some(c2 => c2.k === sc.sort.k)) sc.sort = { k: 'quality', dir: -1 };
    }
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
    /* screener-table: the stylesheet's own name for it, which hides it below
       768px whether or not the cards beside it are in the page — the served
       page has the table only (styles.css, prerender). */
    const table = el('table', { class: 'dt screener-table', data: { density: State.density || 'comfortable' } });
    const thead = el('thead'); const htr = el('tr');
    cols.forEach(c2 => {
      const sortBy = () => { if (sc.sort.k === c2.k) sc.sort.dir *= -1; else { sc.sort.k = c2.k; sc.sort.dir = -1; } render(); };
      /* Enter and Space sort, as a click does. The header is a tab stop in
         the grid (gridKeyboard), which leaves Enter and Space to the cell,
         and this one bound only a click: sorting was pointer-only. The id
         is how render() hands focus back to the same header after it
         redraws the table, whose sort mark has changed. */
      const th = el('th', { class: (c2.k === 'ident' ? 'pin ' : '') + (c2.get ? 'sortable' : ''),
        id: c2.get ? `scr-sort-${c2.k}` : null,
        'aria-sort': sc.sort.k === c2.k ? (sc.sort.dir === 1 ? 'ascending' : 'descending') : null,
        onclick: c2.get ? sortBy : null,
        /* The arrow is for the eye; aria-sort says the order. Read aloud it
           was part of every header's name: "Quality, black down-pointing
           triangle", "Value, up down arrow". */
        html: `${esc(c2.label)}${c2.get ? `<span class="sort-ind" aria-hidden="true">${sc.sort.k === c2.k ? (sc.sort.dir === 1 ? '▲' : '▼') : '↕'}</span>` : ''}` });
      if (c2.get) th.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); sortBy(); } });
      htr.append(th);
    });
    thead.append(htr); table.append(thead);
    const tb = el('tbody');
    sorted.forEach(r => {
      const tr = el('tr');
      cols.forEach(c2 => {
        if (c2.k === 'ident') {
          /* And the kind of figures the row is (D6): Filed or Illustrative,
             beside the ticker, in every row. */
          const th = el('th', { class: 'pin ident', scope: 'row' });
          th.append(tickerCell(r), kindBadge(rowKind(r.c), { link: false })); tr.append(th); return;
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
      const universeRows = scope.filter(r =>
        sc.universe === 'all' ? true :
        sc.universe === 'watchlist' ? State.watchlist.includes(r.c.id) : r.c.mkt === sc.universe);
      const bands = [
        ['Median — matches', sorted, 'Median across the companies this screen selected.'],
        ['Median — universe', universeRows, 'Median across every company in the selected universe, screened or not.'],
      ];
      if (sc.sectors.length === 1) bands.push(
        [`Median — ${sc.sectors[0]}`, scope.filter(r => r.c.sector === sc.sectors[0]), 'Median across the whole sector.']);

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
    /* THE MEASURES ON EACH CARD ARE THE READER'S (9 Oct audit #8; the
       layout system: tabs become one-line chips). Four fixed measures —
       Quality, Value, Yield, Completeness — read "no price" twice on every
       filed card, and a reader who wanted to compare margins had to turn
       the phone for a table it does not show. The chips are the table's own
       columns, on one line that scrolls sideways; up to CARD_MAX are on
       every card, in the table's order. The choice is the page's for this
       visit, like the table's sort, and changes nothing that is screened. */
    const pickable = cols.filter(c2 => c2.k !== 'ident');
    const pickKeys = pickable.map(c2 => c2.k);
    let picked = (State.scrCardCols || []).filter(k => pickKeys.includes(k));
    if (!picked.length) picked = ['quality', ...sc.cols].filter(k => pickKeys.includes(k));
    picked = pickKeys.filter(k => picked.includes(k)).slice(0, CARD_MAX);
    const pickRow = el('div', { class: 'scr-pick-row', role: 'group', 'aria-labelledby': 'scr-pick-hd' });
    pickable.forEach(c2 => {
      const on = picked.includes(c2.k);
      pickRow.append(el('button', { type: 'button', class: 'chip scr-pick-chip', id: `scr-pick-${c2.k}`, 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          if (on && picked.length === 1) { toast('One measure at least — choose another before removing this one'); return; }
          if (!on && picked.length >= CARD_MAX) { toast(`${CARD_MAX} measures at most — press a chosen one to remove it`); return; }
          State.scrCardCols = on ? picked.filter(k => k !== c2.k) : [...picked, c2.k];
          /* The row keeps where it was scrolled: the redraw draws it anew. */
          const x = pickRow.scrollLeft;
          renderKeepFocus();
          const again = document.querySelector('#views .scr-pick-row');
          if (again) again.scrollLeft = x;
        } }, c2.label));
    });
    tw.append(el('div', { class: 'scr-pick' }, [
      el('p', { class: 'scr-pick-hd', id: 'scr-pick-hd' }, `Measures on each card · up to ${CARD_MAX}`),
      pickRow,
    ]));
    const pickedCols = pickable.filter(c2 => picked.includes(c2.k));
    /* A measure on a card reads as the table's cell does — its figure, or
       "Unavailable" with the reason (no price, n/a, not reported…), never a
       dash a reader could take for a zero. */
    const cardCell = (c2, r) => {
      const v = c2.get(r);
      const fld = FIELD_BY_K[c2.k] || FIELD_BY_K[SCORE_COL_FIELD[c2.k]];
      if (!isNum(v) && fld) {
        const st = metricStatus(r, fld.k);
        return el('div', { class: 'scr-card-m' }, [
          el('div', { class: 'scr-card-l' }, c2.label),
          el('div', { class: 'num scr-card-v scr-card-na', title: st.text }, 'Unavailable'),
          el('div', { class: 'scr-card-why' }, st.label),
        ]);
      }
      const shown = el('span', { html: c2.fmt(v, r) }).textContent.replace(/\s+/g, ' ').trim();
      return el('div', { class: 'scr-card-m' }, [
        el('div', { class: 'scr-card-l' }, c2.label),
        el('div', { class: 'num scr-card-v' }, shown),
      ]);
    };
    const cards = el('div', { class: 'screener-cards' });
    sorted.forEach(r => {
      const card = el('a', { class: 'card screener-card', href: href(companyPath(r.c)),
        onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); openResearch(r.c.id); } });
      /* The layout system's card (under 640px a table is a card a row; this
         list takes over from 768px down): the company, the kind of its
         figures as a D6 badge — not a link inside the card's own link — its
         market, then four measures. */
      card.append(el('div', { class: 'row screener-card-hd', style: 'gap:8px;align-items:baseline' }, [
        el('span', { style: 'font-weight:700' }, r.c.tk), kindBadge(rowKind(r.c), { link: false }),
        el('span', { class: 'metaline', style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.c.name),
        el('span', { class: r.c.mkt === 'US' ? 'chip chip-us' : 'chip chip-my' }, r.c.mkt),
      ]));
      /* The measures the chips above chose. An absent one prints
         "Unavailable" and its reason, as the table cell does — String() on
         an absent score once printed the word "null" on 55 of 77 phone
         cards. Labels take the 14/20 decision floor, not the 12/16
         metadata one: on the card they are half of a value the reader acts
         on. */
      card.append(el('div', { class: 'screener-card-metrics' }, pickedCols.map(c2 => cardCell(c2, r))));
      cards.append(card);
    });
    tw.append(cards);
    resCard.append(tw);
    resCard.append(el('div', { style: 'padding:9px var(--lg);border-top:1px solid var(--line);display:flex;gap:var(--sm);align-items:center' }, [
      el('span', { class: 'metaline' }, `${sorted.length} rows · scroll the table for the rest`),
      el('div', { class: 'segmented', role: 'group', 'aria-label': 'Row density', style: 'margin-left:var(--sm)' }, [
        el('button', { 'aria-pressed': (State.density || 'comfortable') === 'comfortable' ? 'true' : 'false',
          onclick: () => { State.density = 'comfortable'; store.write('density', 'comfortable'); render(); } }, 'Comfortable'),
        el('button', { 'aria-pressed': State.density === 'compact' ? 'true' : 'false',
          onclick: () => { State.density = 'compact'; store.write('density', 'compact'); render(); } }, 'Compact'),
      ]),
      el('span', { class: 'spacer' }),
      el('span', { class: 'metaline' }, `Sorted by ${cols.find(c2 => c2.k === sc.sort.k)?.label ?? '—'}, ${sc.sort.dir === 1 ? 'ascending' : 'descending'}`),
    ]));
  }
  main.append(resCard);
  /* The metric directory, after the results (above). */
  main.append(adv);

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
        onchange: e => {
          const was = s.alertOnMatch; s.alertOnMatch = e.target.checked;
          if (!store.write('savedScreens', State.savedScreens)) { s.alertOnMatch = was; toast(STORE_REFUSED); }
          render();
        } }));
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
  return page;
}

/* THE COVERAGE SELECTOR: which evidence class the screen covers, above the
   results, at every width. Two choices, each with how many companies it
   holds and the shape of its kind badge (D6); both together is a third,
   separate choice, and while it is on the one-line warning stands under it. */
function screenClassBar(sc, cls) {
  const n = (k) => U.filter(r => inScreenClass(r, k)).length;
  const set = (k) => {
    if (screenClassOf(sc) === k) return;
    /* A template that cannot run on the class chosen (a price threshold,
       a Bursa market) is not carried over to run there: its thresholds are
       cleared and the reader told, rather than every company excluded for
       a figure it cannot hold. */
    const t = State.appliedTemplate && SCREEN_TEMPLATES.find(x => x.id === State.appliedTemplate);
    if (t && templateOff(t, k)) {
      State.screen = blankScreen(k);
      State.appliedTemplate = null;
      toast(`${t.name} runs on the illustrative set only, so its thresholds were cleared`);
      renderKeepFocus();
      return;
    }
    setScreenClass(sc, k);
    /* A Bursa screen has no filed company to cover. */
    if (k === 'filed' && sc.universe === 'MY') sc.universe = 'all';
    renderKeepFocus();
  };
  const bar = el('div', { class: 'scr-class' });
  const choice = (k) => el('button', { type: 'button', id: `scr-class-${k}`, 'aria-pressed': cls === k ? 'true' : 'false', onclick: () => set(k) }, [
    el('span', { class: `kind-badge kind-${k} scr-class-shape`, 'aria-hidden': 'true' }, el('span', { class: 'kind-shape' })),
    SCREEN_CLASSES[k].label, ' ', el('span', { class: 'scr-class-n' }, String(n(k))),
  ]);
  bar.append(el('div', { class: 'scr-class-row' }, [
    el('span', { class: 'scr-class-label', id: 'scr-class-label' }, 'Coverage'),
    el('div', { class: 'segmented scr-class-seg', role: 'group', 'aria-labelledby': 'scr-class-label' }, [choice('filed'), choice('illustrative')]),
    el('button', { type: 'button', class: 'btn btn-quiet btn-sm scr-class-mix', id: 'scr-class-mixed', 'aria-pressed': cls === 'mixed' ? 'true' : 'false',
      onclick: () => (cls === 'mixed' ? set('filed') : set('mixed')) }, 'Show both classes together'),
  ]));
  bar.append(cls === 'mixed'
    ? el('p', { class: 'scr-class-warn', role: 'note' }, [el('span', { class: 'scr-class-warn-mark', 'aria-hidden': 'true' }, '!'), SCREEN_MIX_WARNING])
    : el('p', { class: 'metaline scr-class-note' }, SCREEN_CLASSES[cls].note));
  return bar;
}

function scorePill(v, pct) {
  if (!isNum(v)) return NA;
  const t = v / 100;
  /* The ramp's step, not its colour: the stylesheet resolves it for the
     theme on screen (2026-10-04). Resolved here, to the light or the dark
     theme's hex as the page was drawn, the screener's markup was the
     theme's — a page served in the light theme was not the page a reader in
     the dark one would be drawn (SERVED_READS, 35-ui.js) — and a switch of
     theme left every bar in the other theme's colour until a redraw. */
  const bg = `var(${sequentialVar(t)})`;
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
const FIELD_PROVENANCE = Object.fromEntries(METRICS.filter(x => x.kind !== 'calculated').map(x => [x.k, x.kind]));
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
const FIELD_INPUTS = Object.fromEntries(METRICS.map(x => [x.k, x.inputs || []]));
/* How many of the latest stored years each measure reads, where it is more
   than the latest one — the window derive() slices for it. The four-year
   growth, variability and drawdown measures read the last five points; the
   share-count rate is cagr() over the whole series; return on equity averages
   this year's equity with last year's. */
const FIELD_SPAN = Object.fromEntries(METRICS.filter(x => x.span).map(x => [x.k, x.span]));
const FIELD_SPAN_LINE = Object.fromEntries(METRICS.filter(x => x.spanLine).map(x => [x.k, x.spanLine]));
/* Measures a type cannot carry that the coverage dictionary does not list —
   so they are not in INAPPLICABLE, whose length the coverage figure prints. */
const ALSO_INAPPLICABLE = metricApplicability(false);
const TYPE_NOUN = { bank: 'bank', insurer: 'insurer', early: 'pre-profit company', reit: 'REIT' };
/* A business model as a noun with its article. Sentences put a fixed "a"
   before the noun or the raw type key — "Not meaningful for a insurer", "the
   measures that apply to a early business". */
const typePhrase = (t) => { const n = TYPE_NOUN[t] || `${t} business`; return `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`; };
/* Why a measure whose inputs are all present still has no number. Each is the
   guard in derive() for that measure, in words. */
const NM_WHY = Object.fromEntries(METRICS.filter(x => x.nmWhy).map(x => [x.k, x.nmWhy]));

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
    : `Not meaningful for ${typePhrase(c.type)}. Excluded from the count of applicable measures rather than imputed.`);
  /* A measure the stored statements cannot support — interest cover, whose
     line the tuple does not carry — is not reported for any company, and the
     registry names the line it waits for. */
  if (METRIC_BY_K[k]?.blocked) return why('not reported', f?.miss || METRIC_BY_K[k].blocked);
  /* The withheld flags, each with every measure derive() nulls on it: the
     margins over a revenue line EBIT exceeds, and everything divided by or
     compounded from a net income on the wrong scale. */
  const W = [
    [['om', 'nm', 'fcfm', 'ocfm'], m.revenueSuspect],
    [['roe'], m.roeWithheld],
    [['payout', 'nm', 'roe', 'pe', 'cashconv', 'ni5', 'niYoY'], m.perShareScaleBroken],
    /* Each rate by the break it was withheld on. derive() withholds the
       four-year per-share rates on a break among the five rows they read
       (perShareBreak), and the share-count rate and buyback yield on the
       first break in the whole series (shareSeriesBreak). Keyed on the
       whole-series break, GE's earnings growth — absent because its FY2021
       earnings were negative — and Alphabet's dividend growth — no dividend
       in FY2021 — both read "withheld: the share count moves inside the
       window", about a break years before it; book-value growth, withheld
       on the same evidence, was not listed at all. And "a corporate action,
       not issuance" named a cause nothing here can know: Realty Income's
       1.64× is a merger paid in shares, which is issuance. */
    [['eps5', 'bv5', 'dps5'], m.perShareBreak
      ? `The share count moves from ${fmtNum(m.perShareBreak.from, 2)}bn to ${fmtNum(m.perShareBreak.to, 2)}bn between two of the five years this rate reads — a split, a merger or an offering, which the filings are not restated for and no source here identifies. A rate over a per-share line across that step would measure the event, not the company, so it is withheld.`
      : null],
    [['dilution', 'buyback'], m.shareSeriesBreak
      ? `The share count moves from ${fmtNum(m.shareSeriesBreak.from, 2)}bn to ${fmtNum(m.shareSeriesBreak.to, 2)}bn between two consecutive years in the stored series — a split, a merger or an offering, which the filings are not restated for and no source here identifies. A growth rate over the series would measure that one event rather than the company's issuance and buybacks, so it is withheld.`
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
    dataChip(c),
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
  /* The statement lines this measure reads, for the rows that describe what
     happened to them on the way in. Each clause is said only where one of
     them needs it: a margin is not told its debt was summed. */
  const stmtLines = (FIELD_INPUTS[f.k] || []).filter(l => LINE_COL[l] != null);
  const transform = (() => {
    if (!stmtLines.length) return 'None to statement lines — this measure reads none.';
    if (!c.real || c.personal) return lineTransformation(c, stmtLines[0], fy);
    const out = [];
    const has = (l) => stmtLines.includes(l);
    const tag = (pk) => c.provenance?.[pk]?.byYear?.[fy] || c.provenance?.[pk]?.byYear?.[String(fy)];
    if (stmtLines.some(l => l !== 'sh' && l !== 'dps')) out.push('Filed in whole US dollars; stored ÷ 1,000,000,000 as USD billions.');
    if (has('sh')) out.push('The share count is filed as a count and stored in billions.');
    if (has('dps')) out.push('Dividend per share is stored as filed, not scaled.');
    if (has('debt')) out.push('Total debt is the non-current line plus the current portion, summed into one figure.');
    if (has('sh') && !tag('sh') && tag('shWtd')) out.push('No year-end share count was filed for this year, so the weighted-average diluted count stands in.');
    out.push('Where a period was filed more than once, the latest filing is used, so a restatement replaces the first-reported figure.');
    out.push(`The measure itself is computed on this page: ${f.formula}.`);
    return out.join(' ');
  })();
  const rows = [
    [st.available ? 'What it is' : 'Why it is absent', st.text],
    ['Formula', f.formula],
    ['Reporting period', stmtLines.length ? periodEndText(c, stmtLines[0], fy) : `FY${fy}${fyEndOf(c, fy) ? ` (ended ${fmtFyEnd(fyEndOf(c, fy))})` : ''}, as reported`],
    ['Prior period', priceBased ? 'not shown — this measure needs the price on the day, and no price history for the prior year is held' : isNum(prev) ? `FY${yearsOf(c)[yearsOf(c).length - 2]} · ${f.fmt(prev, r)}` : 'not computable'],
    ['Currency', c.ccy],
    ['Source', sourceSentence(c)],
    /* Filing date and form, read from the record whether or not it holds them
       yet — the row says which, rather than leaving the reader to wonder
       whether the page forgot. */
    ['Filing', stmtLines.length ? filingText(c, stmtLines[0], fy) : 'none — this measure reads no statement line'],
    ['Transformation', transform],
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
    t.append(el('thead', {}, el('tr', {}, ['Line', 'Latest value', 'Period', 'Original unit', 'Source'].map(h => el('th', {}, h)))));
    const tb = el('tbody');
    inputs.forEach(l => {
      let val, period, src, present = true, unit0 = '—';
      if (l === 'price') {
        present = isNum(c.px?.p);
        val = present ? `${fmtNum(c.px.p, 2)} ${c.ccy}` : 'none';
        period = present ? priceAsOfLabel(c) : '—';
        /* By origin, as priceAsOfLabel dates it. Every price that was not an
           end-of-day close read "entered by you" — the hand-written sample
           price of each illustrative company included, which no reader
           entered. */
        src = c.px?.eod ? (c.pricePersonal ? 'read from your screen' : 'end-of-day close')
          : !present ? 'no licensed feed'
          : c.px.manual || c.real ? 'entered by you'
          : 'illustrative sample price — a synthetic figure, not a quote';
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
        unit0 = lineOriginalUnit(c, l);
        if (c.real && c.provenance && typeof c.provenance === 'object') {
          const tagOf = (pk) => c.provenance[pk]?.byYear?.[fy] || c.provenance[pk]?.byYear?.[String(fy)] || null;
          src = lineConcept(c, l, fy) || `no tag recorded for FY${fy}`;
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
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal;max-width:160px' }, unit0),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal;max-width:260px' }, src),
      ]));
    });
    t.append(tb); tw.append(t); body.append(tw);
  }

  /* Where to check it: the filer's EDGAR record, from the same builder the
     Filings tab uses. */
  const links = stmtLines.length ? edgarLinkRow(c, { fy, lines: stmtLines }) : null;
  if (links) {
    body.append(el('h4', { class: 'h-card', style: 'margin:var(--md) 0 6px' }, 'Check it against the source'));
    body.append(links);
  }

  if (METRIC_HELP[f.k]) {
    body.append(el('button', { class: 'btn btn-ghost btn-sm',
      onclick: () => explainMetric(f.k) }, 'What does this measure mean?'));
  }
  openDrawer(f.label, body);
}

/* ==========================================================================
   LINEAGE — one statement line, one year

   The drawer above explains a measure. A reader looking at the statements
   themselves asks a narrower question — where did this one figure come from —
   and until now the raw reported lines were the only numbers on the company
   page with no answer: the "reported" kind was defined and attached to
   nothing a reader could click. These helpers answer it for a single line in a
   single year, and the measure drawer reuses them for its inputs, so the two
   cannot describe the same filing two ways.
   ========================================================================== */

/* The provenance keys behind a tuple column (debt and shares are assembled
   from more than one), and the concept that supplied a given year. */
const lineProvKeys = (l) => (LINE_PROV[l] || { keys: [l] }).keys;
function lineConcept(c, l, fy) {
  if (!c?.real || !c.provenance || typeof c.provenance !== 'object') return null;
  const spec = LINE_PROV[l] || { keys: [l], mode: 'first' };
  const tagOf = (pk) => c.provenance[pk]?.byYear?.[fy] || c.provenance[pk]?.byYear?.[String(fy)] || null;
  const tags = spec.mode === 'sum' ? spec.keys.map(tagOf).filter(Boolean) : [spec.keys.map(tagOf).find(Boolean)].filter(Boolean);
  return tags.length ? tags.join(' + ') : null;
}

/* The unit the filer used, before the ingest scaled it. us.json records it
   per line ('USD', 'shares', 'USD/shares'); the page stores billions and
   per-share amounts, and a reader checking a figure against the filing needs
   to know which of the two they are holding. */
const ORIGINAL_UNIT_WORDS = { USD: 'USD, whole dollars as filed', shares: 'shares, a whole count as filed',
  'USD/shares': 'USD per share, as filed', pure: 'a pure number, as filed' };
function lineOriginalUnit(c, l) {
  if (!c?.real) return 'none — a synthetic sample line, authored in billions';
  if (c.personal || typeof c.provenance !== 'object' || !c.provenance) return 'as written in the statements you supplied';
  const units = [...new Set(lineProvKeys(l).map(k => c.provenance[k]?.unit).filter(Boolean))];
  return units.length ? units.map(u => ORIGINAL_UNIT_WORDS[u] || u).join('; ') : 'not recorded for this line';
}

/* Filing date, form, period end and accession for one line and year. The
   ingest has recorded the first three since 26 September; the statements
   shipped here were retrieved on 3 August and carry none of them, and no
   accession number is read at all yet. Read defensively, so the day the data
   carries them they appear with no change here. */
function lineFiling(c, l, fy) {
  const out = { filed: null, form: null, end: null, accn: null };
  if (!c?.real || c.personal || !c.provenance || typeof c.provenance !== 'object') return out;
  const at = (o) => (o && (o[fy] ?? o[String(fy)])) || null;
  for (const k of lineProvKeys(l)) {
    const p = c.provenance[k] || {};
    out.filed = out.filed || at(p.filedByYear);
    out.form = out.form || at(p.formByYear);
    out.end = out.end || at(p.endByYear);
    out.accn = out.accn || at(p.accnByYear);
  }
  out.end = out.end || fyEndOf(c, fy);
  return out;
}
const NOT_YET_HELD = 'not in this dataset yet — the shipped statements predate the ingest that records it, and it fills in here when they are regenerated';
function filingText(c, l, fy) {
  if (!c?.real) return 'None — a synthetic sample statement is not a filing.';
  if (c.personal) return 'None held — annual statements you supplied, with no filing index behind them.';
  const f = lineFiling(c, l, fy);
  if (!f.filed && !f.form) return `Filing date and form are ${NOT_YET_HELD}.`;
  return `${f.form || 'form not recorded'}${f.filed ? `, filed ${f.filed}` : ''}`;
}
function periodEndText(c, l, fy) {
  const end = lineFiling(c, l, fy).end || fyEndOf(c, fy);
  if (end) return `FY${fy}, ended ${fmtFyEnd(end)}`;
  if (!c?.real) return `FY${fy} of the sample set`;
  return c.personal ? `FY${fy}, as labelled in your statements` : `FY${fy}. The period end date is ${NOT_YET_HELD}.`;
}

/* What the ingest did to a filed figure before it reached this page, for one
   line and year. Each clause is emitted only where it applies to that line, so
   a revenue figure does not claim a debt sum and a dividend is not said to
   have been scaled. */
function lineTransformation(c, l, fy) {
  if (!c?.real) return 'Synthetic sample line, authored in billions. Nothing was filed, so nothing was transformed.';
  if (c.personal) return l === 'dps' ? 'As supplied, per share. Nothing else is adjusted.' : 'As supplied, scaled to billions. Nothing else is adjusted.';
  const parts = [];
  if (l === 'dps') parts.push('Filed per share and stored as filed — not scaled.');
  else if (l === 'sh') parts.push('Filed as a count of shares; stored ÷ 1,000,000,000 as billions of shares.');
  else parts.push('Filed in whole US dollars; stored ÷ 1,000,000,000 as USD billions.');
  const basis = c.basis?.[l]?.[fy] || c.basis?.[l]?.[String(fy)] || null;
  if (l === 'debt') parts.push(basis ? `This year’s route: ${basis}.` : 'Total debt is the non-current line plus the current portion, summed into one figure; the concepts for this year are named above.');
  if (l === 'sh') {
    const tag = (pk) => c.provenance?.[pk]?.byYear?.[fy] || c.provenance?.[pk]?.byYear?.[String(fy)];
    parts.push(basis ? `This year’s route: ${basis}.`
      : tag('sh') ? 'The year-end count of shares outstanding.'
      : tag('shWtd') ? 'No year-end count was filed for this year, so the weighted-average diluted count stands in.'
      : 'No share count resolved for this year.');
  }
  if (l === 'capex') parts.push('Filed as a positive payment; the statement table shows it negative, as the outflow it is.');
  parts.push('Where a period was filed more than once, the latest filing is used, so a restatement replaces the first-reported figure.');
  if (lineProvKeys(l).some(k => c.provenance?.[k]?.mixedTags))
    parts.push('This line is assembled from more than one XBRL concept across the years, so part of a year-to-year change can be a change of definition.');
  return parts.join(' ');
}

/* The EDGAR addresses a filer's figures can be checked against, built from
   the CIK alone. One builder, used by the Filings tab and every drawer, so a
   link cannot be spelled two ways. The link to the exact filing needs an
   accession number the ingest does not read yet; it is added for any line and
   year whose record carries one, and is otherwise absent rather than pointed
   at a guess. */
function edgarLinks(c, { fy = null, lines = [] } = {}) {
  if (!c?.real || c.personal || !c.cik) return [];
  const cik10 = padCik(c.cik), bare = String(Number(cik10));
  const out = [];
  if (fy != null) {
    const seen = new Set();
    lines.forEach(l => {
      const f = lineFiling(c, l, fy);
      if (!f.accn || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) || seen.has(f.accn)) return;
      seen.add(f.accn);
      out.push({ exact: true, href: `https://www.sec.gov/Archives/edgar/data/${bare}/${f.accn.replace(/-/g, '')}/${f.accn}-index.htm`,
        label: `The ${f.form || 'filing'} that supplied FY${fy}` });
    });
  }
  out.push(
    { href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&type=10-K&dateb=&owner=include&count=40`, label: 'Annual reports on EDGAR' },
    { href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}&owner=include&count=40`, label: 'Every filing on EDGAR' },
    { href: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`, label: 'The companyfacts record this page was built from' },
  );
  return out;
}
function edgarLinkRow(c, opts) {
  const links = edgarLinks(c, opts);
  if (!links.length) return null;
  const row = el('div', { class: 'row row-wrap', style: 'gap:8px' }, links.map(x =>
    el('a', { class: 'btn btn-ghost btn-sm', href: x.href, target: '_blank', rel: 'noopener noreferrer', html: `${esc(x.label)} ${icon('ext', 10)}` })));
  /* Said beside the links, where the missing one would have been. */
  if (opts?.fy != null && !links.some(x => x.exact)) return el('div', {}, [row,
    el('p', { class: 'metaline', style: 'margin-top:6px' },
      `No link to the exact filing: that needs its accession number, which the ingest does not record yet. The FY${opts.fy} annual report is in the list above — the one whose period matches.`)]);
  return row;
}

/* The source line of every drawer, in one sentence per kind of company. */
const sourceSentence = (c) => c.real
  ? (c.personal ? `Annual statements you supplied — personal research, not redistributable, retrieved ${c.retrieved}` : `SEC EDGAR companyfacts, CIK ${c.cik}, retrieved ${c.retrieved}`)
  : 'Synthetic sample statement — not a filing';

/* THE STATUS OF ONE STATEMENT CELL. Present: reported, calculated (a derived
   line) or illustrative. Absent: which of the five reasons, for this line in
   this year — the cell prints the short form and carries the sentence, as the
   screener's cells do. A blanket "n/a" said nothing could be said, and for a
   filed line something always can: which tag failed, or which rule withheld. */
function lineCellStatus(r, line, i) {
  const { c } = r;
  const fy = yearsOf(c)[i];
  const v = line.arr[i];
  if (isNum(v)) {
    const id = !c.real ? 'illustrative' : line.derived ? 'calculated' : 'reported';
    return { id, available: true, label: PROVENANCE[id].label, text: PROVENANCE[id].note };
  }
  const why = (reason, text) => ({ id: 'unavailable', available: false, reason, label: ABSENCE[reason].short, text });
  const keys = line.derived ? line.inputs : [line.key];
  const held = keys.filter(k => c.withheld?.[k]?.years?.includes(fy));
  if (held.length) return why('withheld', held.map(k => `${LINE_LABEL[k]} for FY${fy} is withheld: ${c.withheld[k].why}.`).join(' ') + ' The ingest rule has been corrected; the figure returns when the statements are regenerated.');
  if (line.derived) {
    const missing = line.inputs.filter(k => !isNum(c.fin?.[i]?.[LINE_COL[k]]));
    if (missing.length) return why('not reported', `${missing.map(k => LINE_LABEL[k]).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in the stored statements for FY${fy}, and a derived line needs every input from the same year. Nothing is imputed.`);
    return why('not meaningful', `Every input is present for FY${fy}, but the arithmetic has no meaning on them — a share count of zero.`);
  }
  if (!c.real) return why('not reported', `Not in the sample statement for FY${fy}. Nothing is imputed.`);
  if (c.personal) return why('not reported', `Not in the statements you supplied for FY${fy}. Nothing is imputed.`);
  const pk = lineProvKeys(line.key);
  const gap = (c.gaps || []).find(g => pk.includes(g.line) && Array.isArray(g.missingYears) && g.missingYears.map(Number).includes(Number(fy)))
    || (c.gaps || []).find(g => pk.includes(g.line) && g.reason && !g.withheld);
  const tagWords = gap?.missingYears ? `${gap.concept} and its fallbacks returned no annual value for this year`
    : gap?.reason ? gap.reason : 'no XBRL concept in the fallback chain resolved for this year';
  return why('not reported', `Not in the FY${fy} statements held for this filer — ${tagWords}. Nothing is imputed.`
    + (line.key === 'dps' ? ' A company that declared no dividend files no dividend tag, so this can also mean none was declared.' : ''));
}

/* A figure as the statements show it, with its unit. */
const lineUnit = (line, c) => line.unit === 'shares' ? 'bn shares' : line.unit === 'perShare' ? `${c.ccy} per share` : `${c.ccy} bn`;
/* Per-share lines keep two places throughout, so a row reads as one series;
   totals take fewer as they grow. */
const lineFmt = (v, line) => fmtNum(v, line?.unit === 'perShare' ? 2 : Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 3 : 2) : 1);

/* The drawer behind one statement cell: the line, the year, the value, its
   unit then and now, the XBRL concept that supplied that year, the filing
   where the data carries it, what the ingest did to it, and the EDGAR record
   to check it against. A derived line lists its inputs for the same year. */
function openLineDrawer(r, line, i) {
  const { c } = r;
  const yrs = yearsOf(c), fy = yrs[i];
  const v = line.arr[i], prev = i > 0 ? line.arr[i - 1] : null;
  const st = lineCellStatus(r, line, i);
  const body = el('div', { class: 'stack' });
  body.append(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
    statusChip(st), el('span', { class: 'chip' }, `${c.tk} · ${c.name}`), dataChip(c),
  ]));
  const d = isNum(v) && isNum(prev) ? v - prev : null;
  const change = isNum(d)
    ? `FY${yrs[i - 1]}: ${lineFmt(prev, line)} · change ${withSign(d, Math.abs(d) < 10 ? 2 : 1, '')}${prev > 0 ? ` (${withSign(d / prev * 100, 1)})` : ''}`
    : null;
  body.append(el('div', { class: 'panel' }, statTile(`${line.label}, FY${fy}`,
    isNum(v) ? `${lineFmt(v, line)} ${lineUnit(line, c)}` : `unavailable — ${st.reason}`, { sub: change })));

  const kv = el('dl', { class: 'kv' });
  const concept = line.derived ? null : lineConcept(c, line.key, fy);
  const rows = [
    [st.available ? 'What it is' : 'Why it is absent', st.available && line.derived
      ? `A derived line: ${line.formula}. Computed on this page from the stored lines for FY${fy}; it is not stored separately.`
      : st.available && st.id === 'reported'
        ? `A reported line: the figure the filer tagged for FY${fy}, stored as the Transformation row below describes. No estimate or adjustment beyond that.`
        : st.text],
    ['Line', `${line.label} — ${line.groupLabel.toLowerCase()}`],
    ['Reporting period', periodEndText(c, line.derived ? line.inputs[0] : line.key, fy)],
    ['Value', isNum(v) ? `${v} ${lineUnit(line, c)}${line.sign === -1 ? ' (shown negative, as an outflow)' : ''}` : 'none held'],
    ...(line.derived ? [] : [
      ['Original unit', lineOriginalUnit(c, line.key)],
      ['XBRL concept', !c.real ? 'none — a synthetic sample line' : c.personal ? 'none — statements you supplied carry no XBRL'
        : concept || `no concept recorded for FY${fy}`],
      ['Filing', filingText(c, line.key, fy)],
    ]),
    ['Source', sourceSentence(c)],
    ['Transformation', line.derived ? `None beyond the arithmetic: ${line.formula}, from the same year’s lines, or nothing if either is absent.` : lineTransformation(c, line.key, fy)],
    ['Currency', c.ccy],
  ];
  rows.forEach(([k2, v2]) => { kv.append(el('dt', {}, k2)); kv.append(el('dd', { style: 'text-align:left' }, v2)); });
  body.append(kv);

  if (line.derived) {
    body.append(el('h4', { class: 'h-card', style: 'margin:var(--md) 0 6px' }, 'Inputs'));
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Line', `FY${fy}`, 'Original unit', 'Source'].map(h => el('th', {}, h)))));
    t.append(el('tbody', {}, line.inputs.map(l => {
      const x = c.fin?.[i]?.[LINE_COL[l]];
      return el('tr', {}, [
        el('td', { class: 'ident' }, LINE_LABEL[l]),
        el('td', { class: isNum(x) ? '' : 'caption' }, isNum(x) ? `${lineFmt(x)} ${l === 'sh' ? 'bn shares' : l === 'dps' ? 'per share' : c.ccy + ' bn'}` : 'not reported'),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, lineOriginalUnit(c, l)),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal;max-width:240px' },
          !c.real ? 'synthetic sample' : c.personal ? 'statements you supplied' : lineConcept(c, l, fy) || `no tag recorded for FY${fy}`),
      ]);
    })));
    tw.append(t); body.append(tw);
  }

  const links = edgarLinkRow(c, { fy, lines: line.derived ? line.inputs : [line.key] });
  if (links) {
    body.append(el('h4', { class: 'h-card', style: 'margin:var(--md) 0 6px' }, 'Check it against the source'));
    body.append(links);
  }
  openDrawer(`${line.label} · FY${fy}`, body);
}

function openMetricInfo(f) {
  const body = el('div');
  body.append(el('p', { class: 'eyebrow' }, f.g));
  body.append(el('h3', { class: 'h-section', style: 'margin:4px 0 var(--sm)' }, f.label));
  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  /* The period, source and normalisation of THIS measure, from what it reads
     (its inputs) and its window (f.period, the registry's words). Every
     measure used to get the statement-line boilerplate: "12-month price
     change" was said to read the latest fiscal year's statement lines, with
     no normalisation — all three false for a trailing series of closes —
     and price-to-earnings never mentioned the price. */
  const ins = FIELD_INPUTS[f.k] || [];
  const usesHistory = ins.includes('history'), usesPrice = ins.includes('price');
  const usesLines = ins.some(l => l !== 'history' && l !== 'price');
  const LINES_SRC = 'reported statement lines — SEC EDGAR companyfacts for the filed companies, synthetic sample lines for the illustrative ones';
  const PRICE_SRC = 'the price each company holds — an end-of-day close from a price file, a price you entered, or an illustrative company’s sample price; a filed company with none has no figure';
  const source = usesHistory
    ? 'Observed daily closes you imported or captured — held in this browser or your own price file, never shipped with the site. The illustrative sample prices do not reach this measure; a company with no closes held has no figure.'
    : `${usesLines && usesPrice ? `From ${LINES_SRC}, and ${PRICE_SRC}` : usesPrice ? `From ${PRICE_SRC}` : `From ${LINES_SRC}`}. Each company page says which it is.`;
  const kindOf = METRIC_BY_K[f.k]?.kind;
  const normal = kindOf === 'modelled'
    ? 'The output of the published scoring or valuation model: its inputs pass through the stated anchors and assumptions, set out on each company’s Quality and Valuation tabs.'
    : usesHistory ? 'None — computed directly from the closes as held'
    : usesPrice ? 'None — the stored lines and the price are used as held'
    : 'None — the figure is computed directly from the stored lines';
  [['Formula', f.formula],
   ['Reporting period', `${f.period || 'The latest fiscal year each company reports'}${usesHistory ? '' : ' — the year is stated on every company page and in the source drawer behind each cell'}`],
   ['Source', source],
   ['Normalisation', normal], ['Missing-data behaviour', f.miss || 'Reported as unavailable; never imputed and never passes a threshold.']]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, v)); });
  body.append(kv);

  const vals = U.map(r => ({ r, v: r.m[f.k] })).filter(x => isNum(x.v)).sort((a, b) => b.v - a.v);
  body.append(el('h4', { class: 'h-card', style: 'margin-bottom:6px' }, `Distribution across the universe (${vals.length} of ${U.length} computable)`));
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Company'), el('th', {}, 'Value'), el('th', {}, 'Market pct')])));
  t.append(el('tbody', {}, vals.slice(0, 12).map(x => el('tr', {}, [
    el('td', { class: 'ident' }, x.r.c.tk + dataText(x.r.c)), el('td', {}, f.fmt(x.v, x.r)), el('td', {}, String(metricPct(x.r, f.k, 'market') ?? '—')),
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
      el('span', { style: 'font-weight:600;font-size:13px' }, r.c.tk), dataChip(r.c), marketChip(r.c.mkt),
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
    /* The data versions too: a screen run over the filed set is answered by
       us.json, and a regeneration changes the answer without the model
       moving at all. */
    stamp: buildStamp('universe'),
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
    versions: stampDiff(saved.snapshot?.stamp, { model: saved.snapshot?.model ?? saved.model }),
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
  /* Said saved only when the browser kept it. With the quota full this
     toasted 'Saved "…" — 56 matches frozen' and listed the screen until the
     next reload, which had never stored it. */
  const was = State.savedScreens;
  State.savedScreens = [...was, {
    name, def, snapshot, alertOnMatch: true, asOf: snapshot.asOf, model: snapshot.model }];
  if (!store.write('savedScreens', State.savedScreens)) { State.savedScreens = was; toast(STORE_REFUSED); render(); return; }
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

  /* Model and data reported apart, from the snapshot's stamp. */
  if (diff.modelChanged || diff.versions.dataMoved) body.append(el('div', { class: 'guardrail', style: 'margin-bottom:var(--md)',
    html: `${icon('alert')}<span>${esc(diff.versions.text)} Scores below are shown both as saved and as they stand now.</span>` }));
  else if (!diff.versions.stamped) body.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' }, diff.versions.text));

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
    /* Each company says which kind its scores are (E2): the drawer listed
       the Bursa set's synthetic scores beside the filers' unmarked. */
    return el('tr', {}, [
      el('td', { class: 'ident' }, [m.tk, ' ', dataChip(live?.c)]),
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
    /* As saveScreen: refreshed only if the browser keeps it. */
    const was = s.snapshot; s.snapshot = screenSnapshot(s.def);
    if (!store.write('savedScreens', State.savedScreens)) { s.snapshot = was; toast(STORE_REFUSED); return; }
    closeDrawer(); render(); toast('Snapshot refreshed to today');
  } }, 'Mark reviewed — refresh snapshot'));
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const was = State.savedScreens;
    State.savedScreens = was.filter((_, i) => i !== idx);
    if (!store.write('savedScreens', State.savedScreens)) { State.savedScreens = was; toast(STORE_UNDELETED); return; }
    closeDrawer(); render(); toast('Screen deleted');
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
  lines.push(`# Screen: ${sc.mode === 'pct' ? 'peer-percentile thresholds' : 'absolute thresholds'}; universe ${sc.universe}; coverage ${screenClassOf(sc) === 'mixed' ? 'both evidence classes together' : `${SCREEN_CLASSES[screenClassOf(sc)].label} companies only`}`);
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

/* TWO SENTENCES THE VALUE MAP AND THE HEATMAP SHARE.
   chartEmptyWhy: what stands where there is nothing to draw — the empty
   watchlist named, or how many companies are in scope and that none can be
   drawn, the reason following in the lines the chart already prints.
   illusNote: which of the companies drawn are illustrative. Every mark and
   tile at the latest stop is one, on a sample price, and nothing on either
   chart said so beyond "prices as of sample price" in a caption. `held` is
   where a listed company may be missing from (a past snapshot). */
function chartEmptyWhy(universe, scoped, done, held = 'this dataset') {
  const wl = universe === 'watchlist' ? activeWL() : null;
  const n = scoped.length, ids = wl?.ids || [];
  const where = wl ? `on your active watchlist “${wl.name}”` : 'in this universe';
  if (wl && !ids.length) return `Your active watchlist “${wl.name}” is empty, so there is nothing to draw. Add companies to it from a company page or the screener, or choose another universe.`;
  if (wl && !n) return ids.length === 1 ? `The one company ${where} is not in ${held}.` : `None of the ${ids.length} companies ${where} is in ${held}.`;
  if (!n) return `No company in this universe is in ${held}.`;
  return n === 1 ? `The one company ${where} cannot be ${done} — the reason is given below.`
    : `None of the ${n} companies ${where} can be ${done} — the reason is given below.`;
}
function illusNote(rows, done) {
  const k = rows.filter(r => !r.c.real).length;
  if (!k) return null;
  return el('p', { class: 'metaline', style: 'margin-top:6px;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap' }, [
    illusChip({ real: false }),
    el('span', {}, k === rows.length
      ? `Every company ${done} here is illustrative — synthetic figures on sample prices, not evidence about any company.`
      : `${k} of the ${rows.length} companies ${done} here are illustrative — synthetic figures on sample prices; each is marked in its name and in the table view.`)]);
}

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
      el('button', { 'aria-pressed': rr[key] === v ? 'true' : 'false', onclick: () => { rr[key] = v; render(); } }, l))));
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
  const unpriced = scoped.filter(r => !r.val.mos && !isNum(r.price)).length;
  const noModel = scoped.length - rows.length - unpriced;
  const modelled = rows.length;
  if (rr.minConf === 'med') rows = rows.filter(r => r.val.confBand !== 'Low');
  if (rr.minConf === 'high') rows = rows.filter(r => r.val.confBand === 'High');
  /* The confidence filter leaves companies off too. The count was taken
     before it ran, so at "High only" the map drew 7 of 138 and said 115 were
     not plotted, all for want of a price — 16 were missing from both. */
  const belowConf = modelled - rows.length;
  const unplotted = scoped.length - rows.length;

  const RISK_VAR = { Low:'--seq-6', Medium:'--seq-4', High:'--seq-2' };
  /* A company with no percentile in the chosen cohort has no height on this
     chart. Two things leave a company without one, and the page named only
     the first, for the sector cohort only, and wrongly: no other company in
     its sector at all (IHH — the note said "fewer than two peers", but one
     peer is enough for a rank), or no quality score — a filed REIT, whose
     quality inputs are not among the lines the statements carry, once the
     reader gives it a price. Such a REIT was drawn at 50 in either cohort,
     and the market cohort said nothing about it.
     The point carries the percentile or null, never a stand-in. yOf() handed
     the chart 50, and the mark's name and tooltip printed it as "quality
     percentile 50", a measured median rank; IHH read 50 in the sector cohort
     beside a table that said it had none. scatterChart draws a point whose
     y is null at the midpoint and says it has no percentile. */
  const pctOf = (r) => { const p = rr.cohort === 'sector' ? r.qpctSector : r.qpctMarket; return isNum(p) ? p : null; };
  const noPctWhy = (r) => !isNum(r.q?.score) ? 'no quality score' : rr.cohort === 'sector' ? 'no sector peer' : 'no rank';
  /* The table prints the percentile that exists, or says there is none and why. */
  const pctText = (r) => { const p = pctOf(r); return isNum(p) ? String(p) : `— (${noPctWhy(r)})`; };
  /* tag: an illustrative company says so in its mark's name and tooltip —
     every mark drawn at the latest stop is one, on a sample price, and
     neither the marks nor their names said it. */
  const points = rows.map(r => ({
    id: r.c.id, label: r.c.tk, name: r.c.name + dataText(r.c), tag: dataTag(r.c),
    x: r.val.mos.base, y: pctOf(r), size: toBase(r.d.m.mcap, r.c.ccy),
    capLabel: fmtCap(toBase(r.d.m.mcap, r.c.ccy), State.baseCcy),
    model: r.val.pack.name, conf: r.val.confBand,
    varName: rr.colorBy === 'market' ? (r.c.mkt === 'US' ? '--s1' : '--s2')
                                     : RISK_VAR[BY_ID.get(r.c.id).risk.band],
  }));

  const card = el('div', { class: 'card' });
  const plot = el('div', { style: 'width:100%' });
  /* Nothing to plot is said, not drawn: an empty watchlist gave full axes, a
     grid and a two-market legend with no marks and no sentence. */
  const nothing = !rows.length;
  card.append(nothing ? emptyState(chartEmptyWhy(rr.universe, scoped, 'plotted',
    rr.yi === YEARS.length - 1 ? 'this dataset' : `the FY${YEARS[rr.yi]} snapshot — filed companies carry no sample series and drop out of past years`)) : plot);
  const illus = illusNote(rows, 'plotted');
  if (illus) card.append(illus);

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
  if (!nothing) card.append(leg);
  card.append(el('div', { style: 'margin-top:var(--sm)' },
    el('div', { class: 'prov', html: [
      `<b>Period</b> ${rr.yi === YEARS.length - 1 ? 'latest reported for each company' : `FY${YEARS[rr.yi]} reported`}`,
      `<b>Price</b> ${rr.yi === YEARS.length - 1 ? 'each company’s own basis — sample figure, entered close or end-of-day file, as its page states' : `sample series, FY${YEARS[rr.yi]}`}`,
      `<b>Cohort</b> ${rr.cohort === 'sector' ? 'sector-relative' : 'market-absolute'}`,
      `<b>Universe</b> ${rows.length} eligible of ${scoped.length}`,
      `<b>Model</b> ${MODEL_VERSION}`,
    ].join('<span class="dotsep"></span>') })));
  if (unplotted) card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    `${unplotted} of ${scoped.length} companies in this universe are not plotted: ${[
      unpriced ? `${unpriced} ${unpriced === 1 ? 'carries' : 'carry'} no price${rr.yi === YEARS.length - 1 ? '' : ` for FY${YEARS[rr.yi]}`}, so no difference to a model estimate can be computed` : null,
      noModel ? `${noModel} ${noModel === 1 ? 'has' : 'have'} a price but no base-case model estimate` : null,
      belowConf ? `${belowConf} ${belowConf === 1 ? 'has' : 'have'} a model confidence below ${rr.minConf === 'high' ? 'High' : 'Medium'}, the least the confidence filter admits` : null,
    ].filter(Boolean).join('; ')}.`));

  if (!nothing) card.append(tableTwin('Show the table view of every plotted company',
    ['Company', 'Market', rr.yi === YEARS.length - 1 ? 'Price' : `Price FY${YEARS[rr.yi]}`, 'vs base-case model estimate', 'Quality pct', 'Market cap', 'Model', 'Confidence'],
    rows.map(r => [`${r.c.tk} — ${esc(r.c.name)}${dataText(r.c)}`, r.c.mkt, fmtMoney(r.price, r.c.ccy),
      withSign(r.val.mos.base, 1), pctText(r),
      fmtCap(toBase(r.d.m.mcap, r.c.ccy), State.baseCcy), esc(r.val.pack.name), r.val.confBand])));
  wrap.append(card);

  const cohortLabel = rr.cohort === 'sector' ? 'sector' : 'market';
  if (!nothing) scatterChart(plot, {
    points,
    xLabel: 'Difference to model estimate vs base-case value — right of the line is below it, left is above it',
    xLabelShort: 'Difference to model estimate vs base-case model estimate',
    yLabel: `Quality percentile within ${cohortLabel} cohort`,
    yLabelShort: `Quality percentile (${cohortLabel})`,
    /* withSign, as the table beside it prints: Maybank's +0.12% read "+0%"
       (a sign on a figure that rounds to nought), -0.3% read "-0%", and every
       price above the estimate took an ASCII hyphen for its minus. */
    xFmt: v => withSign(v, 0),
    onPick: id => openRadarDetail(id, rr.yi),
  });

  const unranked = rows.filter(r => !isNum(pctOf(r)));
  if (unranked.length) {
    const noScore = unranked.filter(r => !isNum(r.q?.score)).length, alone = unranked.length - noScore;
    const why = [
      noScore ? `${noScore} ${noScore === 1 ? 'has' : 'have'} no quality score, because the inputs it reads are not among the figures held for ${noScore === 1 ? 'it' : 'them'}` : null,
      alone ? `${alone} ${alone === 1 ? 'is the only company' : 'are each the only company'} in ${alone === 1 ? 'its' : 'their'} sector in this dataset, so there is no sector cohort to rank against` : null,
    ].filter(Boolean).join('; ');
    wrap.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      `${unranked.length} of ${rows.length} plotted companies have no ${cohortLabel} percentile: ${why}. They are plotted at the midpoint rather than dropped — the height of those marks is a plotting position, not a rank — and the table view says so for each.`));
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
    el('h3', { class: 'h-section' }, r.c.tk), dataChip(r.c), marketChip(r.c.mkt), el('span', { class: 'chip' }, r.c.sector),
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
  /* A toggle that says where it stands, as the company header's does. The
     label was worked out once when the drawer opened, and toggleWatch
     redraws the page behind the drawer, not the drawer: after "Add to
     watchlist" added the company the button still said so, and the second
     press quietly removed it again. Its label and aria-pressed are set
     again from the list itself after every press — also when the press is
     refused, which leaves the list as it was. */
  const watchBtn = el('button', { class: 'btn btn-ghost btn-sm' });
  const showWatch = () => { const on = State.watchlist.includes(id);
    watchBtn.textContent = on ? '✓ On your watchlist' : 'Add to watchlist'; watchBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  watchBtn.addEventListener('click', () => { toggleWatch(id); showWatch(); });
  showWatch();
  acts.append(watchBtn);
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
    el('td', { class: 'ident' }, r.c.tk + dataText(r.c)), el('td', {}, scoreText(r.scores.quality.score)),
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
  /* seg-group, as the area screen's strips are: the label keeps its width and
     goes above the strip when the two do not fit side by side. As a plain row
     the six-button strip took the width and crushed its label to "Me / asu /
     re", three lines for one word, at every width from 360 to 768px. */
  row.append(el('div', { class: 'row seg-group', style: 'gap:8px' }, [
    el('span', { class: 'caption', style: 'font-weight:600' }, 'Measure'),
    el('div', { class: 'segmented' }, HEAT_MODES.map(m =>
      el('button', { 'aria-pressed': st.mode === m.id ? 'true' : 'false', onclick: () => { st.mode = m.id; render(); } }, m.label))),
  ]));
  row.append(el('div', { class: 'row seg-group', style: 'gap:8px' }, [
    el('span', { class: 'caption', style: 'font-weight:600' }, 'Universe'),
    /* Named for what they filter — the market — as on the value map. "FBM
       KLCI" drew eighteen Bursa tiles, four of them not index constituents;
       "S&P 500" was every US row carried here. */
    el('div', { class: 'segmented' }, [['all', 'All'], ['US', 'US'], ['MY', 'Bursa'], ['watchlist', 'Watchlist']].map(([v, l]) =>
      el('button', { 'aria-pressed': st.universe === v ? 'true' : 'false', onclick: () => { st.universe = v; render(); } }, l))),
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
    /* The panel says when all it holds is illustrative ("United States"
       held one synthetic company), and counts in the singular for one. */
    if (label) box.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:8px' }, [
      marketChip(gr[0].c.mkt),
      el('span', { class: 'h-card', style: 'font-size:13px' }, label),
      gr.every(r => !r.c.real) ? illusChip({ real: false }) : null,
      el('span', { class: 'metaline' }, `${gr.length} ${gr.length === 1 ? 'company' : 'companies'} · area scaled within this market`),
    ]));
    const host = el('div', { style: 'width:100%' });
    box.append(host);
    panels.append(box);
    mounts.push([host, gr]);
  });
  /* No tile to draw is said: an empty watchlist left a blank card over "0
     companies" and an empty table link. */
  card.append(rows.length ? panels : emptyState(chartEmptyWhy(st.universe, scoped, 'drawn')));
  const illus = illusNote(rows, 'drawn');
  if (illus) card.append(illus);

  /* scale legend — required for any continuous colour scale */
  const leg = el('div', { class: 'row row-wrap', style: 'gap:var(--md);margin-top:var(--md);padding-top:var(--sm);border-top:1px solid var(--grid)' });
  /* The two end labels do not wrap; the ramp gives way instead. A .metaline
     may break anywhere, so at 390px the 220px ramp squeezed "−3.00%" onto two
     lines, "−3.00" above "%", on either side of it — a scale whose ends read
     as a number and a stray sign. min-width:0 lets the ramp shrink below the
     sum of its 20px steps, which it could not while the labels were the only
     thing that would. */
  const ramp = el('div', { class: 'row', style: 'gap:0;min-width:0' });
  DIVERGING.forEach(v => ramp.append(el('span', { style: `width:20px;height:9px;background:var(${v})` })));
  const rampEnd = (v) => el('span', { class: 'metaline', style: 'white-space:nowrap' }, mode.fmt(v));
  if (rows.length) leg.append(el('span', { class: 'legend-item', style: 'min-width:0' }, [rampEnd(-mode.full), ramp, rampEnd(mode.full)]));
  const missingWhat = mode.price ? `observed ${mode.id === 'd1' ? 'day' : mode.label} change` : mode.label.toLowerCase().replace(/^vs /, 'difference to ');
  /* A price move is dated by the prices it is computed from, which are fixed
     files and sample figures, not a feed — so the caption names their dates. */
  const pxDates = mode.price ? [...new Set(rows.map(r => priceAsOfLabel(r.c)))] : [];
  leg.append(el('span', { class: 'caption', style: 'margin-left:auto' }, `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} · ${mode.label}${mode.id === 'd1' ? ' vs previous close' : ''}${pxDates.length ? ` · prices as of ${pxDates.join('; ')}` : ''}${unobserved ? ` · ${unobserved} priced but with no ${missingWhat}, not drawn` : ''}`));
  card.append(leg);
  if (noCap) {
    const unpriced = scoped.filter(r => !isNum(r.m.mcap) && !isNum(r.c.px?.p)).length;
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `${noCap} of ${scoped.length} companies in this universe have no market capitalisation to size a tile — ${unpriced} carry no price${noCap > unpriced ? `, ${noCap - unpriced} no usable share count` : ''} — so they are not drawn.`));
  }
  if (rows.length) card.append(tableTwin('Show the table view of every tile',
    ['Company', 'Market', mode.label, 'Market cap'],
    rows.map(r => [`${r.c.tk} — ${esc(r.c.name)}${dataText(r.c)}`, r.c.mkt, mode.fmt(mode.get(r)), fmtCap(toBase(r.m.mcap, r.c.ccy), State.baseCcy)])));
  wrap.append(card);

  /* tag: an illustrative tile says so in its accessible name (illusNote). */
  mounts.forEach(([host, gr]) => treemap(host, {
    items: gr.map(r => ({
      id: r.c.id, label: r.c.tk, name: r.c.name + dataText(r.c), tag: dataTag(r.c),
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
  body.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:2px' }, [el('h3', { class: 'h-section' }, r.c.tk), dataChip(r.c), marketChip(r.c.mkt)]));
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

/* A STRIP OF TABS, ONE DEFINITION. role="tab" needs a tablist around it and
   arrow keys between the tabs, or a screen reader announces a tab with no set
   to belong to. The company page learned that; Discover and Learn did not,
   and announced four and five orphan tabs every one of which was its own Tab
   stop. The selected tab is the one Tab stop; the arrows, Home and End move
   focus along the strip, and Enter or Space opens the focused one. */
function tabStrip(label, tabs, current, open, attrs = {}) {
  const sub = el('div', { class: 'subnav', role: 'tablist', 'aria-label': label, ...attrs });
  sub.addEventListener('keydown', e => {
    const all = [...sub.querySelectorAll('[role=tab]')];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    all[(to + all.length) % all.length].focus();
  });
  const stop = tabs.some(t => t.id === current) ? current : tabs[0].id;
  tabs.forEach(t => sub.append(el('button', {
    role: 'tab', 'aria-selected': current === t.id ? 'true' : 'false', tabindex: t.id === stop ? '0' : '-1',
    onclick: () => open(t.id) }, t.label)));
  return sub;
}

VIEWS.discover = () => {
  const wrap = el('div');
  /* Equities Research's Screener (Release A): the product tab row above
     names the product, and the page opens with the one head every product
     page wears (pageHead, 36-layouts.js; Release B) — it had an eyebrow of
     its own and no lede. */
  /* The value map has an address, a title and a place in the sitemap of its
     own (ROUTES: "Quality vs Value Map"), and was served under the
     screener's heading — two indexed pages, one h1 (2026-10-04). It is
     headed by its own name; the tools that ride on ?tab= keep the page's. */
  wrap.append(pageHead({ title: State.discoverTab === 'radar' ? 'Quality vs Value Map' : 'Narrow the universe to what is worth reading',
    lede: 'Screen the companies held here on quality, financial strength and valuation.', cls: 'page-hd-tools' }));
  /* Through the address: /discover/screener and /discover/value-map have
     routes of their own, the other two ride on ?tab=. A segmented control,
     not a second underline row: under the product's own underline tabs, two
     identical rows gave no sign which was the product's and which this
     page's. The tablist, its keys and its one tab stop are unchanged. */
  wrap.append(el('div', { style: 'margin-bottom:var(--lg)' },
    tabStrip('Screener tools', DISCOVER_TABS, State.discoverTab, id => go('discover', { tab: id }), { class: 'segmented tools-seg' })));

  /* With a fallback: a tab id this view does not know renders the screener
     rather than throwing out of render() and leaving the previous page on
     screen under a /discover address. */
  const panel = { screener: renderScreener, radar: renderRadar, ideas: renderIdeas, heatmap: renderHeatmap }[State.discoverTab] || renderScreener;
  wrap.append(panel());
  return wrap;
};

