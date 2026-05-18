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

function calculateGrade20FromPnlPct(pnlPct) {
  return clamp(10 + Number(pnlPct || 0) * 2, 0, 20);
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

  /*
    Normalização:
    - Sem isto, se TKN2 = 100%, o valor inicial seria 1000.
    - Com isto, o valor inicial continua perto de 5000,
      mantendo compatibilidade com INITIAL_REFERENCE_VALUE=5000.
  */
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

    const pnl = weightedPortfolioValue - initialReferenceValue;

    const pnlPct =
      initialReferenceValue > 0
        ? (pnl / initialReferenceValue) * 100
        : 0;

    const grade20 = calculateGrade20FromPnlPct(pnlPct);

    return {
      trader: traderAddress,
      balances,

      // Mantém compatibilidade com UI/fairness
      totalValue: weightedPortfolioValue,

      // PnL real ponderado pelos pesos do professor
      portfolioValue,
      weightedPortfolioValue,
      pnl,
      pnlPct,
      grade20,

      // Mantido para não quebrar UI antiga, mas agora é PnL%
      scorePct: pnlPct,

      referenceToken: referenceToken?.symbol || null,
      gradingWeights,
      weightedBreakdown,
    };
  });

  ranking.sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));

  return ranking;
}