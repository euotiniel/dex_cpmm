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
  priceHistory: {},
  initialPrices: {},
  volume: {},
  traderStats: {},
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

  for (const trader of traders) {
    const key = trader.address.toLowerCase();
    if (!state.traderStats[key]) {
      state.traderStats[key] = {
        trader: trader.address,
        name: trader.name,
        totalTrades: 0,
        buys: 0,
        sells: 0,
        volume: 0,
        lastTradeAt: null,
      };
    } else {
      state.traderStats[key].name = trader.name;
    }
  }

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
    if (state.initialPrices[key] === undefined) {
      state.initialPrices[key] = poolData.spotPrice;
    }

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
  if (state.trades.length > MAX_TRADES) {
    state.trades = state.trades.slice(0, MAX_TRADES);
  }

  const productKey = trade.productToken.toLowerCase();
  if (!state.volume[productKey]) state.volume[productKey] = 0;

  const volumeValue =
    trade.type === "BUY"
      ? Number(trade.amountIn) || 0
      : Number(trade.amountOut) || 0;

  state.volume[productKey] += volumeValue;

  const traderKey = trade.trader.toLowerCase();

  if (!state.traderStats[traderKey]) {
    state.traderStats[traderKey] = {
      trader: trade.trader,
      name: trade.traderName || trade.trader,
      totalTrades: 0,
      buys: 0,
      sells: 0,
      volume: 0,
      lastTradeAt: null,
    };
  }

  state.traderStats[traderKey].totalTrades += 1;
  state.traderStats[traderKey].volume += volumeValue;
  state.traderStats[traderKey].lastTradeAt = trade.timestamp;

  if (trade.type === "BUY") state.traderStats[traderKey].buys += 1;
  if (trade.type === "SELL") state.traderStats[traderKey].sells += 1;

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