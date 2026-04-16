const { ethers } = require("ethers");

function formatUnitsSafe(value, decimals = 18) {
  try {
    return Number(ethers.formatUnits(value, decimals));
  } catch {
    return 0;
  }
}

function calculateWalletValueInBase({
  baseBalance,
  productBalances,
  productPrices
}) {
  let total = baseBalance;

  for (const productAddress of Object.keys(productBalances)) {
    const balance = productBalances[productAddress] || 0;
    const price = productPrices[productAddress] || 0;

    total += balance * price;
  }

  return total;
}

function calculateRanking({
  traders,
  baseBalances,
  productBalancesByTrader,
  productPrices,
  initialBaseBalance
}) {
  const ranking = traders.map((traderAddress) => {
    const traderKey = traderAddress.toLowerCase();

    const baseBalance = baseBalances[traderKey] || 0;
    const productBalances = productBalancesByTrader[traderKey] || {};

    const totalValue = calculateWalletValueInBase({
      baseBalance,
      productBalances,
      productPrices
    });

    const pnl = totalValue - initialBaseBalance;

    return {
      trader: traderAddress,
      baseBalance,
      productBalances,
      totalValue,
      pnl
    };
  });

  ranking.sort((a, b) => b.pnl - a.pnl);

  return ranking;
}

module.exports = {
  formatUnitsSafe,
  calculateWalletValueInBase,
  calculateRanking
};