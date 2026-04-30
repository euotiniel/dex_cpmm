import hre from "hardhat";
import fs from "fs";
import path from "path";
import "dotenv/config";

const ENV_PATH = path.resolve(".env");

function parseEnvFile(content) {
  const env = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }

  return env;
}

function buildEnvContent(env) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

function updateEnvFile(newValues) {
  let env = {};

  if (fs.existsSync(ENV_PATH)) {
    env = parseEnvFile(fs.readFileSync(ENV_PATH, "utf-8"));
  }

  fs.writeFileSync(
    ENV_PATH,
    buildEnvContent({ ...env, ...newValues }),
    "utf-8"
  );
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=================================");
  console.log("Deploying token-token CPMM DEX...");
  console.log("Deployer:", deployer.address);
  console.log("=================================");

  const Token = await hre.ethers.getContractFactory("MarketToken");

  const tokens = [];

  for (let i = 1; i <= 5; i++) {
    const token = await Token.deploy(
      `Token ${i}`,
      `TKN${i}`,
      deployer.address
    );

    await token.waitForDeployment();
    tokens.push(token);
  }

  const Exchange = await hre.ethers.getContractFactory("CPMMExchange");
  const exchange = await Exchange.deploy(deployer.address);
  await exchange.waitForDeployment();

  const tokenAddresses = [];

  for (const token of tokens) {
    tokenAddresses.push((await token.getAddress()).toLowerCase());
  }

  const exchangeAddress = (await exchange.getAddress()).toLowerCase();

  const envValues = {
    EXCHANGE_ADDRESS: exchangeAddress,
    TKN1_ADDRESS: tokenAddresses[0],
    TKN2_ADDRESS: tokenAddresses[1],
    TKN3_ADDRESS: tokenAddresses[2],
    TKN4_ADDRESS: tokenAddresses[3],
    TKN5_ADDRESS: tokenAddresses[4],
    REFERENCE_TOKEN_SYMBOL: "TKN1"
  };

  updateEnvFile(envValues);

  console.log("EXCHANGE:", exchangeAddress);
  console.log("TKN1:", tokenAddresses[0]);
  console.log("TKN2:", tokenAddresses[1]);
  console.log("TKN3:", tokenAddresses[2]);
  console.log("TKN4:", tokenAddresses[3]);
  console.log("TKN5:", tokenAddresses[4]);
  console.log("=================================");
  console.log(".env atualizado.");
  console.log("=================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});