/* ==========================================================================
   CHART LAYER
   Thin marks, hairline solid grid, 2px surface gaps between touching fills,
   2px surface rings on overlapping markers, selective direct labels, a hover
   layer on every form, and a table-view twin so no value is gated by a tooltip.
   ========================================================================== */

const TIP = $('#viztip');
function showTip(html, x, y) {
  TIP.innerHTML = html;
  TIP.dataset.show = '1';
  const r = TIP.getBoundingClientRect();
  const left = clamp(x + 14, 8, window.innerWidth - r.width - 8);
  const top = clamp(y - r.height - 12, 8, window.innerHeight - r.height - 8);
  TIP.style.left = left + 'px';
  TIP.style.top = top + 'px';
}
function hideTip() { TIP.dataset.show = '0'; }
document.addEventListener('scroll', hideTip, true);

const SVGNS = 'http://www.w3.org/2000/svg';
/* The optional third argument sets text content, so a <text> node is one call
   rather than two. Existing callers pass two arguments and are unaffected. */
function sv(tag, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

/* Axis ticks land on clean numbers (0 / 500 / 1,000), never on raw data bounds. */
function niceTicks(lo, hi, count = 4) {
  const span = (hi - lo) || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return { ticks, lo: start, hi: end };
}

/* Re-render on container resize so charts stay responsive without a library. */
const RESIZERS = new WeakMap();
function chartHost(container, draw) {
  const run = () => {
    const w = container.clientWidth;
    if (!w) return;
    container.replaceChildren(draw(w));
  };
  run();
  if (!RESIZERS.has(container)) {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
    ro.observe(container);
    RESIZERS.set(container, ro);
  } else {
    RESIZERS.get(container).__draw = run;
  }
  container.__redraw = run;
}

/* PAYOFF OF A CASH-SECURED PUT, AT EXPIRY.
   ---------------------------------------------------------------------------
   The Wheel showed maximum downside as a single figure. A number says how bad
   it gets; the shape says where it turns, how fast, and how much of the range
   is the flat part where the premium is the whole result — which is the thing a
   first-time seller most often has not pictured.

   Polarity is carried by POSITION against the zero line first. Colour
   reinforces it, and the pair is the validated one rather than the product's
   green and rust, which a deuteranope cannot separate.

   Everything drawn is arithmetic on figures the reader entered: strike,
   premium, multiplier, contracts. Nothing is a forecast, no probability is
   implied, and the x-axis is the underlying price rather than time. */
function payoffChart(container, m, p) {
  const shares = num0(m.deliverableShares);
  const strike = num0(p.putStrike);
  if (!(shares > 0) || !(strike > 0)) return;
  const prem = num0(m.putPremiumCashReceived);
  const feesAtAssign = num0(p.assignmentFees);

  const xMaxOut = strike * 2;
  const pnlAt = (px) => (px >= strike ? prem : prem - (strike - px) * shares - feesAtAssign);

  const host = el('div');
  container.append(host);
  chartHost(host, (w) => {
    const h = 210, padL = 56, padR = 14, padT = 12, padB = 30;
    const iw = Math.max(40, w - padL - padR), ih = h - padT - padB;
    /* Zero to twice the strike shows the whole shape: the flat premium ceiling,
       the hinge at the strike, and the loss running to a floor. */
    const xMax = strike * 2;
    const pnlAt = (px) => (px >= strike ? prem : prem - (strike - px) * shares - feesAtAssign);
    const yMin = pnlAt(0), rawMax = prem;
    /* Headroom, so the premium ceiling is a line the eye can see rather than
       the top edge of the plot. The premium is a sliver against the downside
       here — 109 against 4,891 — and that compression IS the message, but the
       sliver still has to be visible. */
    const yMax = rawMax + (rawMax - yMin) * 0.08;
    const span = (yMax - yMin) || 1;
    const X = (px) => padL + (px / xMax) * iw;
    const Y = (v) => padT + (1 - (v - yMin) / span) * ih;

    const g = sv('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', tabindex: '0', class: 'chart-focusable',
      'aria-label': `Payoff at expiry for one cash-secured put struck at ${fmtMoney(strike, 'USD')}. `
        + `Maximum result ${fmtMoney(rawMax, 'USD')} above the strike, worst case ${fmtMoney(yMin, 'USD')} at zero.` });

    /* Recessive grid, then the zero line, which is the only emphatic rule. */
    [0.25, 0.5, 0.75].forEach(f => g.append(sv('line',
      { x1: padL, x2: padL + iw, y1: padT + f * ih, y2: padT + f * ih, stroke: 'var(--grid)', 'stroke-width': 1 })));

    const zeroY = Y(0);
    const pts = [];
    for (let i = 0; i <= 120; i++) { const px = (i / 120) * xMax; pts.push([X(px), Y(pnlAt(px))]); }

    /* Two washes, clipped at zero by construction rather than by opacity. */
    const area = (from, to, fill) => {
      const seg = pts.filter(([, y]) => (from === 'above' ? y <= zeroY : y >= zeroY));
      if (seg.length < 2) return;
      const d = `M ${seg[0][0]} ${zeroY} ` + seg.map(([x, y]) => `L ${x} ${y}`).join(' ')
        + ` L ${seg[seg.length - 1][0]} ${zeroY} Z`;
      g.append(sv('path', { d, fill, opacity: 0.16 }));
    };
    area('above', 0, 'var(--pol-pos)');
    area('below', 0, 'var(--pol-neg)');

    g.append(sv('line', { x1: padL, x2: padL + iw, y1: zeroY, y2: zeroY,
      stroke: 'var(--ink-3)', 'stroke-width': 1.5 }));

    /* The payoff itself: 2px, round joins, drawn over the washes. */
    g.append(sv('path', { d: 'M ' + pts.map(([x, y]) => `${x} ${y}`).join(' L '),
      fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    /* TWO MARKS, ENCODED DIFFERENTLY ON PURPOSE.
       -----------------------------------------------------------------------
       The first draft drew both as vertical dashed rules. On a sensibly struck
       put they land about one premium apart — $50.00 and $48.91 here, 1.1% of
       a 0–2× axis, three pixels — so they render as a single line with two
       labels beside it, which invites the reader to believe they can see a gap
       that is not there.
       The break-even is BY DEFINITION the price where the payoff crosses zero,
       so a dot on the crossing says it exactly, sits on a curve the eye is
       already following, and cannot be confused with the strike rule however
       close the two prices are. */
    /* Each label sits against the mark it names. Putting both along the bottom
       read cleanly and said the wrong thing: "break-even" ended up beside the
       strike rule, 140px from the dot it belongs to, so it named the line. */
    const label = (x, y, text, colour) => {
      const flip = x + 76 > padL + iw;
      g.append(sv('text', { x: flip ? x - 12 : x + 6, y, class: 'dl', fill: colour,
        'text-anchor': flip ? 'end' : 'start' }, text));
    };

    if (strike >= 0 && strike <= xMax) {
      g.append(sv('line', { x1: X(strike), x2: X(strike), y1: padT, y2: padT + ih,
        stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
      /* Along the bottom of its own rule, not the top: the premium ceiling runs
         across the top of the plot and a label there sat on the line. */
      label(X(strike), padT + ih - 6, 'strike', 'var(--ink-3)');
    }
    const be = m.putBreakEven;
    if (isNum(be) && be > 0 && be <= xMax) {
      /* 2px surface ring, because the dot sits on the payoff path. */
      g.append(sv('circle', { cx: X(be), cy: zeroY, r: 5,
        fill: 'var(--pol-neg)', stroke: 'var(--surface)', 'stroke-width': 2 }));
      /* Below and right of the dot — the one quadrant that is always empty,
         since right of the strike the payoff is flat along the top. */
      label(X(be), zeroY + 17, 'break-even', 'var(--pol-neg)');
    }

    /* Axis: the two figures that bound the outcome, and the price scale. The
       zero label is dropped when the premium ceiling sits on top of it — which
       it does whenever the premium is small against the downside, i.e. always
       on a sensibly struck put. Two labels in the same 6px is worse than one. */
    const maxY = Y(rawMax), minY = Y(yMin);
    g.append(sv('text', { x: padL - 6, y: maxY + 4, class: 'ax-label', 'text-anchor': 'end' }, fmtAmount(rawMax, 'USD')));
    g.append(sv('text', { x: padL - 6, y: minY + 4, class: 'ax-label', 'text-anchor': 'end' }, fmtAmount(yMin, 'USD')));
    if (Math.abs(zeroY - maxY) > 14 && Math.abs(zeroY - minY) > 14)
      g.append(sv('text', { x: padL - 6, y: zeroY + 4, class: 'ax-label', 'text-anchor': 'end' }, '0'));
    [0, strike, xMax].forEach(px => g.append(sv('text',
      { x: X(px), y: h - 10, class: 'ax-label', 'text-anchor': px === 0 ? 'start' : (px === xMax ? 'end' : 'middle') },
      fmtAmount(px, 'USD'))));
    return g;
  });

  /* Five points that define the shape: the floor, the hinge, the break-even and
     the ceiling. A reader who cannot see the plot needs the turning points,
     not a sample of the line at fifty prices. */
  const be = strike - (prem - feesAtAssign) / shares;
  container.append(tableTwin('Show the table view',
    ['Price at expiry', 'Result', 'What happens there'],
    [[fmtAmount(0, 'USD'), fmtAmount(pnlAt(0), 'USD'), 'The shares go to zero — the worst case'],
     [fmtAmount(be, 'USD'), fmtAmount(pnlAt(be), 'USD'), 'Break-even: the premium exactly offsets the loss'],
     [fmtAmount(strike, 'USD'), fmtAmount(pnlAt(strike), 'USD'), 'At the strike — assignment begins below this'],
     [fmtAmount(xMaxOut, 'USD'), fmtAmount(prem, 'USD'), 'Above the strike the premium is the whole result']]));
}

/* WHERE THE CASH TO BUY ACTUALLY GOES.
   ---------------------------------------------------------------------------
   The calculator listed every cost line honestly and totalled them correctly,
   and the reader still could not see the thing that decides the purchase: the
   cash needed to COMPLETE and the cash needed to be SAFE are not the same
   number. Here they are RM95,254 and RM130,142 — a 37% difference hidden
   between two rows of a table, which is exactly the gap that empties a bank
   account three months after the keys are handed over.

   A build-up waterfall says it in one shape. Each group floats from the
   running total to the new one, so its own magnitude is a length, and the
   summary bar underneath splits at the completion figure.

   COLOUR: the two tiers are ORDERED, not categorical — everything you must
   find to complete is also part of what you must find to be safe. So a
   sequential pair from one hue, not two invented hues. Measured on --seq-6
   against --seq-4: ΔE 19.9 deutan / 20.0 normal in light, 19.5 / 19.6 in dark,
   and both steps clear 3:1 against their own surface in both modes. The ramp
   is mode-aware, so the same two tokens are correct in each.

   Rows rather than columns because "Initial improvement costs" does not fit
   under a 60px column at 390px, and rotated axis labels are not an answer. */
function cashWaterfall(container, m) {
  const groups = (m.costGroups || []).map(g => ({
    label: g.label,
    value: g.items.reduce((s, it) => s + (isNum(it[1]) ? it[1] : 0), 0),
    unpriced: g.items.filter(it => !isNum(it[1])).length,
  })).filter(g => g.value > 0);
  const total = groups.reduce((s, g) => s + g.value, 0);
  if (groups.length < 2 || !(total > 0)) return;

  /* The tier boundary is DERIVED, not hardcoded to two group ids. Groups are
     accumulated in order and the split is placed where the running total
     reaches transactionCash. If it never lands on a group boundary — because a
     group was added, split or reordered — the chart falls back to one tier
     rather than drawing a division that has quietly stopped being true. */
  const toComplete = num0(m.transactionCash);
  let acc = 0, splitAfter = -1;
  groups.forEach((g, i) => { acc += g.value; if (Math.abs(acc - toComplete) < 0.01) splitAfter = i; });
  const twoTier = splitAfter >= 0 && splitAfter < groups.length - 1;

  const host = el('div');
  container.append(host);
  chartHost(host, (w) => {
    const rowH = 44, barH = 14, sumH = 52;
    const h = groups.length * rowH + sumH;
    const X = (v) => (v / total) * w;
    const g = sv('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', tabindex: '0', class: 'chart-focusable',
      'aria-label': `Cash needed to buy, built up in ${groups.length} groups totalling `
        + `${fmtMoney(total, 'MYR')}. ` + (twoTier
          ? `${fmtMoney(toComplete, 'MYR')} of that is needed to complete the purchase; `
            + `${fmtMoney(total - toComplete, 'MYR')} is needed afterwards to be safe.`
          : '') });

    let run = 0;
    groups.forEach((grp, i) => {
      const top = i * rowH;
      const strong = twoTier && i <= splitAfter;
      const fill = strong ? 'var(--seq-6)' : 'var(--seq-4)';

      g.append(sv('text', { x: 0, y: top + 12, class: 'dl', fill: 'var(--ink-2)' }, grp.label));
      g.append(sv('text', { x: w, y: top + 12, class: 'dl', fill: 'var(--ink)',
        'text-anchor': 'end' }, fmtAmount(grp.value, 'MYR')));

      /* A track, so a step reads as a share of the total and not just as a bar
         of some length. --grid rather than --surface-sunk: sunk is #0d100f
         against a #111413 dark surface, which is invisible, and a track nobody
         can see removes the only thing that made the step a proportion. */
      g.append(sv('rect', { x: 0, y: top + 20, width: w, height: barH, rx: 3,
        fill: 'var(--grid)' }));
      const x0 = X(run), x1 = X(run + grp.value);
      g.append(sv('rect', { x: x0, y: top + 20, width: Math.max(2, x1 - x0), height: barH,
        rx: 3, fill }));

      run += grp.value;
      /* The connector that makes it a waterfall rather than four bars: it
         carries the running total down into the next step's starting edge. */
      if (i < groups.length - 1) g.append(sv('line', { x1: X(run), x2: X(run),
        y1: top + 20 + barH, y2: top + rowH + 20, stroke: 'var(--line-2)',
        'stroke-width': 1, 'stroke-dasharray': '2 2' }));
    });

    /* The summary bar: the same total, split where completion ends. */
    const sy = groups.length * rowH + 6;
    g.append(sv('text', { x: 0, y: sy + 12, class: 'dl', fill: 'var(--ink)' }, 'Total cash to be safe'));
    g.append(sv('text', { x: w, y: sy + 12, class: 'dl', fill: 'var(--ink)',
      'text-anchor': 'end' }, fmtAmount(total, 'MYR')));
    if (twoTier) {
      const xc = X(toComplete);
      /* 2px surface gap between the two fills, per the mark spec — abutting
         fills of one hue otherwise read as a single bar. */
      g.append(sv('rect', { x: 0, y: sy + 20, width: Math.max(2, xc - 1), height: barH,
        rx: 3, fill: 'var(--seq-6)' }));
      g.append(sv('rect', { x: xc + 1, y: sy + 20, width: Math.max(2, w - xc - 1), height: barH,
        rx: 3, fill: 'var(--seq-4)' }));
    } else {
      g.append(sv('rect', { x: 0, y: sy + 20, width: w, height: barH, rx: 3, fill: 'var(--seq-6)' }));
    }
    return g;
  });

  container.append(tableTwin('Show the table view',
    ['Group', 'Amount', twoTier ? 'When it is needed' : 'Unpriced lines'],
    groups.map((g2, i) => [g2.label, fmtMoney(g2.value, 'MYR', 0),
      twoTier ? (i <= splitAfter ? 'To complete the purchase' : 'Afterwards, to be safe')
              : (g2.unpriced ? `${g2.unpriced} line(s) not priced` : '—')])
      .concat([['Total', fmtMoney(total, 'MYR', 0), twoTier ? `${fmtMoney(toComplete, 'MYR', 0)} of it to complete` : '']])));
}

/* ONE VALUE AGAINST ONE THRESHOLD — THE PRODUCT'S SECOND CHART GRAMMAR.
   ---------------------------------------------------------------------------
   Three different questions turned out to have the same shape. Is the rent
   enough to cover the costs and the loan? Is the cash enough to be put the
   shares? Does this timeframe clear the floor its template requires? Each is a
   quantity, a line it must reach, and which side of the line it lands on.

   They are drawn identically on purpose. A reader who learns to read the
   property bar can read the collateral bar without being taught it again, and
   a shared grammar makes the odd one out — the payoff chart, which is a
   function rather than a comparison — legible as a different kind of claim.

   Polarity, so --pol-pos / --pol-neg rather than the series ramp: the only
   question a colour answers here is which side of the line it is on. Labels
   are stacked on separate rows for the reason the payoff chart's were — when
   the value is near the threshold the two marks are pixels apart, and that is
   exactly the case where both need to stay readable. */
function thresholdBar(container, o) {
  const { value, threshold, ccy = 'MYR' } = o;
  if (!isNum(threshold) || !(threshold > 0) || !isNum(value)) return;
  const covers = value >= threshold;

  const host = el('div');
  container.append(host);
  chartHost(host, (w) => {
    const h = 76, barY = 10, barH = 22, padR = 2;
    const iw = Math.max(40, w - padR);
    const scale = Math.max(value, threshold) * 1.12 || 1;
    const X = (v) => (v / scale) * iw;

    const g = sv('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', tabindex: '0', class: 'chart-focusable',
      'aria-label': o.aria(covers, Math.abs(value - threshold)) });

    g.append(sv('rect', { x: 0, y: barY, width: iw, height: barH, rx: 3, fill: 'var(--grid)' }));
    g.append(sv('rect', { x: 0, y: barY, width: Math.max(2, X(value)), height: barH, rx: 3,
      fill: covers ? 'var(--pol-pos)' : 'var(--pol-neg)' }));

    /* The threshold, drawn over the bar and ringed in the surface colour so it
       stays legible whichever side of it the fill ends on. */
    const bx = X(threshold);
    g.append(sv('line', { x1: bx, x2: bx, y1: barY - 4, y2: barY + barH + 4,
      stroke: 'var(--surface)', 'stroke-width': 4 }));
    g.append(sv('line', { x1: bx, x2: bx, y1: barY - 4, y2: barY + barH + 4,
      stroke: 'var(--ink)', 'stroke-width': 2 }));

    const put = (x, y, text, colour) => {
      const flip = x > iw * 0.62;
      g.append(sv('text', { x: flip ? x - 6 : x + 6, y, class: 'dl', fill: colour,
        'text-anchor': flip ? 'end' : 'start' }, text));
    };
    /* Exact to the unit, not fmtAmount's abbreviation. A rent of RM1,850
       against RM3,234 is the whole comparison; rendered as "RM1.9k" against
       "RM3.2k" it loses a hundred ringgit at each end and the reader cannot
       tell how far short they actually are. The waterfall abbreviates because
       there the figures are axis furniture and proportion is the message —
       here the figures ARE the message. */
    put(bx, barY + barH + 20, `${o.thresholdLabel} ${fmtMoney(threshold, ccy, 0)}`, 'var(--ink)');
    put(X(value), barY + barH + 34, `${o.valueLabel} ${fmtMoney(value, ccy, 0)}`,
      covers ? 'var(--pol-pos)' : 'var(--pol-neg)');
    return g;
  });

  container.append(tableTwin('Show the table view', ['', 'Amount'], [
    [o.valueLabel, fmtMoney(value, ccy, 0)],
    [o.thresholdLabel, fmtMoney(threshold, ccy, 0)],
    [covers ? 'Over' : 'Short by', fmtMoney(Math.abs(value - threshold), ccy, 0)],
  ]));
}

/* THREE TIMEFRAMES AGAINST THE FLOOR EACH HAS TO CLEAR.
   ---------------------------------------------------------------------------
   The scores were in a four-column table and the floors were somewhere else
   entirely, so "monthly 29, weekly 37, daily 57" was three numbers the reader
   had to hold against three thresholds they could not see. What the table
   could not show is the shape: on this example every timeframe is under its
   floor and the shortfall WIDENS as the timeframe lengthens, which is the
   difference between a setup that is early and one that is against the trend.

   All three share a 0-100 scale, so the bars are directly comparable — which
   is the point, and is why the floors are drawn on the bars rather than
   listed beside them.

   COVERAGE IS NOT DECORATION HERE. An unrecorded evidence group contributes a
   neutral 50 and lowers coverage, so a score is partly a placeholder whenever
   coverage is below 100%. Drawing the bar without saying so would present a
   half-filled form as a measurement, which is the exact failure this product
   exists to avoid — so every row states its coverage and names what is
   missing. */
function timeframeScoreBars(container, tfs, floors) {
  const rows = QTTI_TIMEFRAMES
    .map(t => ({ t, x: tfs?.[t.k], floor: num0(floors?.[t.k]) }))
    .filter(r => r.x && r.x.present && isNum(r.x.score));
  if (rows.length < 2) return;

  const host = el('div');
  container.append(host);

  chartHost(host, (w) => {
    const rowH = 44, barH = 16, h = rows.length * rowH;
    const X = (v) => (clamp(v, 0, 100) / 100) * w;
    const g = sv('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', tabindex: '0', class: 'chart-focusable',
      'aria-label': 'Timeframe scores against the floor each must clear for this template. '
        + rows.map(r => `${r.t.label} ${Math.round(r.x.score)} against a floor of ${r.floor}, `
          + `${r.x.score >= r.floor ? 'clear' : 'short'}, coverage ${Math.round(r.x.coverage * 100)}%.`).join(' ') });

    rows.forEach((r, i) => {
      const top = i * rowH, clears = r.x.score >= r.floor;
      g.append(sv('text', { x: 0, y: top + 12, class: 'dl', fill: 'var(--ink-2)' },
        `${r.t.label} · ${Math.round(r.t.w * 100)}% weight`));
      g.append(sv('text', { x: w, y: top + 12, class: 'dl', fill: 'var(--ink)',
        'text-anchor': 'end' }, `${Math.round(r.x.score)} / ${r.floor}`));

      g.append(sv('rect', { x: 0, y: top + 18, width: w, height: barH, rx: 3, fill: 'var(--grid)' }));
      g.append(sv('rect', { x: 0, y: top + 18, width: Math.max(2, X(r.x.score)), height: barH, rx: 3,
        fill: clears ? 'var(--pol-pos)' : 'var(--pol-neg)' }));

      /* The floor, ringed in the surface colour so it stays readable whichever
         side of it the fill ends on. */
      const fx = X(r.floor);
      g.append(sv('line', { x1: fx, x2: fx, y1: top + 14, y2: top + 18 + barH + 4,
        stroke: 'var(--surface)', 'stroke-width': 4 }));
      g.append(sv('line', { x1: fx, x2: fx, y1: top + 14, y2: top + 18 + barH + 4,
        stroke: 'var(--ink)', 'stroke-width': 2 }));

    });
    return g;
  });

  /* THE COVERAGE NOTES LIVE IN HTML, NOT IN THE SVG.
     They started as a third line of SVG text inside each row and overflowed
     the plot at 390px — SVG text does not wrap, so "coverage 90% — relative
     strength not recorded, counted neutral at 50" simply ran off the right
     edge. The obvious fix is to shorten it on narrow screens, which would
     abbreviate the sentence that says the score is part placeholder on the
     device most likely to be read in a hurry. In HTML it wraps, stays
     selectable and is never the thing that gets cut. */
  const notes = el('ul', { class: 'metaline', style: 'margin:var(--sm) 0 0;padding-left:1.1em' });
  rows.forEach(r => {
    const cov = Math.round(r.x.coverage * 100);
    notes.append(el('li', { style: 'margin-top:2px' }, cov >= 100
      ? `${r.t.label}: every evidence group recorded.`
      : `${r.t.label}: coverage ${cov}% — ${r.x.unknown.join(', ').toLowerCase()} `
        + 'not recorded, counted at a neutral 50 rather than as a zero.'));
  });
  container.append(notes);

  container.append(tableTwin('Show the table view',
    ['Timeframe', 'Weight', 'Score', 'Floor', 'Clears', 'Coverage'],
    rows.map(r => [r.t.label, `${Math.round(r.t.w * 100)}%`, String(Math.round(r.x.score)),
      String(r.floor), r.x.score >= r.floor ? 'yes' : 'no',
      `${Math.round(r.x.coverage * 100)}%`])));
}

/* THE CURRENT RESULT, ITS BLOCKER AND THE NEXT ACTION — ALWAYS ON SCREEN.
   ---------------------------------------------------------------------------
   `figs` are the two to four numbers that answer the tool's question. `blocker`
   is the single thing most in the way of a usable answer, or null when nothing
   is. `next` is one button that goes to it.

   Three rules this must not break, all of them the product's own:
     - it states results, never a recommendation. No Buy/Hold/Sell vocabulary
       reaches it, and it never renders a suggestion about what to do with an
       instrument — only what is missing from the calculation.
     - a withheld figure shows as an em dash, never as zero. A dock that
       reported "RM0" for a rent nobody entered would be the most-read wrong
       number on the page.
     - it is a summary of what is already on screen, so it introduces no
       figure the reader cannot scroll up and check. */
function decisionDock({ figs, blocker, next }) {
  const dock = el('div', { class: 'dock', role: 'complementary', 'aria-label': 'Current result and next action' });
  const inner = el('div', { class: 'dock-inner' });

  const fg = el('div', { class: 'dock-figs' });
  (figs || []).forEach(f => {
    if (!f) return;
    const box = el('div', { class: 'dock-fig' });
    box.append(el('span', { class: 'dock-fig-v', style: f.tone ? `color:var(${f.tone})` : null },
      f.value == null || f.value === '' ? '—' : f.value));
    box.append(el('span', { class: 'dock-fig-k' }, f.label));
    fg.append(box);
  });
  inner.append(fg);

  if (blocker) inner.append(el('div', { class: 'dock-blocker' }, [
    el('span', { class: 'chip chip-bronze', style: 'margin-right:8px' }, 'Blocker'),
    el('span', {}, blocker),
  ]));

  if (next) {
    const acts = el('div', { class: 'dock-acts' });
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: next.onclick }, next.label));
    inner.append(acts);
  }
  dock.append(inner);
  return dock;
}

