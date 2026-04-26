import hre from "hardhat";
import fs from "fs";
import path from "path";
import "dotenv/config";

const ENV_PATH = path.resolve(".env");

function parseEnvFile(content) {
  const lines = content.split(/\r?\n/);
  const env = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();

    env[key] = value;
  }

  return env;
}

function buildEnvContent(envObject) {
  return (
    Object.entries(envObject)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n"
  );
}

function updateEnvFile(newValues) {
  let env = {};

  if (fs.existsSync(ENV_PATH)) {
    const currentContent = fs.readFileSync(ENV_PATH, "utf-8");
    env = parseEnvFile(currentContent);
  }

  env = {
    ...env,
    ...newValues,
  };

  fs.writeFileSync(ENV_PATH, buildEnvContent(env), "utf-8");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=================================");
  console.log("Deploying contracts...");
  console.log("Deployer:", deployer.address);
  console.log("=================================");

  const Token = await hre.ethers.getContractFactory("MarketToken");

  const cash = await Token.deploy("Cash Token", "CASH", deployer.address);
  await cash.waitForDeployment();

  const products = [];

  for (let i = 1; i <= 5; i++) {
    const product = await Token.deploy(
      `Product ${i}`,
      `PROD${i}`,
      deployer.address
    );

    await product.waitForDeployment();
    products.push(product);
  }

  const cashAddress = await cash.getAddress();

  const feeTreasury = deployer.address;

  const Exchange = await hre.ethers.getContractFactory("CPMMExchange");

  const exchange = await Exchange.deploy(
    cashAddress,
    deployer.address,
    feeTreasury
  );

  await exchange.waitForDeployment();

  const deployedAddresses = {
    CASH_ADDRESS: cashAddress.toLowerCase(),
    EXCHANGE_ADDRESS: (await exchange.getAddress()).toLowerCase(),
    FEE_TREASURY_ADDRESS: feeTreasury.toLowerCase(),
    PROD1_ADDRESS: (await products[0].getAddress()).toLowerCase(),
    PROD2_ADDRESS: (await products[1].getAddress()).toLowerCase(),
    PROD3_ADDRESS: (await products[2].getAddress()).toLowerCase(),
    PROD4_ADDRESS: (await products[3].getAddress()).toLowerCase(),
    PROD5_ADDRESS: (await products[4].getAddress()).toLowerCase(),
  };

  console.log("CASH:", deployedAddresses.CASH_ADDRESS);
  console.log("EXCHANGE:", deployedAddresses.EXCHANGE_ADDRESS);
  console.log("FEE_TREASURY:", deployedAddresses.FEE_TREASURY_ADDRESS);
  console.log("PROD1:", deployedAddresses.PROD1_ADDRESS);
  console.log("PROD2:", deployedAddresses.PROD2_ADDRESS);
  console.log("PROD3:", deployedAddresses.PROD3_ADDRESS);
  console.log("PROD4:", deployedAddresses.PROD4_ADDRESS);
  console.log("PROD5:", deployedAddresses.PROD5_ADDRESS);

  updateEnvFile(deployedAddresses);

  console.log("=================================");
  console.log(".env atualizado automaticamente.");
  console.log("=================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});