import { EventEmitter } from "events";

export const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const MAX_TRADES = 200;
const MAX_PRICE_HISTORY = 200;

const state = {
  status: {
    competitionStatus: "NOT_STARTED",
    competitionStartTime: 0,
    competitionEndTime: 0,
  },
  baseToken: { address: null, symbol: "CASH", decimals: 18 },
  traders: [],
  products: [],
  pools: {},
  priceHistory: {},  // { [address_lc]: [{t: ms, p: float}] }
  initialPrices: {}, // { [address_lc]: float } — price at first observation
  volume: {},        // { [address_lc]: float } — cumulative base CASH traded
  trades: [],
  ranking: [],
  lastUpdatedAt: null,
};

export function setBaseToken(address, symbol = "CASH", decimals = 18) {
  state.baseToken = { address, symbol, decimals };
}

export function setCompetitionStatus(status) {
  state.status = { ...state.status, ...status };
  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setTraders(traders) {
  state.traders = traders;
  state.lastUpdatedAt = Date.now();
}

export function setProducts(products) {
  state.products = products;
  state.lastUpdatedAt = Date.now();
}

export function upsertPool(productAddress, poolData) {
  const key = productAddress.toLowerCase();
  state.pools[key] = { ...(state.pools[key] || {}), ...poolData };

  if (poolData.spotPrice !== undefined && poolData.spotPrice > 0) {
    // Track initial price (only set once)
    if (state.initialPrices[key] === undefined) {
      state.initialPrices[key] = poolData.spotPrice;
    }

    // Append to price history
    if (!state.priceHistory[key]) state.priceHistory[key] = [];
    const history = state.priceHistory[key];
    const last = history[history.length - 1];
    if (!last || last.p !== poolData.spotPrice) {
      history.push({ t: Date.now(), p: poolData.spotPrice });
      if (history.length > MAX_PRICE_HISTORY) {
        state.priceHistory[key] = history.slice(-MAX_PRICE_HISTORY);
      }
    }
  }

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function addTrade(trade) {
  state.trades.unshift(trade);
  if (state.trades.length > MAX_TRADES) state.trades = state.trades.slice(0, MAX_TRADES);

  // Update per-product volume (base CASH in for buys, base CASH out for sells)
  const key = trade.productToken.toLowerCase();
  if (!state.volume[key]) state.volume[key] = 0;
  if (trade.type === "BUY") {
    state.volume[key] += Number(trade.amountIn) || 0;
  } else {
    state.volume[key] += Number(trade.amountOut) || 0;
  }

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setRanking(ranking) {
  state.ranking = ranking;
  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function getState() {
  return state;
}
