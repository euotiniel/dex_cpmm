import { ethers } from "ethers";

import {
  setCompetitionStatus,
  setTraders,
  setTokens,
  setReferenceToken,
  upsertPool,
  addTrade,
  setRanking,
  getState,
} from "./state.js";

import { formatUnitsSafe, calculateRanking } from "./ranking.js";

const EXCHANGE_ABI = [
  "function getTokens() view returns (address[] memory)",
  "function getPoolIds() view returns (bytes32[] memory)",
  "function getPool(bytes32 poolId) view returns (bool exists, address token0, address token1, uint256 reserve0, uint256 reserve1)",
  "function getPoolByTokens(address tokenA, address tokenB) view returns (bool exists, bytes32 poolId, address token0, address token1, uint256 reserve0, uint256 reserve1)",
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 amountOut)",
  "function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)",
  "function getCompetitionStatus() view returns (uint8 status, uint256 startTime, uint256 endTime)",
  "function startCompetition(uint256 durationSeconds) external",
  "function endCompetition() external",
  "function isTrader(address) view returns (bool)",
  "event Swapped(address indexed trader, bytes32 indexed poolId, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 newReserveIn, uint256 newReserveOut)",
  "event CompetitionStarted(uint256 indexed startTime, uint256 indexed endTime, uint256 durationSeconds)",
  "event CompetitionEnded(uint256 indexed endTime)",
];

const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

let provider = null;
let exchange = null;
let tokenContracts = {};
let trackedTraders = [];
let traderMetaMap = {};
let refreshLock = false;

const balanceCache = {};

function norm(address) {
  return String(address || "").toLowerCase();
}

function mapCompetitionStatus(n) {
  return n === 0 ? "NOT_STARTED" : n === 1 ? "ACTIVE" : n === 2 ? "ENDED" : "UNKNOWN";
}

function getTokenContract(address) {
  const key = norm(address);

  if (!tokenContracts[key]) {
    tokenContracts[key] = new ethers.Contract(address, TOKEN_ABI, provider);
  }

  return tokenContracts[key];
}

function ensureTraderCache(traderKey) {
  if (!balanceCache[traderKey]) {
    balanceCache[traderKey] = { tokens: {} };
  }
}

export function getProvider() {
  return provider;
}

export function getExchange() {
  return exchange;
}

export function shutdownBlockchain() {
  if (exchange) {
    try {
      exchange.removeAllListeners();
    } catch {}
  }

  if (provider) {
    try {
      provider.destroy();
    } catch {}
  }

  provider = null;
  exchange = null;
  tokenContracts = {};

  for (const key of Object.keys(balanceCache)) {
    delete balanceCache[key];
  }
}

export async function reinitBlockchain() {
  shutdownBlockchain();
  await initBlockchain();
  await refreshAll();
}

export async function initBlockchain() {
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");

  exchange = new ethers.Contract(
    process.env.EXCHANGE_ADDRESS,
    EXCHANGE_ABI,
    provider
  );

  setTraders(
    trackedTraders.map((address) => ({
      address,
      name: traderMetaMap[norm(address)]?.name || address,
    }))
  );

  await refreshCompetitionStatus();
  await refreshTokens();
  await refreshPools();
  await refreshAllBalances();

  const state = getState();
  const refSymbol = process.env.REFERENCE_TOKEN_SYMBOL || "TKN1";
  const refToken = state.tokens.find((t) => t.symbol === refSymbol) || state.tokens[0];

  if (refToken) {
    setReferenceToken({
      address: refToken.address,
      symbol: refToken.symbol,
    });
  }

  registerEventListeners();

  return { provider, exchange };
}

async function refreshCompetitionStatus() {
  const [statusRaw, startTimeRaw, endTimeRaw] =
    await exchange.getCompetitionStatus();

  setCompetitionStatus({
    competitionStatus: mapCompetitionStatus(Number(statusRaw)),
    competitionStartTime: Number(startTimeRaw),
    competitionEndTime: Number(endTimeRaw),
  });
}

async function refreshTokens() {
  const tokenAddresses = await exchange.getTokens();
  const tokens = [];

  for (const address of tokenAddresses) {
    const tc = getTokenContract(address);
    const symbol = await tc.symbol();
    const decimals = Number(await tc.decimals());

    tokens.push({
      address,
      symbol,
      decimals,
    });
  }

  setTokens(tokens);
}

