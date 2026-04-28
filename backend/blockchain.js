import { ethers } from "ethers";

import {
  setBaseToken,
  setCompetitionStatus,
  setTraders,
  setProducts,
  upsertPool,
  addTrade,
  setRanking,
  getState,
} from "./state.js";

import { formatUnitsSafe, calculateRanking } from "./ranking.js";

const EXCHANGE_ABI = [
  "function baseToken() view returns (address)",
  "function getProductTokens() view returns (address[] memory)",
  "function getPool(address productToken) view returns (bool exists, address token, uint256 reserveBase, uint256 reserveProduct)",
  "function getSpotPrice(address productToken) view returns (uint256 priceInBase)",
  "function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)",
  "function getCompetitionStatus() view returns (uint8 status, uint256 startTime, uint256 endTime)",
  "function startCompetition(uint256 durationSeconds) external",
  "function endCompetition() external",
  "function traderCount() view returns (uint256)",
  "function isTrader(address) view returns (bool)",
  "event Bought(address indexed trader, address indexed productToken, uint256 baseAmountIn, uint256 productAmountOut, uint256 newReserveBase, uint256 newReserveProduct)",
  "event Sold(address indexed trader, address indexed productToken, uint256 productAmountIn, uint256 baseAmountOut, uint256 newReserveBase, uint256 newReserveProduct)",
  "event CompetitionStarted(uint256 indexed startTime, uint256 indexed endTime, uint256 durationSeconds)",
  "event CompetitionEnded(uint256 indexed endTime)",
];

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
];

// ── Module-level state ────────────────────────────────────────────────────────

let provider        = null;
let exchange        = null;
let baseToken       = null;
let productContracts = {};
let trackedTraders  = [];
let traderMetaMap   = {};
let refreshLock     = false;

// ── Balance cache — avoids fetching all 40 balances on every trade ────────────
const balanceCache = {};

function ensureTraderCache(traderKey) {
  if (!balanceCache[traderKey]) {
    balanceCache[traderKey] = { base: 0, products: {} };
  }
}

// ── Exports for orchestrator / server ────────────────────────────────────────

/** Returns the current ethers provider (may be null before initBlockchain). */
export function getProvider() { return provider; }

/** Returns the current exchange contract instance (may be null before initBlockchain). */
export function getExchange() { return exchange; }

// ── Shutdown / reinit ─────────────────────────────────────────────────────────

/**
 * Removes all event listeners and destroys the provider.
 * Call before reinitialising after a fresh deployment.
 */
export function shutdownBlockchain() {
  if (exchange) {
    try { exchange.removeAllListeners(); } catch {}
  }
  if (provider) {
    try { provider.destroy(); } catch {}
  }
  provider        = null;
  exchange        = null;
  baseToken       = null;
  productContracts = {};
  // Clear the balance cache — contract addresses changed after redeploy
  for (const k of Object.keys(balanceCache)) delete balanceCache[k];
}

/**
 * Shutdown + re-init with the (potentially updated) addresses in process.env.
 * Used by the orchestrator after deploying new contracts.
 */
