import { EventEmitter } from "events";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const PERSISTENCE_FILE = path.join(DATA_DIR, "state.json");

export const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const MAX_TRADES = 500;
const MAX_PRICE_HISTORY = 300;

let _tradesSinceLastSave = 0;

const state = {
  status: {
    competitionStatus: "NOT_STARTED",
    competitionStartTime: 0,
    competitionEndTime: 0,
  },

  tokens: [],
  pools: {},
  referenceToken: {
    address: null,
    symbol: null,
  },

  traders: [],
  traderStats: {},
  trades: [],
  priceHistory: {},
  volume: {},
  ranking: [],
  fairness: null,
  marketSignal: {
    mode: "NEUTRAL",
    targetToken: null,
    targetSymbol: null,
    message: "",
    updatedAt: null,
  },

  externalBots: [],
  lastUpdatedAt: null,

  orchestrator: {
    state: "IDLE",
    nodeRunning: false,
    bots: [],
    deployed: false,
    recentLogs: [],
  },
};

export function loadPersistence() {
  try {
    if (!existsSync(PERSISTENCE_FILE)) return;

    const raw = JSON.parse(readFileSync(PERSISTENCE_FILE, "utf-8"));

    if (Array.isArray(raw.trades)) state.trades = raw.trades.slice(0, MAX_TRADES);
    if (raw.priceHistory && typeof raw.priceHistory === "object") state.priceHistory = raw.priceHistory;
    if (raw.volume && typeof raw.volume === "object") state.volume = raw.volume;
    if (raw.referenceToken) state.referenceToken = raw.referenceToken;
    if (raw.marketSignal) state.marketSignal = raw.marketSignal;

    console.log(`[persistence] Restored ${state.trades.length} trades from disk.`);
  } catch (e) {
    console.warn("[persistence] Failed to load:", e.message);
  }
}

export function savePersistence() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    writeFileSync(
      PERSISTENCE_FILE,
      JSON.stringify({
        trades: state.trades,
        priceHistory: state.priceHistory,
        volume: state.volume,
        referenceToken: state.referenceToken,
        marketSignal: state.marketSignal,
        savedAt: Date.now(),
      }),
      "utf-8"
    );
  } catch (e) {
    console.warn("[persistence] Failed to save:", e.message);
  }
}

export function resetCompetitionData() {
  state.trades = [];
  state.ranking = [];
  state.fairness = null;
  state.volume = {};
  state.priceHistory = {};
  state.traderStats = {};

  for (const trader of state.traders) {
    const key = trader.address.toLowerCase();
    state.traderStats[key] = {
      trader: trader.address,
      name: trader.name,
      totalTrades: 0,
      swaps: 0,
      volume: 0,
      lastTradeAt: null,
    };
  }

  _tradesSinceLastSave = 0;
  savePersistence();

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setOrchestratorState(data) {
  state.orchestrator = { ...state.orchestrator, ...data };
  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setCompetitionStatus(status) {
  state.status = { ...state.status, ...status };
  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setTokens(tokens) {
  state.tokens = tokens;

  if (!state.referenceToken.address && tokens.length > 0) {
    state.referenceToken = {
      address: tokens[0].address,
      symbol: tokens[0].symbol,
    };
  }

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setReferenceToken(token) {
  state.referenceToken = token;
  state.marketSignal = {
    ...state.marketSignal,
    targetToken: token.address,
    targetSymbol: token.symbol,
    updatedAt: Date.now(),
  };

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setMarketSignal(signal) {
  state.marketSignal = {
    ...state.marketSignal,
    ...signal,
    updatedAt: Date.now(),
  };

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function upsertPool(poolId, poolData) {
  const key = String(poolId).toLowerCase();

  state.pools[key] = {
    ...(state.pools[key] || {}),
    ...poolData,
    exists: true,
  };

  const pool = state.pools[key];
  const reserve0 = Number(pool.reserve0 || 0);
  const reserve1 = Number(pool.reserve1 || 0);

  if (reserve0 > 0 && reserve1 > 0) {
    if (!state.priceHistory[key]) state.priceHistory[key] = [];

    const price01 = reserve1 / reserve0;
    const history = state.priceHistory[key];
    const last = history[history.length - 1];

    if (!last || last.p !== price01) {
      history.push({
        t: Date.now(),
        p: price01,
      });

      if (history.length > MAX_PRICE_HISTORY) {
        state.priceHistory[key] = history.slice(-MAX_PRICE_HISTORY);
      }
    }
  }

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
        swaps: 0,
        volume: 0,
        lastTradeAt: null,
      };
    } else {
      state.traderStats[key].name = trader.name;
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

  const poolKey = String(trade.poolId || "").toLowerCase();

  if (!state.volume[poolKey]) state.volume[poolKey] = 0;
  state.volume[poolKey] += Number(trade.amountIn || 0);

  const traderKey = String(trade.trader || "").toLowerCase();

  if (!state.traderStats[traderKey]) {
    state.traderStats[traderKey] = {
      trader: trade.trader,
      name: trade.traderName || trade.trader,
      totalTrades: 0,
      swaps: 0,
      volume: 0,
      lastTradeAt: null,
    };
  }

  state.traderStats[traderKey].totalTrades += 1;
  state.traderStats[traderKey].swaps += 1;
  state.traderStats[traderKey].volume += Number(trade.amountIn || 0);
  state.traderStats[traderKey].lastTradeAt = trade.timestamp;

  _tradesSinceLastSave++;

  if (_tradesSinceLastSave >= 10) {
    _tradesSinceLastSave = 0;
    savePersistence();
  }

  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setRanking(ranking) {
  state.ranking = ranking;
  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function setFairness(data) {
  state.fairness = data;
  state.lastUpdatedAt = Date.now();

  // Não emitir "changed" aqui para evitar loop:
  // changed -> setFairness -> changed -> setFairness...
}

export function setExternalBots(bots) {
  state.externalBots = bots;
  state.lastUpdatedAt = Date.now();
  emitter.emit("changed");
}

export function getState() {
  return state;
}