const state = {
  status: {
    competitionStatus: "NOT_STARTED",
    competitionStartTime: 0,
    competitionEndTime: 0
  },

  baseToken: {
    address: null,
    symbol: "CASH",
    decimals: 18
  },

  products: [],

  pools: {},

  trades: [],

  ranking: [],

  lastUpdatedAt: null
};

function setBaseToken(address, symbol = "CASH", decimals = 18) {
  state.baseToken = {
    address,
    symbol,
    decimals
  };
}

function setCompetitionStatus(status) {
  state.status = {
    ...state.status,
    ...status
  };
  state.lastUpdatedAt = Date.now();
}

function setProducts(products) {
  state.products = products;
  state.lastUpdatedAt = Date.now();
}

function upsertPool(productAddress, poolData) {
  state.pools[productAddress.toLowerCase()] = {
    ...(state.pools[productAddress.toLowerCase()] || {}),
    ...poolData
  };
  state.lastUpdatedAt = Date.now();
}

function addTrade(trade) {
  state.trades.unshift(trade);

  if (state.trades.length > 200) {
    state.trades = state.trades.slice(0, 200);
  }

  state.lastUpdatedAt = Date.now();
}

function setRanking(ranking) {
  state.ranking = ranking;
  state.lastUpdatedAt = Date.now();
}

function getState() {
  return state;
}

module.exports = {
  state,
  setBaseToken,
  setCompetitionStatus,
  setProducts,
  upsertPool,
  addTrade,
  setRanking,
  getState
};