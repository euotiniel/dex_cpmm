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

    graph[token0].push({
      to: token1,
      rate: reserve1 / reserve0,
    });

    graph[token1].push({
      to: token0,
      rate: reserve0 / reserve1,
    });
  }

  return graph;
}

function getRateToReference(tokenAddress, referenceToken, graph) {
  const start = norm(tokenAddress);
  const target = norm(referenceToken);

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

      if (edge.to === target) {
        return nextRate;
      }

      visited.add(edge.to);
      queue.push({
        token: edge.to,
        rate: nextRate,
      });
    }
  }

  return 0;
}

export function calculateRanking({
  traders,
  tokenBalancesByTrader,
  pools,
  referenceToken,
  initialReferenceValue = 5000,
}) {
  const graph = buildConversionGraph(pools);

  const ranking = traders.map((traderAddress) => {
    const traderKey = norm(traderAddress);
    const balances = tokenBalancesByTrader[traderKey] || {};

    let totalValue = 0;

    for (const [tokenAddress, balance] of Object.entries(balances)) {
      const amount = Number(balance || 0);
      if (amount <= 0) continue;

      const rate = getRateToReference(tokenAddress, referenceToken, graph);
      totalValue += amount * rate;
    }

    const pnl = totalValue - initialReferenceValue;
    const pnlPct =
      initialReferenceValue > 0 ? (pnl / initialReferenceValue) * 100 : 0;

    return {
      trader: traderAddress,
      balances,
      totalValue,
      pnl,
      pnlPct,
      referenceToken,
    };
  });

  ranking.sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));

  return ranking;
}