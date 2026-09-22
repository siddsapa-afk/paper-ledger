// Shared holdings + sales storage for Paper Ledger / Live Ledger.
// Source of truth is the Cloudflare Worker (backed by KV), so the same
// portfolio shows up on any browser or device. A local cache is kept only
// so the page still shows something useful if the Worker is briefly
// unreachable; it is never the source of truth once the network is back.
(function (global) {
  "use strict";

  var API_BASE = "https://paper-ledger-quotes.siddsapa.workers.dev";
  var CACHE_KEY = "paperLedgerCache_v2";

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function load() {
    return fetch(API_BASE + "/holdings")
      .then(function (r) {
        if (!r.ok) throw new Error("bad_status");
        return r.json();
      })
      .then(function (data) {
        var holdings = Array.isArray(data.holdings) ? data.holdings : [];
        var sales = Array.isArray(data.sales) ? data.sales : [];
        writeCache({ holdings: holdings, sales: sales });
        return { holdings: holdings, sales: sales, synced: true };
      })
      .catch(function () {
        var cached = readCache();
        return {
          holdings: (cached && cached.holdings) || [],
          sales: (cached && cached.sales) || [],
          synced: false
        };
      });
  }

  function save(holdings, sales) {
    var payload = {
      holdings: holdings.map(function (h) {
        return {
          id: h.id, ticker: h.ticker, shares: h.shares, buyPrice: h.buyPrice,
          currentPrice: h.currentPrice, priceSource: h.priceSource, priceAsOf: h.priceAsOf
        };
      }),
      sales: sales.map(function (s) {
        return {
          id: s.id, ticker: s.ticker, shares: s.shares, buyPrice: s.buyPrice,
          sellPrice: s.sellPrice, gain: s.gain, soldAt: s.soldAt
        };
      })
    };
    writeCache(payload);
    return fetch(API_BASE + "/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return { synced: r.ok }; })
      .catch(function () { return { synced: false }; });
  }

  global.LedgerStorage = { load: load, save: save };
})(window);
