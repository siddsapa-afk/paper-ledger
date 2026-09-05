const ALLOWED_ORIGIN = "https://siddsapa-afk.github.io";
const SYMBOL_RE = /^[A-Z.]{1,10}$/;
const HOLDINGS_KEY = "holdings";
const MAX_HOLDINGS = 50;

const DEFAULT_HOLDINGS = [
  { id: "seed-aapl", ticker: "AAPL", shares: 5, buyPrice: 150, currentPrice: 150 },
  { id: "seed-voo", ticker: "VOO", shares: 3, buyPrice: 410, currentPrice: 410 },
];

function corsHeaders(origin) {
  const allow = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

function cleanString(v, maxLen) {
  return typeof v === "string" ? v.slice(0, maxLen) : "";
}

function cleanNumber(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) ? n : null;
}

// Trusts nothing from the client: coerces every field to a safe shape and
// drops anything unrecognized, rather than storing arbitrary attacker JSON.
function sanitizeHoldings(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const raw of input.slice(0, MAX_HOLDINGS)) {
    if (!raw || typeof raw !== "object") continue;
    const ticker = cleanString(raw.ticker, 10).trim().toUpperCase();
    const shares = cleanNumber(raw.shares);
    const buyPrice = cleanNumber(raw.buyPrice);
    const currentPrice = cleanNumber(raw.currentPrice);
    if (!ticker || shares === null || shares <= 0 || buyPrice === null || buyPrice < 0 || currentPrice === null || currentPrice < 0) {
      continue;
    }
    const entry = {
      id: cleanString(raw.id, 40) || crypto.randomUUID(),
      ticker,
      shares,
      buyPrice,
      currentPrice,
    };
    if (raw.priceSource === "manual" || raw.priceSource === "live") entry.priceSource = raw.priceSource;
    if (raw.priceAsOf) entry.priceAsOf = cleanString(raw.priceAsOf, 60);
    out.push(entry);
  }
  return out;
}

async function handleGetHoldings(env, origin) {
  let stored = await env.HOLDINGS.get(HOLDINGS_KEY, { type: "json" });
  if (stored === null) {
    stored = DEFAULT_HOLDINGS;
    await env.HOLDINGS.put(HOLDINGS_KEY, JSON.stringify(stored));
  }
  return json(stored, 200, origin);
}

async function handlePostHoldings(request, env, origin) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > 50000) {
    return json({ error: "payload_too_large" }, 413, origin);
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400, origin);
  }
  const clean = sanitizeHoldings(body);
  if (clean === null) {
    return json({ error: "invalid_shape" }, 400, origin);
  }
  await env.HOLDINGS.put(HOLDINGS_KEY, JSON.stringify(clean));
  return json({ ok: true, count: clean.length }, 200, origin);
}

async function handlePrice(url, env, origin) {
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return json({ error: "invalid_symbol" }, 400, origin);
  }

  let alpacaResp;
  try {
    alpacaResp = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=iex`,
      {
        headers: {
          "APCA-API-KEY-ID": env.APCA_API_KEY_ID,
          "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY,
        },
      }
    );
  } catch (e) {
    return json({ error: "upstream_unreachable" }, 502, origin);
  }

  if (alpacaResp.status === 404) {
    return json({ error: "unknown_symbol", symbol }, 404, origin);
  }
  if (!alpacaResp.ok) {
    return json({ error: "upstream_error", status: alpacaResp.status }, 502, origin);
  }

  const data = await alpacaResp.json();
  const trade = data.latestTrade;
  if (!trade || typeof trade.p !== "number") {
    return json({ error: "no_trade_data", symbol }, 502, origin);
  }

  return json(
    {
      symbol,
      price: trade.p,
      asOf: trade.t,
      prevClose: data.prevDailyBar ? data.prevDailyBar.c : null,
      feed: "iex",
    },
    200,
    origin
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname === "/price" && request.method === "GET") {
      return handlePrice(url, env, origin);
    }
    if (url.pathname === "/holdings" && request.method === "GET") {
      return handleGetHoldings(env, origin);
    }
    if (url.pathname === "/holdings" && request.method === "POST") {
      return handlePostHoldings(request, env, origin);
    }

    return json({ error: "not_found" }, 404, origin);
  },
};
