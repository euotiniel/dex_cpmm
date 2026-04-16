const { ethers } = require("ethers");
const {
  setBaseToken,
  setCompetitionStatus,
  setTraders,
  setProducts,
  upsertPool,
  addTrade,
  setRanking,
  getState
} = require("./state");
const { formatUnitsSafe, calculateRanking } = require("./ranking");

const EXCHANGE_ABI = [
  "function baseToken() view returns (address)",
  "function getProductTokens() view returns (address[] memory)",
  "function getPool(address productToken) view returns (bool exists, address token, uint256 reserveBase, uint256 reserveProduct)",
  "function getSpotPrice(address productToken) view returns (uint256 priceInBase)",
  "function getCompetitionStatus() view returns (uint8 status, uint256 startTime, uint256 endTime)",
  "function traderCount() view returns (uint256)",
  "function isTrader(address) view returns (bool)",
  "event Bought(address indexed trader, address indexed productToken, uint256 baseAmountIn, uint256 productAmountOut, uint256 newReserveBase, uint256 newReserveProduct)",
  "event Sold(address indexed trader, address indexed productToken, uint256 productAmountIn, uint256 baseAmountOut, uint256 newReserveBase, uint256 newReserveProduct)",
  "event CompetitionStarted(uint256 indexed startTime, uint256 indexed endTime, uint256 durationSeconds)",
  "event CompetitionEnded(uint256 indexed endTime)"
];

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)"
];

let provider;
let exchange;
let baseToken;
let productContracts = {};
let trackedTraders = [];
let traderMetaMap = {};

function mapCompetitionStatus(statusNumber) {
  if (statusNumber === 0) return "NOT_STARTED";
  if (statusNumber === 1) return "ACTIVE";
  if (statusNumber === 2) return "ENDED";
  return "UNKNOWN";
}

function getTokenContract(address) {
  const key = address.toLowerCase();

  if (!productContracts[key]) {
    productContracts[key] = new ethers.Contract(address, TOKEN_ABI, provider);
  }

  return productContracts[key];
}

async function initBlockchain() {
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  exchange = new ethers.Contract(
    process.env.EXCHANGE_ADDRESS,
    EXCHANGE_ABI,
    provider
  );

  const baseTokenAddress = await exchange.baseToken();
  baseToken = new ethers.Contract(baseTokenAddress, TOKEN_ABI, provider);

  const baseSymbol = await baseToken.symbol();
  const baseDecimals = await baseToken.decimals();

  setBaseToken(baseTokenAddress, baseSymbol, Number(baseDecimals));
  setTraders(
    trackedTraders.map((address) => ({
      address,
      name: traderMetaMap[address.toLowerCase()]?.name || address
    }))
  );

  await refreshCompetitionStatus();
  await refreshProductsAndPools();

  registerEventListeners();

  return {
    provider,
    exchange,
    baseToken
  };
}

async function refreshCompetitionStatus() {
  const [statusRaw, startTimeRaw, endTimeRaw] = await exchange.getCompetitionStatus();

  setCompetitionStatus({
    competitionStatus: mapCompetitionStatus(Number(statusRaw)),
    competitionStartTime: Number(startTimeRaw),
    competitionEndTime: Number(endTimeRaw)
  });
}

async function refreshProductsAndPools() {
  const productAddresses = await exchange.getProductTokens();
  const products = [];

  for (const productAddress of productAddresses) {
    const tokenContract = getTokenContract(productAddress);

    const symbol = await tokenContract.symbol();
    const decimals = Number(await tokenContract.decimals());

    const pool = await exchange.getPool(productAddress);
    const spotPriceRaw = await exchange.getSpotPrice(productAddress);

    const reserveBase = formatUnitsSafe(pool.reserveBase, 18);
    const reserveProduct = formatUnitsSafe(pool.reserveProduct, decimals);
    const spotPrice = formatUnitsSafe(spotPriceRaw, 18);

    const productData = {
      address: productAddress,
      symbol,
      decimals
    };

    products.push(productData);

    upsertPool(productAddress, {
      product: productData,
      reserveBase,
      reserveProduct,
      spotPrice
    });
  }

  setProducts(products);
}

