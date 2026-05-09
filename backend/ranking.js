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

function calculateGrade20FromScorePct(scorePct) {
  return clamp((Number(scorePct || 0) / 100) * 20, 0, 20);
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

  const maxBalanceByToken = {};

  for (const token of tokens) {
    const tokenKey = norm(token.address);
    let maxBalance = 0;

    for (const traderAddress of traders) {
      const traderKey = norm(traderAddress);
      const balances = tokenBalancesByTrader[traderKey] || {};
      const balance = Number(balances[tokenKey] || 0);

      if (balance > maxBalance) maxBalance = balance;
    }

    maxBalanceByToken[tokenKey] = maxBalance;
  }

  const ranking = traders.map((traderAddress) => {
    const traderKey = norm(traderAddress);
    const balances = tokenBalancesByTrader[traderKey] || {};

    let scorePct = 0;
    const weightedBreakdown = {};

    for (const token of tokens) {
      const tokenKey = norm(token.address);
      const balance = Number(balances[tokenKey] || 0);
      const weightPct = Number(gradingWeights[token.symbol] || 0);
      const maxBalance = Number(maxBalanceByToken[tokenKey] || 0);

      const performancePct =
        maxBalance > 0 ? (balance / maxBalance) * 100 : 0;

      const weightedValue = performancePct * (weightPct / 100);

      weightedBreakdown[token.symbol] = {
        weightPct,
        balance,
        maxBalance,
        performancePct,
        weightedValue,
      };

      scorePct += weightedValue;
    }

    const grade20 = calculateGrade20FromScorePct(scorePct);

    const portfolioValue = referenceTokenAddress
      ? calculatePortfolioValue({
          balances,
          graph,
          referenceTokenAddress,
        })
      : 0;

    const pnl = portfolioValue - initialReferenceValue;
    const pnlPct =
      initialReferenceValue > 0 ? (pnl / initialReferenceValue) * 100 : 0;

    return {
      trader: traderAddress,
      balances,

      totalValue: scorePct,
      scorePct,
      grade20,

      portfolioValue,
      pnl,
      pnlPct,
      referenceToken: referenceToken?.symbol || null,

      gradingWeights,
      weightedBreakdown,
    };
  });

  ranking.sort((a, b) => Number(b.scorePct || 0) - Number(a.scorePct || 0));

  return ranking;
}