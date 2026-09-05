// Shared holdings storage for Paper Ledger / Live Ledger.
// Source of truth is the Cloudflare Worker (backed by KV), so the same
// portfolio shows up on any browser or device. A local cache is kept only
// so the page still shows something useful if the Worker is briefly
// unreachable; it is never the source of truth once the network is back.
(function (global) {
  "use strict";

  var API_BASE = "https://paper-ledger-quotes.siddsapa.workers.dev";
  var CACHE_KEY = "paperLedgerCache_v1";

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(holdings) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(holdings));
    } catch (e) {}
  }

  function load() {
    return fetch(API_BASE + "/holdings")
      .then(function (r) {
        if (!r.ok) throw new Error("bad_status");
        return r.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error("bad_shape");
        writeCache(data);
        return { holdings: data, synced: true };
      })
      .catch(function () {
        var cached = readCache();
        return { holdings: cached || [], synced: false };
      });
  }

  function save(holdings) {
    var slim = holdings.map(function (h) {
      return {
        id: h.id, ticker: h.ticker, shares: h.shares, buyPrice: h.buyPrice,
        currentPrice: h.currentPrice, priceSource: h.priceSource, priceAsOf: h.priceAsOf
      };
    });
    writeCache(slim);
    return fetch(API_BASE + "/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slim)
    })
      .then(function (r) { return { synced: r.ok }; })
      .catch(function () { return { synced: false }; });
  }

  global.LedgerStorage = { load: load, save: save };
})(window);
