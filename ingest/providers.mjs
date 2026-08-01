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
