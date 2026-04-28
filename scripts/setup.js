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

  // ── Register and fund external bot slots ──────────────────────────────────
  // EXT_BOT_0_PK ... EXT_BOT_N_PK in .env map to Hardhat accounts 9+.
  // Their addresses are derived and registered so they can trade in competitions.
  const extAddresses = [];
  for (let i = 0; i < 20; i++) {
    const pk = process.env[`EXT_BOT_${i}_PK`];
    if (!pk) break;
    const addr = new hre.ethers.Wallet(pk).address;
    extAddresses.push(addr);
  }

  if (extAddresses.length > 0) {
    const unregistered = [];
    for (const addr of extAddresses) {
      const already = await exchange.isTrader(addr);
      if (!already) unregistered.push(addr);
    }

    if (unregistered.length > 0) {
      await exchange.registerTraders(unregistered);
    }

    for (const addr of extAddresses) {
      await cash.mint(addr, parse("1000", 18));
    }

    console.log(`External bot slots: ${extAddresses.length} registered/funded`);
  }

  console.log("Setup done");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});