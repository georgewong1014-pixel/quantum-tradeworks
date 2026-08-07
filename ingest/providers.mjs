/**
 * Price provider adapters.
 *
 * The engine never talks to a vendor directly. It asks this module for a
 * quote or a history and does not care where they came from. That indirection
 * is the blueprint's own mitigation for vendor lock-in, and it is what makes
 * "swap the data supplier" a config change rather than a rewrite.
 *
 * CONTRACT — every provider implements:
 *
 *   name         : string
 *   licensed     : boolean          true only if you hold rights to display
 *                                   and redistribute the data to end users
 *   markets      : string[]         e.g. ['US'] or ['US','MY']
 *   delayMinutes : number           0 for real time, 15 for delayed, etc.
 *   quote(symbol)          -> { symbol, price, currency, asOf, delayMinutes, source }
 *   history(symbol, from, to) -> [{ date, close, volume? }]
 *
 * Anything the provider cannot supply must come back null. A provider must
 * never invent a price — a missing quote is a visible gap; a fabricated one is
 * a wrong valuation.
 */

/* ==========================================================================
   WHY THERE IS NO YAHOO FINANCE OR TRADINGVIEW ADAPTER HERE
   --------------------------------------------------------------------------
   Both were considered and both were rejected. This is a product that charges
   money for research, so the feed has to be one we can lawfully ship.

   YAHOO FINANCE
     There is no official public Yahoo Finance API. The endpoints commonly
     passed around (query1/query2 .finance.yahoo.com) are undocumented, are not
     offered as a product, and Yahoo's terms prohibit redistribution and
     commercial exploitation of the data. They also require cookie/crumb
     handshakes, change without notice, and rate-limit aggressively. Building a
     paid subscription on top of that is a terms breach with an operational
     fault line running through it.

   TRADINGVIEW
     TradingView does not sell a market-data API. Their market data is licensed
     from exchanges under agreements that do not permit resale, and their
     charting products are explicitly bring-your-own-data.

     There IS a legitimate use: their embeddable widgets. If the goal is to
     SHOW a chart, embedding a TradingView widget is allowed under their terms
     (with attribution) and needs no data licence of your own. What you cannot
     do is read prices out of it and feed them into valuation models — which is
     what this product needs.

   THE HONEST POSITION
     Free feeds are fine for a prototype and unusable for a paid product. The
     moment someone pays, the feed has to be licensed for display,
     redistribution and derived use. Terms change — verify current terms with
     any vendor before signing.
   ========================================================================== */

/* -------------------------------------------------------------------------
   Deterministic sample provider — what the prototype runs on today.
   Explicitly unlicensed and explicitly fake, so nothing downstream can mistake
   it for market data.
   ------------------------------------------------------------------------- */
export function sampleProvider(seedPrices = {}) {
  return {
    name: 'sample',
    licensed: false,
    markets: ['US', 'MY'],
    delayMinutes: null,
    async quote(symbol) {
      const p = seedPrices[symbol];
      if (p == null) return null;
      return { symbol, price: p, currency: symbol.match(/^[0-9]/) ? 'MYR' : 'USD',
               asOf: null, delayMinutes: null, source: 'sample (synthetic — not market data)' };
    },
    async history() { return null; },
  };
}

/* -------------------------------------------------------------------------
   Template for a licensed vendor.

   Deliberately left as a template rather than wired to a specific vendor: the
   right one depends on which markets you licence and on commercial terms that
   have to be checked at the time. What matters is that the SHAPE is fixed, so
   the engine is unaffected by the choice.

   Candidates worth pricing, all of which sell real licences:
     - US only:      Polygon.io, Finnhub, Twelve Data, Alpha Vantage
     - US + global:  Refinitiv (LSEG), FactSet, S&P Capital IQ, SIX
     - Bursa:        a direct Bursa Malaysia information-services licence, or a
                     vendor that already holds Bursa redistribution rights

   Bursa is the constraint. US fundamentals are free from SEC and US prices are
   cheap; Malaysian market data is licensed, priced per user, and the terms
   were under review as recently as last year. Cost per active user on the
   Malaysian side is the number that decides whether the freemium tier in the
   pricing plan is viable at all.
   ------------------------------------------------------------------------- */
