/**
 * Fairness metrics engine.
 * Analyses ranking + trades to produce an objective fairness report.
 */

export function calculateFairness(ranking = [], trades = []) {
  const result = {
    status: "FAIR",   // FAIR | WARNING | UNBALANCED
    issues: [],
    metrics: {
      gini: 0,
      dominancePct: 0,
      dominantBot: null,
      tradeFrequencyRatio: 1,
      buyRatio: 0.5,
      sellRatio: 0.5,
    },
  };

  if (!ranking.length) return result;

  // ── 1. Gini coefficient of total portfolio value ───────────────────────────
  // Gini = 0 → perfect equality. Gini = 1 → one bot holds everything.
  const values = ranking.map((r) => Math.max(0, Number(r.totalValue || 0)));
  result.metrics.gini = calcGini(values);

  if (result.metrics.gini > 0.45) {
    result.status = "UNBALANCED";
    result.issues.push(
      `High wealth inequality: Gini = ${result.metrics.gini.toFixed(2)} (>0.45)`
    );
  } else if (result.metrics.gini > 0.30) {
    _escalate(result, "WARNING");
    result.issues.push(
      `Moderate inequality: Gini = ${result.metrics.gini.toFixed(2)}`
    );
  }

  // ── 2. PnL dominance — single bot taking >50 % of total positive profit ────
  const pnls = ranking.map((r) => Math.max(0, Number(r.pnl || 0)));
  const totalPosPnL = pnls.reduce((a, b) => a + b, 0);

  if (totalPosPnL > 0) {
    const maxPnL = Math.max(...pnls);
    const maxIdx = pnls.indexOf(maxPnL);
    const dominance = maxPnL / totalPosPnL;

    result.metrics.dominancePct = parseFloat((dominance * 100).toFixed(1));
    result.metrics.dominantBot  = ranking[maxIdx]?.name || null;

    if (dominance > 0.50) {
      _escalate(result, "UNBALANCED");
      result.issues.push(
        `Bot dominance: "${result.metrics.dominantBot}" holds ` +
        `${result.metrics.dominancePct}% of all profits (>50%)`
      );
    } else if (dominance > 0.40) {
      _escalate(result, "WARNING");
      result.issues.push(
        `Near-dominance: "${result.metrics.dominantBot}" at ` +
        `${result.metrics.dominancePct}% of profits`
      );
    }
  }

  // ── 3. Trade frequency inequality (max-trades / min-trades ratio) ──────────
  const tradeMap = {};
  for (const t of trades) {
    const k = (t.trader || "").toLowerCase();
    if (!k) continue;
    tradeMap[k] = (tradeMap[k] || 0) + 1;
  }
  const counts = Object.values(tradeMap);
  if (counts.length >= 2) {
    const mx = Math.max(...counts);
    const mn = Math.min(...counts);
    const ratio = mn > 0 ? mx / mn : mx;
    result.metrics.tradeFrequencyRatio = parseFloat(ratio.toFixed(2));

    if (ratio > 15) {
      _escalate(result, "UNBALANCED");
      result.issues.push(
        `Extreme trade frequency imbalance: ${ratio.toFixed(1)}× (max/min)`
      );
    } else if (ratio > 8) {
      _escalate(result, "WARNING");
      result.issues.push(
        `Trade frequency imbalance: ${ratio.toFixed(1)}× (max/min)`
      );
    }
  }

  // ── 4. Buy/sell market balance ─────────────────────────────────────────────
  const buys  = trades.filter((t) => t.type === "BUY").length;
  const sells = trades.filter((t) => t.type === "SELL").length;
  const total = buys + sells;

  if (total > 0) {
    result.metrics.buyRatio  = parseFloat((buys  / total).toFixed(3));
    result.metrics.sellRatio = parseFloat((sells / total).toFixed(3));

    const imbalance = Math.abs(result.metrics.buyRatio - 0.5);
    if (imbalance > 0.30) {
      _escalate(result, "WARNING");
      result.issues.push(
        `One-sided market: ${(result.metrics.buyRatio * 100).toFixed(0)}% buys / ` +
        `${(result.metrics.sellRatio * 100).toFixed(0)}% sells`
      );
    }
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcGini(values) {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mean   = sorted.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;

  let sumAbs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumAbs += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return parseFloat((sumAbs / (2 * n * n * mean)).toFixed(4));
}

// Only escalate status, never downgrade.
const SEVERITY = { FAIR: 0, WARNING: 1, UNBALANCED: 2 };
function _escalate(result, level) {
  if (SEVERITY[level] > SEVERITY[result.status]) {
    result.status = level;
  }
}
