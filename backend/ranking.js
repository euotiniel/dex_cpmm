import { ethers } from "ethers";

export function formatUnitsSafe(value, decimals = 18) {
  try {
    return Number(ethers.formatUnits(value, decimals));
  } catch {
    return 0;
  }
}

function norm(address) {
  return String(address || "").toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildConversionGraph(pools = {}) {
  const graph = {};

  for (const pool of Object.values(pools || {})) {
    if (!pool?.exists) continue;

    const token0 = norm(pool.token0);
    const token1 = norm(pool.token1);
    const reserve0 = Number(pool.reserve0 || 0);
    const reserve1 = Number(pool.reserve1 || 0);

    if (!token0 || !token1 || reserve0 <= 0 || reserve1 <= 0) continue;

    if (!graph[token0]) graph[token0] = [];
    if (!graph[token1]) graph[token1] = [];

    graph[token0].push({ to: token1, rate: reserve1 / reserve0 });
    graph[token1].push({ to: token0, rate: reserve0 / reserve1 });
  }

  return graph;
}

function getRateToReference(tokenAddress, referenceTokenAddress, graph) {
  const start = norm(tokenAddress);
  const target = norm(referenceTokenAddress);

  if (!start || !target) return 0;
  if (start === target) return 1;

  const queue = [{ token: start, rate: 1 }];
  const visited = new Set([start]);

  while (queue.length) {
    const current = queue.shift();
    const edges = graph[current.token] || [];

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;

      const nextRate = current.rate * edge.rate;

      if (edge.to === target) return nextRate;

      visited.add(edge.to);
      queue.push({ token: edge.to, rate: nextRate });
    }
  }

  return 0;
}

function calculatePortfolioValue({
  balances,
  graph,
  referenceTokenAddress,
}) {
  let portfolioValue = 0;

  for (const [tokenAddress, balance] of Object.entries(balances || {})) {
    const amount = Number(balance || 0);
    if (amount <= 0) continue;

    const rate = getRateToReference(
      tokenAddress,
      referenceTokenAddress,
      graph
    );

    portfolioValue += amount * rate;
  }

  return portfolioValue;
}

function calculateWeightedPortfolioValue({
  balances,
  tokens,
  graph,
  gradingWeights,
  referenceTokenAddress,
}) {
  let weightedValue = 0;
  const weightedBreakdown = {};
  const tokenCount = Math.max(1, tokens.length);

  for (const token of tokens) {
    const tokenKey = norm(token.address);
    const balance = Number(balances[tokenKey] || 0);
    const weightPct = Number(gradingWeights[token.symbol] || 0);

    const rate = getRateToReference(
      token.address,
      referenceTokenAddress,
      graph
    );

    const marketValue = balance * rate;
    const weightedMarketValue = marketValue * (weightPct / 100);

    weightedBreakdown[token.symbol] = {
      weightPct,
      balance,
      rateToReference: rate,
      marketValue,
      weightedMarketValue,
    };

    weightedValue += weightedMarketValue;
  }

  return {
    weightedPortfolioValue: weightedValue * tokenCount,
    weightedBreakdown,
  };
}

export function calculateRanking({
  traders,
  tokenBalancesByTrader,
  pools,
  tokens = [],
  gradingWeights = {},
  initialReferenceValue = 5000,
}) {
  const graph = buildConversionGraph(pools);

  const referenceToken =
    tokens.find((token) => token.symbol === "TKN1") || tokens[0];

  const referenceTokenAddress = referenceToken?.address;

  // STEP 1: calcula valores ponderados (pesos determinam quanto cada token conta)
  const ranking = traders.map((traderAddress) => {
    const traderKey = norm(traderAddress);
    const balances = tokenBalancesByTrader[traderKey] || {};

    const portfolioValue = referenceTokenAddress
      ? calculatePortfolioValue({
          balances,
          graph,
          referenceTokenAddress,
        })
      : 0;

    const { weightedPortfolioValue, weightedBreakdown } = referenceTokenAddress
      ? calculateWeightedPortfolioValue({
          balances,
          tokens,
          graph,
          gradingWeights,
          referenceTokenAddress,
        })
      : {
          weightedPortfolioValue: 0,
          weightedBreakdown: {},
        };

    return {
      trader: traderAddress,
      balances,

      totalValue: weightedPortfolioValue,

      portfolioValue,
      weightedPortfolioValue,

      // preenchidos abaixo
      pnl: 0,
      pnlPct: 0,
      grade20: 10,
      scorePct: 0,

      referenceToken: referenceToken?.symbol || null,
      gradingWeights,
      weightedBreakdown,
    };
  });

  // STEP 2: média do grupo sobre o valor PONDERADO (soma zero)
  const avg =
    ranking.reduce((sum, bot) => sum + bot.weightedPortfolioValue, 0) /
    ranking.length;

  // fallback: se avg for 0 (pesos zerados / pools sem dados), usa initialReferenceValue
  // para não quebrar o pnlPct — garante que o score sempre aparece
  const pnlBase = avg > 0 ? avg : initialReferenceValue;

  // STEP 3: pnl e pnlPct de cada bot
  for (const bot of ranking) {
    bot.pnl = bot.weightedPortfolioValue - avg;
    bot.pnlPct = pnlBase > 0 ? (bot.pnl / pnlBase) * 100 : 0;
    bot.scorePct = bot.pnlPct;
  }

  ranking.sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));

  // STEP 4: grade20 via z-score sobre pnlPct
  const avgPnlPct =
    ranking.reduce((sum, bot) => sum + bot.pnlPct, 0) / ranking.length;

  const variance =
    ranking.reduce((sum, bot) => {
      return sum + Math.pow(bot.pnlPct - avgPnlPct, 2);
    }, 0) / ranking.length;

  const stdDev = Math.sqrt(variance);

  for (const bot of ranking) {
    const zScore =
      stdDev > 0 ? (bot.pnlPct - avgPnlPct) / stdDev : 0;

    bot.grade20 = clamp(10 + zScore * 1.2, 0, 20);
  }

  return ranking;
}