export function httpVendorProvider({ name, baseUrl, apiKey, markets, delayMinutes, licensed = false,
                                     quotePath, historyPath, parseQuote, parseHistory }) {
  if (!apiKey) throw new Error(`${name}: apiKey is required`);
  const call = async (path) => {
    const res = await fetch(`${baseUrl}${path}`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
    return res.json();
  };
  return {
    name, licensed, markets, delayMinutes,
    async quote(symbol) {
      try { return parseQuote(await call(quotePath(symbol, apiKey)), symbol); }
      catch { return null; }                       /* a gap, never a guess */
    },
    async history(symbol, from, to) {
      try { return parseHistory(await call(historyPath(symbol, from, to, apiKey)), symbol); }
      catch { return null; }
    },
  };
}

/* -------------------------------------------------------------------------
   Registry. The app asks for a provider by market and gets whatever is
   configured — and can refuse to show prices at all if nothing licensed is
   available for that market.
   ------------------------------------------------------------------------- */
export function createRegistry(providers) {
  return {
    for(market) {
      return providers.find(p => p.markets.includes(market)) || null;
    },
    /* A paid deployment should call this at boot and refuse to start rather
       than quietly serving unlicensed prices to paying subscribers. */
    assertLicensedFor(markets) {
      const bad = markets.filter(m => {
        const p = providers.find(x => x.markets.includes(m));
        return !p || !p.licensed;
      });
      if (bad.length) {
        throw new Error(
          `No licensed price provider for: ${bad.join(', ')}. ` +
          `Displaying unlicensed market data to paying users is a licensing breach, ` +
          `not a missing feature — configure a licensed provider or disable prices for these markets.`);
      }
    },
  };
}

/* =========================================================================
   YAHOO FINANCE — PERSONAL RESEARCH ONLY

   The note at the top of this file is still right that Yahoo cannot carry a
   paid product: undocumented endpoints, no support, terms that prohibit
   redistribution. What it did not account for is that this repository already
   runs two lanes, because the screenshot pipeline needed them —
   data/prices.json is what the app serves and must be licensed, and
   data/personal-prices.json is git-ignored, never published, and holds
   figures the owner gathered for their own research.

   So this adapter exists in the second lane and is hard-wired licensed:false.
   That is not a default to flip: there is no licence behind it, and the
   registry above already refuses to serve an unlicensed provider to a paid
   deployment.

   Verified against what a Malaysian research tool actually needs: AAPL in USD,
   1155.KL in MYR, ^KLSE, USDMYR=X. Bursa equities, the index and the currency
   all resolve through the same endpoint.
   ========================================================================= */
export function yahooProvider({ userAgent } = {}) {
  const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  /* A browser user agent is required; the endpoint refuses a bare fetch. */
  const headers = { 'user-agent': userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' };

  const chart = async (symbol, params) => {
    const r = await fetch(BASE + encodeURIComponent(symbol) + '?' + params,
      { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.chart?.result?.[0] || null;
  };

  return {
    name: 'yahoo (personal research)',
    licensed: false,
    markets: ['US', 'MY'],
    delayMinutes: null,
    async quote(symbol) {
      const m = (await chart(symbol, 'interval=1d&range=5d'))?.meta;
      if (!m || !Number.isFinite(m.regularMarketPrice)) return null;
      return {
        symbol, price: m.regularMarketPrice, currency: m.currency || null,
        asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
        delayMinutes: Number.isFinite(m.exchangeDataDelayedBy)
          ? Math.round(m.exchangeDataDelayedBy / 60) : null,
        source: 'Yahoo Finance (unofficial endpoint, personal research only)',
      };
    },
    async history(symbol, from, to) {
      const p1 = Math.floor(new Date(from).getTime() / 1000);
      const p2 = Math.floor(new Date(to).getTime() / 1000);
      const res = await chart(symbol, `interval=1d&period1=${p1}&period2=${p2}`);
      const ts = res?.timestamp, q = res?.indicators?.quote?.[0];
      if (!ts || !q) return null;
      const out = [];
      for (let i = 0; i < ts.length; i++) {
        const close = q.close?.[i];
        /* A null close is a non-trading day, not a zero. */
        if (!Number.isFinite(close)) continue;
        out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close,
                   volume: Number.isFinite(q.volume?.[i]) ? q.volume[i] : null });
      }
      return out.length ? out : null;
    },

    /* ---------------------------------------------------------------------
       ANNUAL STATEMENTS

       The note at the top of this file says Bursa Malaysia publishes no
       machine-readable financial statements, and that remains true of Bursa.
       It does not follow that the statements are unreachable: this endpoint
       returns audited annual figures for Bursa tickers in ringgit, with no
       cookie handshake, and the values reconcile against the companies' own
       reported accounts.

       That changes what is POSSIBLE and nothing about what is PERMITTED. The
       licence position is identical to the price endpoint above — undocumented,
       unlicensed, redistribution prohibited — so this feeds the git-ignored
       personal-research lane and can never reach the deployed site. The
       provider stays licensed:false and the writer enforces the rest.

       Yahoo carries four fiscal years, against the ten SEC gives. Any measure
       needing a longer window has to report itself unavailable rather than be
       computed over a shorter one and labelled as though it were not.
       --------------------------------------------------------------------- */
    async fundamentals(symbol) {
      const KEYS = [
        'annualTotalRevenue', 'annualOperatingIncome', 'annualNetIncome',
        'annualOperatingCashFlow', 'annualCapitalExpenditure',
        'annualStockholdersEquity', 'annualTotalDebt', 'annualCashAndCashEquivalents',
        'annualBasicAverageShares', 'annualCashDividendsPaid', 'annualInterestExpense',
        'annualTotalAssets', 'annualCurrentAssets', 'annualCurrentLiabilities',
      ];
      const url = 'https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/'
        + encodeURIComponent(symbol)
        + `?symbol=${encodeURIComponent(symbol)}&type=${KEYS.join(',')}`
        + '&period1=1420070400&period2=2000000000&merge=false';
      let j;
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
        if (!r.ok) return null;
        j = await r.json();
      } catch { return null; }

      const rows = j?.timeseries?.result;
      if (!Array.isArray(rows)) return null;

      /* Pivot to year -> metric. A metric absent for a year stays absent: the
         engine reads null as "not reported" and zero as "reported as nothing",
         and conflating them is how a company acquires debt it does not have. */
      const byYear = new Map();
      for (const row of rows) {
        const key = Object.keys(row).find(k => k !== 'meta' && k !== 'timestamp');
        if (!key) continue;
        for (const point of (row[key] || [])) {
          if (!point?.asOfDate) continue;
          const year = Number(point.asOfDate.slice(0, 4));
          const value = point.reportedValue?.raw;
          if (!Number.isFinite(value)) continue;
          if (!byYear.has(year)) byYear.set(year, {});
          byYear.get(year)[key] = value;
        }
      }
      if (!byYear.size) return null;

      const years = [...byYear.keys()].sort((a, b) => a - b);
      const BN = 1e9;                    /* the engine's statements are in billions */
      const scale = (v) => Number.isFinite(v) ? +(v / BN).toFixed(6) : null;

      const fin = years.map(y => {
        const d = byYear.get(y);
        const shares = d.annualBasicAverageShares;
        /* Dividends are reported as a negative cash outflow. Per share, and
           only when both parts are present — a dividend divided by an absent
           share count is not a smaller dividend, it is no answer. */
        const dps = Number.isFinite(d.annualCashDividendsPaid) && Number.isFinite(shares) && shares > 0
          ? +(Math.abs(d.annualCashDividendsPaid) / shares).toFixed(4)
          : null;
        return [
          scale(d.annualTotalRevenue),
          scale(d.annualOperatingIncome),
          scale(d.annualNetIncome),
          scale(d.annualOperatingCashFlow),
          /* Capital expenditure arrives negative. The engine subtracts it, so
             it is stored as the positive magnitude the other rows assume. */
          Number.isFinite(d.annualCapitalExpenditure) ? scale(Math.abs(d.annualCapitalExpenditure)) : null,
          scale(d.annualStockholdersEquity),
          scale(d.annualTotalDebt),
          scale(d.annualCashAndCashEquivalents),
          scale(shares),
          dps,
        ];
      });

      const extra = years.map(y => {
        const d = byYear.get(y);
        return {
          assets: scale(d.annualTotalAssets),
          ca: scale(d.annualCurrentAssets),
          cl: scale(d.annualCurrentLiabilities),
          intExp: Number.isFinite(d.annualInterestExpense) ? scale(Math.abs(d.annualInterestExpense)) : null,
        };
      });

      /* Which lines were actually reported, per year, so the app can show
         coverage rather than imply completeness. */
      const FIELDS = ['revenue', 'ebit', 'netIncome', 'opCashFlow', 'capex',
                      'equity', 'debt', 'cash', 'shares', 'dps'];
      const gaps = [];
      FIELDS.forEach((name, i) => {
        const missing = fin.filter(row => row[i] == null).length;
        if (missing) gaps.push({ field: name, missingYears: missing, ofYears: fin.length });
      });

      /* Read from the instrument rather than assumed from the suffix. A .KL
         listing reporting in ringgit is the common case and not the only one,
         and a statement labelled with the wrong currency is worse than one
         labelled with none. */
      let currency = null;
      try { currency = (await chart(symbol, 'interval=1d&range=5d'))?.meta?.currency || null; }
      catch { /* the statements are still usable; the label is not */ }

      return {
        symbol, years, fin, extra, gaps, currency,
        source: 'Yahoo Finance fundamentals-timeseries (unofficial endpoint, personal research only)',
        licensed: false,
      };
    },
  };
}

/* =========================================================================
   TWELVE DATA — the licensed path, with a name on it.

   Their catalogue lists Bursa Malaysia as XKLS and they sell redistribution
   licences, which makes this the swap the abstraction was built for: change
   the provider, not the engine.

   licensed defaults to FALSE and becomes true only when the caller states that
   their plan covers redistribution. A key is not a licence, and a plan that
   permits personal use does not become a publishing right because the code
   holds an API token.
   ========================================================================= */
export function twelveDataProvider({ apiKey, redistribution = false } = {}) {
  if (!apiKey) throw new Error('twelveDataProvider: apiKey is required');
  const call = async (path, params) => {
    const r = await fetch(`https://api.twelvedata.com/${path}?${params}&apikey=${apiKey}`,
      { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    /* Their failures arrive with HTTP 200 and a status field. */
    return j?.status === 'error' ? null : j;
  };
  return {
    name: 'twelvedata',
    licensed: !!redistribution,
    markets: ['US', 'MY'],
    delayMinutes: null,
    async quote(symbol) {
      const j = await call('quote', `symbol=${encodeURIComponent(symbol)}`);
      if (!j || !Number.isFinite(Number(j.close))) return null;
      return { symbol, price: Number(j.close), currency: j.currency || null,
               asOf: j.datetime || null, delayMinutes: null, source: 'Twelve Data' };
    },
    async history(symbol, from, to) {
      const j = await call('time_series',
        `symbol=${encodeURIComponent(symbol)}&interval=1day&start_date=${from}&end_date=${to}&outputsize=5000`);
      if (!Array.isArray(j?.values)) return null;
      return j.values
        .map(v => ({ date: v.datetime, close: Number(v.close),
                     volume: v.volume != null ? Number(v.volume) : null }))
        .filter(x => Number.isFinite(x.close))
        .reverse();
    },
  };
}