/* SAVE · DUPLICATE · RESET, IN THE SAME PLACE ON EVERY TOOL.
   ---------------------------------------------------------------------------
   One component so the controls cannot drift apart between three surfaces, and
   directly under the page heading on all of them so a returning reader looks in
   one place. `onReset` is passed in rather than derived: what "empty" means is
   the tool's business, and a generic reset that guessed would eventually clear
   the wrong keys. */
function workBar(kind, onReset) {
  const def = WORK_KINDS[kind];
  if (!def) return null;
  const saved = loadWork().filter(r => r.kind === kind);

  const bar = el('div', { class: 'card', style: 'padding:var(--sm) var(--md)' });
  const row = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' });

  row.append(el('span', { class: 'eyebrow', style: 'margin-right:2px' }, 'This browser only'));

  row.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const suggested = def.name();
    const name = prompt(`Name this ${def.label.toLowerCase()}`, suggested);
    if (name === null) return;
    const rec = saveWork(kind, name.trim() || suggested);
    render(); toast(rec ? `Saved "${rec.name}"` : 'Could not save');
  } }, 'Save'));

  if (saved.length) {
    const sel = el('select', { class: 'select select-sm', 'aria-label': `Resume a saved ${def.label.toLowerCase()}`,
      onchange: e => {
        const id = e.target.value;
        if (!id) return;
        if (resumeWork(id)) { render(); toast('Resumed'); }
      } });
    sel.append(el('option', { value: '' }, `Resume… (${saved.length})`));
    saved.forEach(r => sel.append(el('option', { value: r.id }, `${r.name} · ${r.savedAt}`)));
    row.append(sel);

    row.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      const copy = duplicateWork(saved[0].id);
      render(); toast(copy ? `Duplicated "${saved[0].name}"` : 'Nothing to duplicate');
    } }, 'Duplicate latest'));
  }

  row.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
    if (!confirm('Clear the figures currently on screen? Anything you saved stays saved.')) return;
    onReset(); render(); toast('Cleared');
  } }, 'Reset'));

  row.append(el('a', { class: 'btn btn-quiet btn-sm', style: 'margin-left:auto',
    href: href('/my/data'), onclick: (e) => { e.preventDefault(); navigate('/my/data'); } }, 'Back up everything'));

  bar.append(row);
  bar.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    saved.length
      ? `${saved.length} saved in this browser. Each carries the model version and data date it was taken against. Clearing browser data deletes them — download a backup if the work mattered.`
      : 'Nothing saved yet. Saving keeps a named copy so a second candidate does not overwrite the first.'));
  return bar;
}

