import hre from "hardhat";
import fs from "fs";
import "dotenv/config";

async function main() {
  const [owner] = await hre.ethers.getSigners();
  const data = JSON.parse(fs.readFileSync("traders.json", "utf-8"));

  const parse = hre.ethers.parseUnits;

  const exchange = await hre.ethers.getContractAt(
    "CPMMExchange",
    process.env.EXCHANGE_ADDRESS
  );

  const tokenAddresses = [
    process.env.TKN1_ADDRESS,
    process.env.TKN2_ADDRESS,
    process.env.TKN3_ADDRESS,
    process.env.TKN4_ADDRESS,
    process.env.TKN5_ADDRESS,
  ];

  const tokens = [];

  for (const address of tokenAddresses) {
    tokens.push(await hre.ethers.getContractAt("MarketToken", address));
  }

  await exchange.registerTokens(tokenAddresses);

  const OWNER_MINT = parse("1000000", 18);
  const POOL_LIQUIDITY = parse("10000", 18);
  const TRADER_INITIAL_BALANCE = parse("1000", 18);

  for (const token of tokens) {
    await token.mint(owner.address, OWNER_MINT);
    await token.approve(process.env.EXCHANGE_ADDRESS, OWNER_MINT);
  }

  const pairs = [
    [tokens[0], tokens[1]],
    [tokens[1], tokens[2]],
    [tokens[2], tokens[3]],
    [tokens[3], tokens[4]],
    [tokens[4], tokens[0]],
  ];

  for (const [a, b] of pairs) {
    const aAddress = await a.getAddress();
    const bAddress = await b.getAddress();

    const poolInfo = await exchange.getPoolByTokens(aAddress, bAddress);

    if (!poolInfo.exists) {
      await exchange.createPool(
        aAddress,
        bAddress,
        POOL_LIQUIDITY,
        POOL_LIQUIDITY
      );

      console.log(`Pool created: ${await a.symbol()}/${await b.symbol()}`);
    }
  }

  const traderAddresses = (data.traders || []).map((t) => t.address);

  await exchange.registerTraders(traderAddresses);

  for (const traderAddress of traderAddresses) {
    for (const token of tokens) {
      await token.mint(traderAddress, TRADER_INITIAL_BALANCE);
    }

    console.log(`Funded trader ${traderAddress}: 1000 units of each token`);
  }

  console.log("Setup done");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});