async function refreshPools() {
  const poolIds = await exchange.getPoolIds();
  const state = getState();

  for (const poolId of poolIds) {
    const [exists, token0, token1, reserve0Raw, reserve1Raw] =
      await exchange.getPool(poolId);

    if (!exists) continue;

    const t0 = state.tokens.find((t) => norm(t.address) === norm(token0));
    const t1 = state.tokens.find((t) => norm(t.address) === norm(token1));

    const reserve0 = formatUnitsSafe(reserve0Raw, t0?.decimals ?? 18);
    const reserve1 = formatUnitsSafe(reserve1Raw, t1?.decimals ?? 18);

    upsertPool(poolId, {
      poolId,
      exists: true,
      token0,
      token1,
      symbol0: t0?.symbol || shortToken(token0),
      symbol1: t1?.symbol || shortToken(token1),
      reserve0,
      reserve1,
      pair: `${t0?.symbol || "T0"}/${t1?.symbol || "T1"}`,
    });
  }
}

function shortToken(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function refreshAllBalances() {
  const state = getState();

  for (const trader of trackedTraders) {
    const traderKey = norm(trader);
    ensureTraderCache(traderKey);

    for (const token of state.tokens) {
      const tc = getTokenContract(token.address);
      const raw = await tc.balanceOf(trader);
      balanceCache[traderKey].tokens[norm(token.address)] =
        formatUnitsSafe(raw, token.decimals);
    }
  }
}

async function refreshTraderBalances(traderAddress) {
  const state = getState();
  const traderKey = norm(traderAddress);
  ensureTraderCache(traderKey);

  for (const token of state.tokens) {
    const tc = getTokenContract(token.address);
    const raw = await tc.balanceOf(traderAddress);
    balanceCache[traderKey].tokens[norm(token.address)] =
      formatUnitsSafe(raw, token.decimals);
  }
}

function computeRanking() {
  const state = getState();
  const tokenBalancesByTrader = {};

  for (const trader of trackedTraders) {
    const traderKey = norm(trader);
    const cache = balanceCache[traderKey] || { tokens: {} };
    tokenBalancesByTrader[traderKey] = { ...cache.tokens };
  }

  const initialReferenceValue = Number(
    process.env.INITIAL_REFERENCE_VALUE || "5000"
  );

  const ranking = calculateRanking({
    traders: trackedTraders,
    tokenBalancesByTrader,
    pools: state.pools,
    referenceToken: state.referenceToken.address,
    initialReferenceValue,
  }).map((item) => ({
    ...item,
    name: traderMetaMap[norm(item.trader)]?.name || item.trader,
  }));

  setRanking(ranking);
  return ranking;
}

function registerEventListeners() {
  exchange.on(
    "Swapped",
    async (
      trader,
      poolId,
      tokenIn,
      tokenOut,
      amountInRaw,
      amountOutRaw,
      newReserveInRaw,
      newReserveOutRaw
    ) => {
      try {
        const state = getState();

        const inToken = state.tokens.find((t) => norm(t.address) === norm(tokenIn));
        const outToken = state.tokens.find((t) => norm(t.address) === norm(tokenOut));

        const amountIn = formatUnitsSafe(amountInRaw, inToken?.decimals ?? 18);
        const amountOut = formatUnitsSafe(amountOutRaw, outToken?.decimals ?? 18);

        const pool = state.pools[String(poolId).toLowerCase()];

        if (pool) {
          const reserveIn = formatUnitsSafe(newReserveInRaw, inToken?.decimals ?? 18);
          const reserveOut = formatUnitsSafe(newReserveOutRaw, outToken?.decimals ?? 18);

          const isToken0In = norm(tokenIn) === norm(pool.token0);

          upsertPool(poolId, {
            ...pool,
            reserve0: isToken0In ? reserveIn : reserveOut,
            reserve1: isToken0In ? reserveOut : reserveIn,
          });
        } else {
          await refreshPools();
        }

        addTrade({
          type: "SWAP",
          trader,
          traderName: traderMetaMap[norm(trader)]?.name || trader,
          poolId,
          tokenIn,
          tokenOut,
          tokenInSymbol: inToken?.symbol || shortToken(tokenIn),
          tokenOutSymbol: outToken?.symbol || shortToken(tokenOut),
          amountIn,
          amountOut,
          timestamp: Date.now(),
        });

        await refreshTraderBalances(trader);
        computeRanking();
      } catch (err) {
        console.error("Swapped event error:", err.message);
      }
    }
  );

  exchange.on("CompetitionStarted", async (startTime, endTime) => {
    setCompetitionStatus({
      competitionStatus: "ACTIVE",
      competitionStartTime: Number(startTime),
      competitionEndTime: Number(endTime),
    });
  });

  exchange.on("CompetitionEnded", async (endTime) => {
    setCompetitionStatus({
      competitionStatus: "ENDED",
      competitionEndTime: Number(endTime),
    });

    await refreshAllBalances();
    computeRanking();
  });
}

export function setTrackedTraders(traders) {
  trackedTraders = traders;
}

export function setTraderMeta(traders) {
  traderMetaMap = {};

  for (const t of traders) {
    traderMetaMap[norm(t.address)] = {
      name: t.name,
    };
  }

  setTraders(traders);
}

export async function refreshAll() {
  if (refreshLock) return;

  refreshLock = true;

  try {
    await refreshCompetitionStatus();
    await refreshTokens();
    await refreshPools();
    await refreshAllBalances();
    computeRanking();
  } finally {
    refreshLock = false;
  }
}

export async function startCompetitionOnChain(durationSeconds = 300) {
  const pk =
    process.env.DEPLOYER_PK ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const signer = new ethers.Wallet(pk, provider);
  const ex = exchange.connect(signer);

  const tx = await ex.startCompetition(BigInt(durationSeconds));
  await tx.wait();
}

export async function endCompetitionOnChain() {
  const pk =
    process.env.DEPLOYER_PK ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const signer = new ethers.Wallet(pk, provider);
  const ex = exchange.connect(signer);

  const tx = await ex.endCompetition();
  await tx.wait();
}

export function deriveAddress(pk) {
  return new ethers.Wallet(pk).address;
}

export async function executeSwapFor(pk, tokenIn, tokenOut, amountIn) {
  if (!provider || !exchange) {
    throw new Error("Blockchain not initialised");
  }

  const state = getState();

  const inToken = state.tokens.find((t) => norm(t.address) === norm(tokenIn));
  if (!inToken) throw new Error("Unknown tokenIn");

  const signer = new ethers.Wallet(pk, provider);
  const exSigned = exchange.connect(signer);

  const amountWei = ethers.parseUnits(String(amountIn), inToken.decimals);

  const tokenContract = new ethers.Contract(tokenIn, TOKEN_ABI, provider);
  const signedToken = tokenContract.connect(signer);

  const allowance = await signedToken.allowance(signer.address, exchange.target);

  if (allowance < amountWei) {
    const approveTx = await signedToken.approve(exchange.target, amountWei * 2n);
    await approveTx.wait();
  }

  const expected = await exchange.quote(tokenIn, tokenOut, amountWei);
  const outMin = (expected * 95n) / 100n;

  const tx = await exSigned.swap(tokenIn, tokenOut, amountWei, outMin);
  const receipt = await tx.wait();

  return { txHash: receipt.hash };
}

export async function getBalanceFor(address) {
  if (!provider) throw new Error("Blockchain not initialised");

  const state = getState();
  const balances = {};

  for (const token of state.tokens) {
    const tc = getTokenContract(token.address);
    const raw = await tc.balanceOf(address);

    balances[token.address] = {
      symbol: token.symbol,
      balance: formatUnitsSafe(raw, token.decimals),
    };
  }

  return { balances };
}

export function addTrackedTrader(address, name) {
  const normalized = norm(address);

  if (trackedTraders.some((a) => norm(a) === normalized)) return;

  trackedTraders.push(address);
  traderMetaMap[normalized] = { name };

  const state = getState();
  const already = state.traders.find((t) => norm(t.address) === normalized);

  if (!already) {
    setTraders([...state.traders, { address, name }]);
  }
}