function registerEventListeners() {
  exchange.on(
    "Bought",
    async (
      trader,
      productToken,
      baseAmountIn,
      productAmountOut,
      newReserveBase,
      newReserveProduct
    ) => {
      try {
        const tokenContract = getTokenContract(productToken);
        const symbol = await tokenContract.symbol();
        const decimals = Number(await tokenContract.decimals());

        addTrade({
          type: "BUY",
          trader,
          traderName: traderMetaMap[trader.toLowerCase()]?.name || trader,
          productToken,
          productSymbol: symbol,
          amountIn: formatUnitsSafe(baseAmountIn, 18),
          amountOut: formatUnitsSafe(productAmountOut, decimals),
          timestamp: Date.now()
        });

        const reserveProductNum = formatUnitsSafe(newReserveProduct, decimals);
        const reserveBaseNum = formatUnitsSafe(newReserveBase, 18);

        upsertPool(productToken, {
          reserveBase: reserveBaseNum,
          reserveProduct: reserveProductNum,
          spotPrice: reserveProductNum > 0 ? reserveBaseNum / reserveProductNum : 0
        });

        await refreshCompetitionStatus();
        await updateRanking();
      } catch (error) {
        console.error("Bought event handler error:", error.message);
      }
    }
  );

  exchange.on(
    "Sold",
    async (
      trader,
      productToken,
      productAmountIn,
      baseAmountOut,
      newReserveBase,
      newReserveProduct
    ) => {
      try {
        const tokenContract = getTokenContract(productToken);
        const symbol = await tokenContract.symbol();
        const decimals = Number(await tokenContract.decimals());

        addTrade({
          type: "SELL",
          trader,
          traderName: traderMetaMap[trader.toLowerCase()]?.name || trader,
          productToken,
          productSymbol: symbol,
          amountIn: formatUnitsSafe(productAmountIn, decimals),
          amountOut: formatUnitsSafe(baseAmountOut, 18),
          timestamp: Date.now()
        });

        const reserveProductNum = formatUnitsSafe(newReserveProduct, decimals);
        const reserveBaseNum = formatUnitsSafe(newReserveBase, 18);

        upsertPool(productToken, {
          reserveBase: reserveBaseNum,
          reserveProduct: reserveProductNum,
          spotPrice: reserveProductNum > 0 ? reserveBaseNum / reserveProductNum : 0
        });

        await refreshCompetitionStatus();
        await updateRanking();
      } catch (error) {
        console.error("Sold event handler error:", error.message);
      }
    }
  );

  exchange.on("CompetitionStarted", async (startTime, endTime) => {
    try {
      setCompetitionStatus({
        competitionStatus: "ACTIVE",
        competitionStartTime: Number(startTime),
        competitionEndTime: Number(endTime)
      });
    } catch (error) {
      console.error("CompetitionStarted event handler error:", error.message);
    }
  });

  exchange.on("CompetitionEnded", async (endTime) => {
    try {
      setCompetitionStatus({
        competitionStatus: "ENDED",
        competitionEndTime: Number(endTime)
      });
      await updateRanking();
    } catch (error) {
      console.error("CompetitionEnded event handler error:", error.message);
    }
  });
}

function setTrackedTraders(traders) {
  trackedTraders = traders;
}

function setTraderMeta(traders) {
  traderMetaMap = {};

  for (const trader of traders) {
    traderMetaMap[trader.address.toLowerCase()] = {
      name: trader.name
    };
  }

  setTraders(traders);
}

async function updateRanking() {
  if (!trackedTraders.length) return [];

  const state = getState();

  const baseBalances = {};
  const productBalancesByTrader = {};
  const productPrices = {};

  for (const product of state.products) {
    const pool = state.pools[product.address.toLowerCase()];
    productPrices[product.address.toLowerCase()] = pool?.spotPrice || 0;
  }

  for (const trader of trackedTraders) {
    const traderKey = trader.toLowerCase();

    const baseBalanceRaw = await baseToken.balanceOf(trader);
    baseBalances[traderKey] = formatUnitsSafe(baseBalanceRaw, 18);

    productBalancesByTrader[traderKey] = {};

    for (const product of state.products) {
      let tokenContract;

      try {
        tokenContract = getTokenContract(product.address);
      } catch (error) {
        console.error(`Token contract creation failed for ${product.address}:`, error.message);
        productBalancesByTrader[traderKey][product.address.toLowerCase()] = 0;
        continue;
      }

      if (!tokenContract) {
        productBalancesByTrader[traderKey][product.address.toLowerCase()] = 0;
        continue;
      }

      try {
        const balanceRaw = await tokenContract.balanceOf(trader);

        productBalancesByTrader[traderKey][product.address.toLowerCase()] =
          formatUnitsSafe(balanceRaw, product.decimals);
      } catch (error) {
        console.error(
          `balanceOf failed for trader ${trader} and product ${product.address}:`,
          error.message
        );

        productBalancesByTrader[traderKey][product.address.toLowerCase()] = 0;
      }
    }
  }

  const initialBaseBalance = Number(process.env.INITIAL_BASE_BALANCE || "1000");

  const ranking = calculateRanking({
    traders: trackedTraders,
    baseBalances,
    productBalancesByTrader,
    productPrices,
    initialBaseBalance
  }).map((item) => {
    const meta = traderMetaMap[item.trader.toLowerCase()] || null;

    return {
      ...item,
      name: meta?.name || item.trader
    };
  });

  setRanking(ranking);

  return ranking;
}

async function refreshAll() {
  await refreshCompetitionStatus();
  await refreshProductsAndPools();
  await updateRanking();
}

module.exports = {
  initBlockchain,
  refreshAll,
  setTrackedTraders,
  setTraderMeta,
  updateRanking
};