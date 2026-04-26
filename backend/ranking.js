import { ethers } from "ethers";

export function formatUnitsSafe(value, decimals = 18) {
  try {
    return Number(ethers.formatUnits(value, decimals));
  } catch {
    return 0;
  }
}

function normalizeAddress(address) {
  return String(address || "").toLowerCase();
}

function getPoolForProduct(productAddress, poolsByProduct = {}) {
  const key = normalizeAddress(productAddress);
  return poolsByProduct[key] || poolsByProduct[productAddress] || null;
}

function calculateCpmmSellValue({
  productAmount,
  productReserve,
  baseReserve,
  feePct = 0.003,
}) {
  if (productAmount <= 0 || productReserve <= 0 || baseReserve <= 0) {
    return 0;
  }

  const amountInAfterFee = productAmount * (1 - feePct);

  return (
    (amountInAfterFee * baseReserve) /
    (productReserve + amountInAfterFee)
  );
}

function calculateWalletValueInBase({
  baseBalance,
  productBalances,
  poolsByProduct,
  feePct,
}) {
  let total = baseBalance;

  for (const productAddress of Object.keys(productBalances || {})) {
    const productAmount = Number(productBalances[productAddress] || 0);

    if (productAmount <= 0) continue;

    const pool = getPoolForProduct(productAddress, poolsByProduct);

    if (!pool) continue;

    const productReserve = Number(
      pool.reserveProduct ??
      pool.productReserve ??
      pool.product_reserve ??
      pool.productBalance ??
      pool.tokenReserve ??
      0
    );

    const baseReserve = Number(
      pool.reserveBase ??
      pool.baseReserve ??
      pool.base_reserve ??
      pool.cashReserve ??
      pool.baseBalance ??
      0
    );

    total += calculateCpmmSellValue({
      productAmount,
      productReserve,
      baseReserve,
      feePct,
    });
  }

  return total;
}

export function calculateRanking({
  traders,
  baseBalances,
  productBalancesByTrader,
  poolsByProduct,
  initialBaseBalance,
  feePct = 0.003,
}) {
  const ranking = traders.map((traderAddress) => {
    const traderKey = normalizeAddress(traderAddress);

    const baseBalance = Number(baseBalances[traderKey] || 0);
    const productBalances = productBalancesByTrader[traderKey] || {};

    const totalValue = calculateWalletValueInBase({
      baseBalance,
      productBalances,
      poolsByProduct,
      feePct,
    });

    const pnl = totalValue - initialBaseBalance;

    const pnlPct =
      initialBaseBalance > 0 ? (pnl / initialBaseBalance) * 100 : 0;

    return {
      trader: traderAddress,
      baseBalance,
      productBalances,
      totalValue,
      pnl,
      pnlPct,
    };
  });

  ranking.sort((a, b) => b.pnl - a.pnl);

  return ranking;
}