export async function reinitBlockchain() {
  shutdownBlockchain();
  await initBlockchain();
  await refreshAll();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapCompetitionStatus(n) {
  return n === 0 ? "NOT_STARTED" : n === 1 ? "ACTIVE" : n === 2 ? "ENDED" : "UNKNOWN";
}

function getTokenContract(address) {
  const key = address.toLowerCase();
  if (!productContracts[key]) {
    productContracts[key] = new ethers.Contract(address, TOKEN_ABI, provider);
  }
  return productContracts[key];
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initBlockchain() {
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  exchange = new ethers.Contract(
    process.env.EXCHANGE_ADDRESS,
    EXCHANGE_ABI,
    provider
  );

  const baseTokenAddress = await exchange.baseToken();
  baseToken = new ethers.Contract(baseTokenAddress, TOKEN_ABI, provider);

  const baseSymbol  = await baseToken.symbol();
  const baseDecimals = await baseToken.decimals();
  setBaseToken(baseTokenAddress, baseSymbol, Number(baseDecimals));

  setTraders(
    trackedTraders.map((address) => ({
      address,
      name: traderMetaMap[address.toLowerCase()]?.name || address,
    }))
  );

  await refreshCompetitionStatus();
  await refreshProductsAndPools();
  await refreshAllBalances();

  registerEventListeners();

  return { provider, exchange, baseToken };
}

// ── Blockchain reads ──────────────────────────────────────────────────────────

async function refreshCompetitionStatus() {
  const [statusRaw, startTimeRaw, endTimeRaw] =
    await exchange.getCompetitionStatus();

  setCompetitionStatus({
    competitionStatus:    mapCompetitionStatus(Number(statusRaw)),
    competitionStartTime: Number(startTimeRaw),
    competitionEndTime:   Number(endTimeRaw),
  });
}

async function refreshProductsAndPools() {
  const productAddresses = await exchange.getProductTokens();
  const products = [];

  for (const productAddress of productAddresses) {
    const tc       = getTokenContract(productAddress);
    const symbol   = await tc.symbol();
    const decimals = Number(await tc.decimals());
    const pool     = await exchange.getPool(productAddress);
    const priceRaw = await exchange.getSpotPrice(productAddress);

    const reserveBase    = formatUnitsSafe(pool.reserveBase,    18);
    const reserveProduct = formatUnitsSafe(pool.reserveProduct, decimals);
    const spotPrice      = formatUnitsSafe(priceRaw, 18);

    const productData = { address: productAddress, symbol, decimals };
    products.push(productData);

    upsertPool(productAddress, { product: productData, reserveBase, reserveProduct, spotPrice });
  }

  setProducts(products);
}

// Full balance refresh (48 calls) — only at startup & periodic fallback.
async function refreshAllBalances() {
  const state = getState();

  for (const trader of trackedTraders) {
    const traderKey = trader.toLowerCase();
    ensureTraderCache(traderKey);

    const baseRaw = await baseToken.balanceOf(trader);
    balanceCache[traderKey].base = formatUnitsSafe(baseRaw, 18);

    for (const product of state.products) {
      const productKey = product.address.toLowerCase();
      try {
        const tc  = getTokenContract(product.address);
        const raw = await tc.balanceOf(trader);
        balanceCache[traderKey].products[productKey] = formatUnitsSafe(raw, product.decimals);
      } catch {
        balanceCache[traderKey].products[productKey] = 0;
      }
    }
  }
}

// Targeted update for one trader after a trade — only 2 RPC calls.
async function refreshTraderBalances(traderAddress, productAddress) {
  const traderKey  = traderAddress.toLowerCase();
  const productKey = productAddress.toLowerCase();
  const state      = getState();

  ensureTraderCache(traderKey);

  const baseRaw = await baseToken.balanceOf(traderAddress);
  balanceCache[traderKey].base = formatUnitsSafe(baseRaw, 18);

  const product = state.products.find((p) => p.address.toLowerCase() === productKey);
  if (product) {
    const tc  = getTokenContract(productAddress);
    const raw = await tc.balanceOf(traderAddress);
    balanceCache[traderKey].products[productKey] = formatUnitsSafe(raw, product.decimals);
  }
}

// Pure in-memory ranking — 0 RPC calls.
function computeRanking() {
  const state = getState();
  const baseBalances          = {};
  const productBalancesByTrader = {};

  for (const trader of trackedTraders) {
    const traderKey = trader.toLowerCase();
    const cache     = balanceCache[traderKey] || { base: 0, products: {} };
    baseBalances[traderKey]              = cache.base;
    productBalancesByTrader[traderKey]   = { ...cache.products };
  }

  const initialBaseBalance = Number(process.env.INITIAL_BASE_BALANCE || "1000");

  const ranking = calculateRanking({
    traders:                trackedTraders,
    baseBalances,
    productBalancesByTrader,
    poolsByProduct:         state.pools,
    initialBaseBalance,
  }).map((item) => ({
    ...item,
    name: traderMetaMap[item.trader.toLowerCase()]?.name || item.trader,
  }));

  setRanking(ranking);
  return ranking;
}

// ── Event listeners ───────────────────────────────────────────────────────────

function registerEventListeners() {
  exchange.on(
    "Bought",
    async (trader, productToken, baseAmountIn, productAmountOut, newReserveBase, newReserveProduct) => {
      try {
        const tc       = getTokenContract(productToken);
        const symbol   = await tc.symbol();
        const decimals = Number(await tc.decimals());

        addTrade({
          type:         "BUY",
          trader,
          traderName:   traderMetaMap[trader.toLowerCase()]?.name || trader,
          productToken,
          productSymbol: symbol,
          amountIn:     formatUnitsSafe(baseAmountIn,    18),
          amountOut:    formatUnitsSafe(productAmountOut, decimals),
          timestamp:    Date.now(),
        });

        const rProd = formatUnitsSafe(newReserveProduct, decimals);
        const rBase = formatUnitsSafe(newReserveBase,    18);

        upsertPool(productToken, {
          reserveBase:    rBase,
          reserveProduct: rProd,
          spotPrice:      rProd > 0 ? rBase / rProd : 0,
        });

        await refreshTraderBalances(trader, productToken);
        computeRanking();
      } catch (err) {
        console.error("Bought event error:", err.message);
      }
    }
  );

  exchange.on(
    "Sold",
    async (trader, productToken, productAmountIn, baseAmountOut, newReserveBase, newReserveProduct) => {
      try {
        const tc       = getTokenContract(productToken);
        const symbol   = await tc.symbol();
        const decimals = Number(await tc.decimals());

        addTrade({
          type:         "SELL",
          trader,
          traderName:   traderMetaMap[trader.toLowerCase()]?.name || trader,
          productToken,
          productSymbol: symbol,
          amountIn:     formatUnitsSafe(productAmountIn, decimals),
          amountOut:    formatUnitsSafe(baseAmountOut,   18),
          timestamp:    Date.now(),
        });

        const rProd = formatUnitsSafe(newReserveProduct, decimals);
        const rBase = formatUnitsSafe(newReserveBase,    18);

        upsertPool(productToken, {
          reserveBase:    rBase,
          reserveProduct: rProd,
          spotPrice:      rProd > 0 ? rBase / rProd : 0,
        });

        await refreshTraderBalances(trader, productToken);
        computeRanking();
      } catch (err) {
        console.error("Sold event error:", err.message);
      }
    }
  );

  exchange.on("CompetitionStarted", async (startTime, endTime) => {
    try {
      setCompetitionStatus({
        competitionStatus:    "ACTIVE",
        competitionStartTime: Number(startTime),
        competitionEndTime:   Number(endTime),
      });
    } catch (err) {
      console.error("CompetitionStarted handler error:", err.message);
    }
  });

  exchange.on("CompetitionEnded", async (endTime) => {
    try {
      setCompetitionStatus({
        competitionStatus:  "ENDED",
        competitionEndTime: Number(endTime),
      });
      await refreshAllBalances();
      computeRanking();
    } catch (err) {
      console.error("CompetitionEnded handler error:", err.message);
    }
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function setTrackedTraders(traders) {
  trackedTraders = traders;
}

export function setTraderMeta(traders) {
  traderMetaMap = {};
  for (const t of traders) {
    traderMetaMap[t.address.toLowerCase()] = { name: t.name };
  }
  setTraders(traders);
}

export async function refreshAll() {
  if (refreshLock) return;
  refreshLock = true;
  try {
    await refreshCompetitionStatus();
    await refreshProductsAndPools();
    await refreshAllBalances();
    computeRanking();
  } finally {
    refreshLock = false;
  }
}

// ── On-chain competition control ──────────────────────────────────────────────

export async function startCompetitionOnChain(durationSeconds = 300) {
  const pk = process.env.DEPLOYER_PK ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const signer = new ethers.Wallet(pk, provider);
  const ex     = exchange.connect(signer);
  const tx     = await ex.startCompetition(BigInt(durationSeconds));
  await tx.wait();
}

export async function endCompetitionOnChain() {
  const pk = process.env.DEPLOYER_PK ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const signer = new ethers.Wallet(pk, provider);
  const ex     = exchange.connect(signer);
  const tx     = await ex.endCompetition();
  await tx.wait();
}
