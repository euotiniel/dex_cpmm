import hre from "hardhat";
import fs from "fs";
import "dotenv/config";

async function main() {
  const [owner] = await hre.ethers.getSigners();

  const data = JSON.parse(fs.readFileSync("traders.json", "utf-8"));

  const exchange = await hre.ethers.getContractAt(
    "CPMMExchange",
    process.env.EXCHANGE_ADDRESS
  );

  const cash = await hre.ethers.getContractAt(
    "MarketToken",
    process.env.CASH_ADDRESS
  );

  const products = [
    process.env.PROD1_ADDRESS,
    process.env.PROD2_ADDRESS,
    process.env.PROD3_ADDRESS,
    process.env.PROD4_ADDRESS,
    process.env.PROD5_ADDRESS
  ];

  const parse = hre.ethers.parseUnits;

  await cash.mint(owner.address, parse("1000000", 18));

  for (const productAddress of products) {
    const exists = await exchange.poolExists(productAddress);

    if (!exists) {
      const token = await hre.ethers.getContractAt("MarketToken", productAddress);

      await token.mint(owner.address, parse("100000", 18));
      await cash.approve(process.env.EXCHANGE_ADDRESS, parse("1000000", 18));
      await token.approve(process.env.EXCHANGE_ADDRESS, parse("100000", 18));

      await exchange.createPool(
        productAddress,
        parse("10000", 18),
        parse("1000", 18)
      );
    }
  }

  const traderAddresses = (data.traders || []).map((t) => t.address);

  await exchange.registerTraders(traderAddresses);

  for (const traderAddress of traderAddresses) {
    await cash.mint(traderAddress, parse("1000", 18));
  }

  console.log("Setup done");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});