/* A collapsible table beneath a chart — the WCAG-clean equivalent. */
function tableTwin(caption, headers, rows) {
  const det = el('details', { class: 'caption', style: 'margin-top:var(--sm)' });
  det.append(el('summary', { style: 'cursor:pointer;color:var(--ink-3);font-size:12px' }, caption));
  const wrap = el('div', { class: 'tablewrap', style: 'margin-top:var(--xs)' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, headers.map(h => el('th', {}, h)))));
  t.append(el('tbody', {}, rows.map(r => el('tr', {}, r.map((cell, i) =>
    el('td', { class: i === 0 ? 'ident' : '', html: String(cell) }))))));
  wrap.append(t);
  det.append(wrap);
  return det;
}

/* ------------------------------------------------------------- sparkline */
function sparkline(values, { w = 78, h = 24, up = null } = {}) {
  const vals = (values || []).filter(isNum);
  if (vals.length < 2) return el('span', { class: 'caption' }, '—');
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = i => (i / (vals.length - 1)) * (w - 6) + 3;
  const y = v => h - 3 - ((v - lo) / span) * (h - 6);
  const rising = up ?? (last(vals) >= vals[0]);
  const stroke = rising ? 'var(--up-4)' : 'var(--dn-4)';
  const s = sv('svg', { class: 'spark', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-hidden': 'true' });
  s.append(sv('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
    fill: 'none', stroke, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .55 }));
  /* current period in the accent, per the stat-tile contract */
  s.append(sv('circle', { cx: x(vals.length - 1), cy: y(last(vals)), r: 2.6, fill: stroke,
    stroke: 'var(--surface)', 'stroke-width': 2 }));
  return s;
}

/* --------------------------------------------------------- column chart */
/* series: [{ key, label, values, varName }] — categorical slots in fixed order */
function columnChart(container, { cats, series, fmt = v => fmtNum(v, 1), title = '', unit = '' }) {
  chartHost(container, (W) => {
    const H = 210, padL = 52, padR = 12, padT = 14, padB = 30;
    const iw = W - padL - padR, ih = H - padT - padB;
    const all = series.flatMap(s => s.values).filter(isNum);
    const nt = niceTicks(Math.min(0, ...all), Math.max(0, ...all) * 1.06, 4);
    const top = nt.hi, bot = nt.lo;
    const y = v => padT + ih - ((v - bot) / (top - bot)) * ih;
    const band = iw / cats.length;
    const GAP = 2;                                  /* the surface gap */
    const barW = Math.max(3, Math.min(24, (band - 18) / series.length - GAP));
    /* ~5.6px per character at the 10.5px axis size, plus breathing room. */
    const widestLabel = Math.max(...cats.map(c2 => String(c2).length)) * 5.6 + 8;
    const labelEvery = Math.max(1, Math.ceil(widestLabel / band));

    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': title || 'Column chart' });

    /* hairline solid gridlines on clean tick values */
    nt.ticks.forEach(v => {
      s.append(sv('line', { class: 'gridline', x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
      const t = sv('text', { class: 'ax-label', x: padL - 8, y: y(v) + 3.5, 'text-anchor': 'end' });
      t.textContent = fmt(v); s.append(t);
    });
    s.append(sv('line', { class: 'ax-line', x1: padL, x2: W - padR, y1: y(0), y2: y(0) }));

    cats.forEach((cat, ci) => {
      const groupW = series.length * barW + (series.length - 1) * GAP;
      const x0 = padL + band * ci + (band - groupW) / 2;
      series.forEach((se, si) => {
        const v = se.values[ci];
        if (!isNum(v)) return;
        const x = x0 + si * (barW + GAP);
        const yTop = v >= 0 ? y(v) : y(0);
        const hgt = Math.max(1.5, Math.abs(y(v) - y(0)));
        /* 4px rounded data-end, square at the baseline */
        const r = Math.min(4, hgt / 2, barW / 2);
        const d = v >= 0
          ? `M${x},${yTop + hgt} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + barW - r},${yTop} Q${x + barW},${yTop} ${x + barW},${yTop + r} L${x + barW},${yTop + hgt} Z`
          : `M${x},${yTop} L${x + barW},${yTop} L${x + barW},${yTop + hgt - r} Q${x + barW},${yTop + hgt} ${x + barW - r},${yTop + hgt} L${x + r},${yTop + hgt} Q${x},${yTop + hgt} ${x},${yTop + hgt - r} Z`;
        const p = sv('path', { d, fill: `var(${se.varName})`, opacity: .95 });
        p.style.cursor = 'crosshair';
        /* hit target larger than the mark */
        const hit = sv('rect', { x: x - 4, y: padT, width: barW + 8, height: ih, fill: 'transparent' });
        const tip = () => `<div class="t-title">${esc(cat)}</div>` +
          series.map(z => isNum(z.values[ci])
            ? `<div class="t-row"><span>${esc(z.label)}</span><b>${fmt(z.values[ci])}${unit}</b></div>` : '').join('');
        hit.addEventListener('pointermove', e => showTip(tip(), e.clientX, e.clientY));
        hit.addEventListener('pointerleave', hideTip);
        s.append(p, hit);
      });
      /* Only draw a category label when it fits in its band. When it does not,
         labels are thinned to every nth rather than allowed to collide. */
      if (ci % labelEvery === 0) {
        const t = sv('text', { class: 'ax-label', x: padL + band * ci + band / 2, y: H - 10, 'text-anchor': 'middle' });
        t.textContent = cat; s.append(t);
      }
    });
    return s;
  });
}

/* ------------------------------------------------------------ line chart */
function lineChart(container, { values, labels, fmt = v => fmtNum(v, 2), varName = '--s1', markLo, markHi, title = '' }) {
  chartHost(container, (W) => {
    const H = 180, padL = 52, padR = 14, padT = 14, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const dataLo = Math.min(...values), dataHi = Math.max(...values);
    const pad = (dataHi - dataLo) * 0.08 || 1;
    const nt = niceTicks(dataLo - pad, dataHi + pad, 4);
    const lo = nt.lo, span = (nt.hi - nt.lo) || 1;
    const y = v => padT + ih - ((v - lo) / span) * ih;
    const x = i => padL + (i / (values.length - 1)) * iw;
    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': title || 'Line chart' });

    nt.ticks.forEach(v => {
      s.append(sv('line', { class: 'gridline', x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
      const t = sv('text', { class: 'ax-label', x: padL - 8, y: y(v) + 3.5, 'text-anchor': 'end' });
      t.textContent = fmt(v); s.append(t);
    });
    const dPath = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    /* area wash at ~10% then the 2px line */
    s.append(sv('path', { d: `${dPath} L${x(values.length - 1)},${padT + ih} L${padL},${padT + ih} Z`, fill: `var(${varName})`, opacity: .10 }));
    s.append(sv('path', { d: dPath, fill: 'none', stroke: `var(${varName})`, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    s.append(sv('circle', { cx: x(values.length - 1), cy: y(last(values)), r: 4.5, fill: `var(${varName})`, stroke: 'var(--surface)', 'stroke-width': 2 }));

    /* direct label on the endpoint only */
    const lbl = sv('text', { class: 'dl', x: x(values.length - 1) - 6, y: y(last(values)) - 10, 'text-anchor': 'end' });
    lbl.textContent = fmt(last(values)); s.append(lbl);

    if (isNum(markLo)) { const t = sv('text', { class: 'ax-label', x: padL, y: H - 8 }); t.textContent = labels?.[0] ?? ''; s.append(t); }
    if (labels) { const t = sv('text', { class: 'ax-label', x: W - padR, y: H - 8, 'text-anchor': 'end' }); t.textContent = last(labels); s.append(t); }

    /* crosshair + tooltip across the whole plot */
    const cross = sv('line', { class: 'ax-line', y1: padT, y2: padT + ih, opacity: 0 });
    const dot = sv('circle', { r: 4, fill: `var(${varName})`, stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 });
    s.append(cross, dot);
    const hit = sv('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent' });
    hit.style.cursor = 'crosshair';
    hit.addEventListener('pointermove', e => {
      const box = s.getBoundingClientRect();
      const rel = (e.clientX - box.left) / box.width * W;
      const i = clamp(Math.round((rel - padL) / iw * (values.length - 1)), 0, values.length - 1);
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', .5);
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i])); dot.setAttribute('opacity', 1);
      showTip(`<div class="t-title">${esc(labels?.[i] ?? `Point ${i + 1}`)}</div><div class="t-row"><span>Value</span><b>${fmt(values[i])}</b></div>`, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); hideTip(); });
    s.append(hit);
    return s;
  });
}

/* ----------------------------------------------------------- scatter plot */
/* Colour is either 2 categorical slots (market) or a 3-step ordinal ramp
   (risk band) — never 8 slots, which cannot clear the all-pairs CVD gate. */
function scatterChart(container, { points, xLabel, xLabelShort, yLabel, yLabelShort, xFmt, onPick }) {
  chartHost(container, (W) => {
    const narrow = W < 560;
    const H = narrow ? 320 : Math.max(340, Math.min(480, W * 0.52));
    const padL = narrow ? 40 : 56, padR = narrow ? 12 : 20, padT = 18, padB = 46;
    const iw = W - padL - padR, ih = H - padT - padB;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xlo = Math.min(-40, Math.floor(Math.min(...xs) / 10) * 10), xhi = Math.max(40, Math.ceil(Math.max(...xs) / 10) * 10);
    const ylo = 0, yhi = 100;
    const X = v => padL + (v - xlo) / (xhi - xlo) * iw;
    const Y = v => padT + ih - (v - ylo) / (yhi - ylo) * ih;
    const maxCap = Math.max(...points.map(p => p.size));
    const R = v => (narrow ? 3.5 : 5) + Math.sqrt(v / maxCap) * (narrow ? 11 : 20);

    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': 'Valuation against quality, one mark per company' });

    for (let i = 0; i <= 4; i++) {
      const v = ylo + (yhi - ylo) * i / 4;
      s.append(sv('line', { class: 'gridline', x1: padL, x2: W - padR, y1: Y(v), y2: Y(v) }));
      const t = sv('text', { class: 'ax-label', x: padL - 8, y: Y(v) + 3.5, 'text-anchor': 'end' });
      t.textContent = v; s.append(t);
    }
    const xticks = [];
    for (let v = xlo; v <= xhi; v += (xhi - xlo) / 4) xticks.push(v);
    xticks.forEach(v => {
      s.append(sv('line', { class: 'gridline', x1: X(v), x2: X(v), y1: padT, y2: padT + ih }));
      const t = sv('text', { class: 'ax-label', x: X(v), y: H - 26, 'text-anchor': 'middle' });
      t.textContent = xFmt(v); s.append(t);
    });
    /* fair-value line at zero discount */
    s.append(sv('line', { class: 'ax-line', x1: X(0), x2: X(0), y1: padT, y2: padT + ih, 'stroke-width': 1.5 }));
    const zl = sv('text', { class: 'ax-label', x: X(0), y: padT - 5, 'text-anchor': 'middle', 'font-weight': 600 });
    zl.textContent = 'Base-case model estimate'; s.append(zl);

    /* Long captions do not wrap in SVG, so a narrow chart takes the short form
       rather than letting the text run past the plot. */
    const ax = sv('text', { class: 'ax-label', x: padL + iw / 2, y: H - 8, 'text-anchor': 'middle', 'font-weight': 600 });
    ax.textContent = narrow ? (xLabelShort || xLabel) : xLabel; s.append(ax);
    const ay = sv('text', { class: 'ax-label', x: 12, y: padT + ih / 2, 'text-anchor': 'middle', 'font-weight': 600, transform: `rotate(-90 12 ${padT + ih / 2})` });
    ay.textContent = narrow ? (yLabelShort || yLabel) : yLabel; s.append(ay);

    /* larger marks behind smaller ones so nothing is unreachable */
    [...points].sort((a, b) => b.size - a.size).forEach(p => {
      const g = sv('g', { style: 'cursor:pointer' });
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${p.label}, ${xFmt(p.x)} to base-case model estimate, quality percentile ${p.y}`);
      const fill = `var(${p.varName})`;
      g.append(sv('circle', { cx: X(p.x), cy: Y(p.y), r: R(p.size), fill, opacity: .30 }));
      /* 2px surface ring keeps overlapping marks legible */
      g.append(sv('circle', { cx: X(p.x), cy: Y(p.y), r: R(p.size), fill: 'none', stroke: fill, 'stroke-width': 1.5 }));
      g.append(sv('circle', { cx: X(p.x), cy: Y(p.y), r: 3.2, fill, stroke: 'var(--surface)', 'stroke-width': 2 }));
      /* hit target never smaller than ~24px */
      const hit = sv('circle', { cx: X(p.x), cy: Y(p.y), r: Math.max(13, R(p.size)), fill: 'transparent' });
      const tip = () => `<div class="t-title">${esc(p.label)} · ${esc(p.name)}</div>
        <div class="t-row"><span>vs base-case model estimate</span><b>${xFmt(p.x)}</b></div>
        <div class="t-row"><span>Quality percentile</span><b>${p.y}</b></div>
        <div class="t-row"><span>Market cap</span><b>${p.capLabel}</b></div>
        <div class="t-row"><span>Model</span><b>${esc(p.model)}</b></div>
        <div class="t-note">${esc(p.conf)} confidence · click to open the valuation</div>`;
      const show = e => showTip(tip(), e.clientX ?? (window.innerWidth / 2), e.clientY ?? 200);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('click', () => onPick(p.id));
      g.addEventListener('focus', () => { const b = g.getBoundingClientRect(); showTip(tip(), b.left + b.width / 2, b.top + b.height / 2); });
      g.addEventListener('blur', hideTip);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.id); } });
      g.append(hit);
      s.append(g);
    });

    /* Selective direct labels: the three largest discounts among quality names.
       Labels are pushed below the mark when they would collide with the top
       annotation. On a narrow chart they are dropped entirely — converging
       labels read as noise, and the legend, tooltip and table view still carry
       the identity. */
    (narrow ? [] : [...points].filter(p => p.y >= 45).sort((a, b) => b.x - a.x).slice(0, 3)).forEach(p => {
      const above = Y(p.y) - R(p.size) - 6;
      const flip = above < padT + 12;
      const t = sv('text', { class: 'dl', x: X(p.x), y: flip ? Y(p.y) + R(p.size) + 13 : above, 'text-anchor': 'middle' });
      t.textContent = p.label;
      s.append(t);
    });
    return s;
  });
}

/* -------------------------------------------------------------- treemap */
/* Squarified layout; fill is a diverging ramp on the signed change value. */
function squarify(items, x, y, w, h) {
  const out = [];
  const total = sum(items.map(i => i.value));
  if (total <= 0) return out;
  let rest = items.map(i => ({ ...i, area: i.value / total * w * h }));
  let cx = x, cy = y, cw = w, ch = h;

  const worst = (row, side) => {
    const s = sum(row.map(r => r.area));
    const mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };

  while (rest.length) {
    const vertical = cw >= ch;
    const side = vertical ? ch : cw;
    let row = [rest[0]], i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
    const rowArea = sum(row.map(r => r.area));
    const thick = rowArea / side;
    let off = 0;
    row.forEach(r => {
      const len = r.area / thick;
      out.push(vertical
        ? { ...r, x: cx, y: cy + off, w: thick, h: len }
        : { ...r, x: cx + off, y: cy, w: len, h: thick });
      off += len;
    });
    if (vertical) { cx += thick; cw -= thick; } else { cy += thick; ch -= thick; }
    rest = rest.slice(row.length);
    if (cw < 0.5 || ch < 0.5) break;
  }
  return out;
}

function treemap(container, { items, valueFmt, onPick, full = 8 }) {
  chartHost(container, (W) => {
    const H = Math.max(320, Math.min(520, W * 0.5));
    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': 'Market heatmap, tile area is market capitalisation' });
    const laid = squarify([...items].sort((a, b) => b.value - a.value), 0, 0, W, H);
    const GAP = 2;                                   /* surface gap, not a border */
    laid.forEach(t => {
      const w = Math.max(0, t.w - GAP), h = Math.max(0, t.h - GAP);
      if (w < 2 || h < 2) return;
      const fillVar = divergingVar(t.change, full);
      const fill = cssVar(fillVar) || '#888';
      const g = sv('g', { style: 'cursor:pointer' });
      g.append(sv('rect', { x: t.x + GAP / 2, y: t.y + GAP / 2, width: w, height: h, rx: Math.min(6, w / 6, h / 6), fill }));
      const ink = inkOn(fill);
      /* only label when the text fits with padding — never clip */
      if (w > 52 && h > 30) {
        const a = sv('text', { x: t.x + GAP / 2 + 7, y: t.y + GAP / 2 + 17, fill: ink, 'font-size': Math.min(13, w / 4.6), 'font-weight': 640 });
        a.textContent = t.label; g.append(a);
        if (h > 46) {
          const b = sv('text', { x: t.x + GAP / 2 + 7, y: t.y + GAP / 2 + 33, fill: ink, 'font-size': Math.min(12, w / 5.6), opacity: .85, 'font-variant-numeric': 'tabular-nums' });
          b.textContent = valueFmt(t.change); g.append(b);
        }
      }
      const hit = sv('rect', { x: t.x, y: t.y, width: t.w, height: t.h, fill: 'transparent' });
      hit.addEventListener('pointermove', e => showTip(
        `<div class="t-title">${esc(t.label)} · ${esc(t.name)}</div>
         <div class="t-row"><span>${esc(t.metricLabel)}</span><b>${valueFmt(t.change)}</b></div>
         <div class="t-row"><span>Market cap</span><b>${esc(t.capLabel)}</b></div>
         <div class="t-note">Click for the "Why moved?" attribution</div>`, e.clientX, e.clientY));
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('click', () => onPick(t.id));
      g.append(hit);
      s.append(g);
    });
    return s;
  });
}

/* ----------------------------------------------------- sensitivity matrix */
function matrixChart(container, { grid, xSteps, ySteps, xLabel, yLabel, base, price, fmt }) {
  chartHost(container, (W) => {
    const cellW = Math.max(56, Math.min(110, (W - 96) / xSteps.length));
    const cellH = 40, padL = 92, padT = 42;
    const H = padT + ySteps.length * cellH + 14;
    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': 'Sensitivity of value per share to two assumptions' });

    const xt = sv('text', { class: 'ax-label', x: padL + xSteps.length * cellW / 2, y: 13, 'text-anchor': 'middle', 'font-weight': 600 });
    xt.textContent = xLabel; s.append(xt);
    const yt = sv('text', { class: 'ax-label', x: 12, y: padT + ySteps.length * cellH / 2, 'text-anchor': 'middle', 'font-weight': 600, transform: `rotate(-90 12 ${padT + ySteps.length * cellH / 2})` });
    yt.textContent = yLabel; s.append(yt);

    xSteps.forEach((v, i) => {
      const t = sv('text', { class: 'ax-label', x: padL + i * cellW + cellW / 2, y: padT - 10, 'text-anchor': 'middle' });
      t.textContent = v; s.append(t);
    });
    grid.forEach((row, r) => {
      const t = sv('text', { class: 'ax-label', x: padL - 8, y: padT + r * cellH + cellH / 2 + 4, 'text-anchor': 'end' });
      t.textContent = ySteps[r]; s.append(t);
      row.forEach((val, cIdx) => {
        const x = padL + cIdx * cellW, y = padT + r * cellH;
        const upside = isNum(val) ? (val - price) / price * 100 : null;
        const fillVar = divergingVar(upside, 45);
        const fill = isNum(val) ? cssVar(fillVar) : cssVar('--surface-sunk');
        const g = sv('g');
        g.append(sv('rect', { x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2, rx: 5, fill }));
        const ink = isNum(val) ? inkOn(fill) : cssVar('--ink-3');
        const isBase = r === Math.floor(ySteps.length / 2) && cIdx === Math.floor(xSteps.length / 2);
        if (isBase) g.append(sv('rect', { x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2, rx: 5, fill: 'none', stroke: cssVar('--ink'), 'stroke-width': 2 }));
        /* every cell carries its value, so colour is never the only channel */
        const t2 = sv('text', { x: x + cellW / 2, y: y + cellH / 2 + 4, 'text-anchor': 'middle', fill: ink, 'font-size': 11.5, 'font-weight': isBase ? 700 : 560, 'font-variant-numeric': 'tabular-nums' });
        t2.textContent = isNum(val) ? fmt(val) : 'n/a';
        g.append(t2);
        const hit = sv('rect', { x, y, width: cellW, height: cellH, fill: 'transparent' });
        hit.addEventListener('pointermove', e => showTip(
          `<div class="t-title">${fmt(val)} per share</div>
           <div class="t-row"><span>${esc(xLabel)}</span><b>${xSteps[cIdx]}</b></div>
           <div class="t-row"><span>${esc(yLabel)}</span><b>${ySteps[r]}</b></div>
           <div class="t-row"><span>vs market price</span><b>${withSign(upside)}</b></div>`, e.clientX, e.clientY));
        hit.addEventListener('pointerleave', hideTip);
        g.append(hit);
        s.append(g);
      });
    });
    return s;
  });
}

/* -------------------------------------------------- driver impact (tornado) */
function tornadoChart(container, { drivers, fmt = v => withSign(v) }) {
  chartHost(container, (W) => {
    const rowH = 34, padL = Math.min(190, W * 0.38), padR = 46, padT = 8;
    const H = padT + drivers.length * rowH + 8;
    const iw = W - padL - padR, cx = padL + iw / 2;
    const max = Math.max(...drivers.map(d => d.span), 1);
    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': 'Change in value per share for a step in each assumption' });
    s.append(sv('line', { class: 'ax-line', x1: cx, x2: cx, y1: padT, y2: H - 8 }));

    drivers.forEach((d, i) => {
      const y = padT + i * rowH + 7;
      const h = 16, r = 4;
      const bar = (v, varName) => {
        if (!isNum(v) || Math.abs(v) < 0.01) return;
        const len = Math.abs(v) / max * (iw / 2 - 4);
        const x = v >= 0 ? cx + 2 : cx - 2 - len;
        const rr = Math.min(r, len / 2);
        const path = v >= 0
          ? `M${x},${y} L${x + len - rr},${y} Q${x + len},${y} ${x + len},${y + rr} L${x + len},${y + h - rr} Q${x + len},${y + h} ${x + len - rr},${y + h} L${x},${y + h} Z`
          : `M${x + len},${y} L${x + rr},${y} Q${x},${y} ${x},${y + rr} L${x},${y + h - rr} Q${x},${y + h} ${x + rr},${y + h} L${x + len},${y + h} Z`;
        s.append(sv('path', { d: path, fill: `var(${varName})`, opacity: .9 }));
      };
      bar(d.hi, d.hi >= 0 ? '--up-4' : '--dn-4');
      bar(d.lo, d.lo >= 0 ? '--up-4' : '--dn-4');

      const lbl = sv('text', { class: 'ax-label', x: padL - 12, y: y + 12, 'text-anchor': 'end', fill: cssVar('--ink-2'), 'font-size': 11.5 });
      lbl.textContent = d.label; s.append(lbl);
      const val = sv('text', { class: 'ax-label', x: W - 8, y: y + 12, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 600 });
      val.textContent = `±${fmtNum(d.span, 1)}%`; s.append(val);

      const hit = sv('rect', { x: 0, y: y - 6, width: W, height: rowH - 2, fill: 'transparent' });
      hit.addEventListener('pointermove', e => showTip(
        `<div class="t-title">${esc(d.label)}</div>
         <div class="t-row"><span>+${d.unit === 'pp' ? fmtNum(d.step, 2) + ' pp' : d.unit}</span><b>${fmt(d.hi)}</b></div>
         <div class="t-row"><span>−${d.unit === 'pp' ? fmtNum(d.step, 2) + ' pp' : d.unit}</span><b>${fmt(d.lo)}</b></div>
         <div class="t-note">Change in base-case model estimate per share</div>`, e.clientX, e.clientY));
      hit.addEventListener('pointerleave', hideTip);
      s.append(hit);
    });
    return s;
  });
}

/* ------------------------------------------------------------- waterfall */
function waterfallChart(container, { steps, fmt, ccy }) {
  chartHost(container, (W) => {
    const H = 230, padL = 58, padR = 14, padT = 18, padB = 44;
    const iw = W - padL - padR, ih = H - padT - padB;
    let run = 0; const marks = [];
    steps.forEach(st => {
      if (st.total) { marks.push({ ...st, from: 0, to: st.value }); run = st.value; }
      else { marks.push({ ...st, from: run, to: run + st.value }); run += st.value; }
    });
    const allV = marks.flatMap(m => [m.from, m.to]);
    const nt = niceTicks(Math.min(...allV, 0), Math.max(...allV, 0) * 1.1, 4);
    const y = v => padT + ih - ((v - nt.lo) / ((nt.hi - nt.lo) || 1)) * ih;
    const band = iw / marks.length, barW = Math.min(24, band - 16);
    const s = sv('svg', { class: 'chart chart-focusable', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': 'Composition of the base-case model estimate per share' });

    nt.ticks.forEach(v => {
      s.append(sv('line', { class: 'gridline', x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
      const t = sv('text', { class: 'ax-label', x: padL - 8, y: y(v) + 3.5, 'text-anchor': 'end' });
      t.textContent = fmt(v); s.append(t);
    });
    marks.forEach((mk, i) => {
      const x = padL + band * i + (band - barW) / 2;
      const top = Math.min(y(mk.from), y(mk.to)), h = Math.max(2, Math.abs(y(mk.to) - y(mk.from)));
      const varName = mk.total ? '--s3' : (mk.value >= 0 ? '--up-4' : '--dn-4');
      const r = Math.min(4, h / 2, barW / 2);
      s.append(sv('path', { d: `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${top + h} Z`,
        fill: `var(${varName})`, opacity: .92 }));
      if (i < marks.length - 1) s.append(sv('line', { x1: x + barW, x2: padL + band * (i + 1) + (band - barW) / 2, y1: y(mk.to), y2: y(mk.to), stroke: cssVar('--line-2'), 'stroke-width': 1 }));
      const lab = sv('text', { class: 'ax-label', x: x + barW / 2, y: H - 26, 'text-anchor': 'middle' });
      lab.textContent = mk.short; s.append(lab);
      const v2 = sv('text', { class: 'dl', x: x + barW / 2, y: top - 6, 'text-anchor': 'middle', 'font-size': 10.5 });
      v2.textContent = fmt(mk.total ? mk.to : mk.value); s.append(v2);
      const hit = sv('rect', { x: padL + band * i, y: padT, width: band, height: ih, fill: 'transparent' });
      hit.addEventListener('pointermove', e => showTip(`<div class="t-title">${esc(mk.label)}</div><div class="t-row"><span>${mk.total ? 'Value' : 'Contribution'}</span><b>${fmt(mk.total ? mk.to : mk.value)}</b></div>`, e.clientX, e.clientY));
      hit.addEventListener('pointerleave', hideTip);
      s.append(hit);
    });
    return s;
  });
}

/* ------------------------------------------------------ value range strip */
function rangeStrip(bear, base, bull, price, ccy) {
  /* A company can have a modelled value and no price. Plotting a marker at
     zero would invent a comparison that was never made. */
  const hasPx = isNum(price);
  const lo = (hasPx ? Math.min(bear, price) : bear) * 0.94;
  const hi = (hasPx ? Math.max(bull, price) : bull) * 1.06;
  const at = v => clamp((v - lo) / (hi - lo) * 100, 0, 100);

  /* Keep a label inside the strip instead of letting it hang off either end. */
  const anchor = (pct) => pct > 88 ? 'translateX(-100%)' : pct < 12 ? 'translateX(0)' : 'translateX(-50%)';

  /* When the price sits far outside the modelled range — a business trading at
     a large premium or discount to its own model — the scale has to span both,
     which squeezes bear/base/bull into a sliver and collides their three
     labels into unreadable overlap. Rather than distort the scale, which is the
     one thing the strip exists to show honestly, collapse the three labels into
     one line placed under the compressed range. */
  const spread = at(bull) - at(bear);
  const tight = spread < 24;
  const mid = (at(bear) + at(bull)) / 2;

  const labels = tight
    ? [el('div', { class: 'metaline', style: `position:absolute;left:${clamp(mid, 0, 100)}%;top:36px;transform:${anchor(mid)};white-space:nowrap` },
        `Bear ${fmtMoney(bear, ccy)} · Base ${fmtMoney(base, ccy)} · Bull ${fmtMoney(bull, ccy)}`)]
    : [
        el('div', { class: 'metaline', style: `position:absolute;left:${at(bear)}%;top:36px;transform:${anchor(at(bear))}` }, `Bear ${fmtMoney(bear, ccy)}`),
        el('div', { class: 'metaline', style: `position:absolute;left:${at(bull)}%;top:36px;transform:${anchor(at(bull))}` }, `Bull ${fmtMoney(bull, ccy)}`),
        el('div', { class: 'metaline', style: `position:absolute;left:${at(base)}%;top:36px;transform:${anchor(at(base))};color:var(--ink);font-weight:600;white-space:nowrap` }, `Base ${fmtMoney(base, ccy)}`),
      ];

  return el('div', { style: 'position:relative;height:56px;margin-top:var(--xs)' }, [
    /* A minimum width so the range stays visible as a bar rather than becoming
       a dot when the price dwarfs it. */
    /* A neutral ramp, not red-to-green. The green end was the higher valuation,
       so a price sitting there was rendered in the colour of a good outcome
       while actually meaning expensive — the opposite of what a reader would
       take from it. Lightness alone carries the bear-to-bull direction. */
    el('div', { style: `position:absolute;left:${at(bear)}%;width:${Math.max(spread, 3)}%;top:22px;height:8px;border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb, var(--s3) 22%, transparent),color-mix(in srgb, var(--s3) 55%, transparent))` }),
    el('div', { style: `position:absolute;left:${at(base)}%;top:16px;width:2px;height:20px;background:var(--ink);transform:translateX(-1px)` }),
    hasPx ? el('div', { style: `position:absolute;left:${at(price)}%;top:10px;transform:translateX(-50%)`, class: 'row', html:
      `<span style="display:block;width:12px;height:12px;border-radius:50%;background:var(--s2);border:2px solid var(--surface);box-shadow:0 0 0 1px var(--line-2)"></span>` }) : null,
    ...labels,
    hasPx ? el('div', { class: 'metaline', style: `position:absolute;left:${at(price)}%;top:0;transform:${anchor(at(price))};color:var(--s2-text);font-weight:600;white-space:nowrap` }, `Price ${fmtMoney(price, ccy)}`) : null,
  ]);
}

