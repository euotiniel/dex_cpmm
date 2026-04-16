import hre from "hardhat";
import "dotenv/config";

// pega argumentos tipo --duration=300
function getArg(name, defaultValue) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return defaultValue;
  return arg.split("=")[1];
}

async function main() {
  const duration = parseInt(getArg("duration", "300")); // default: 5 min

  if (!duration || duration <= 0) {
    throw new Error("Invalid duration. Use --duration=SECONDS");
  }

  const exchangeAddress = process.env.EXCHANGE_ADDRESS;

  if (!exchangeAddress) {
    throw new Error("Missing EXCHANGE_ADDRESS in .env");
  }

  const exchange = await hre.ethers.getContractAt(
    "CPMMExchange",
    exchangeAddress
  );

  console.log("=================================");
  console.log("🚀 Starting Competition...");
  console.log("Duration:", duration, "seconds");

  const tx = await exchange.startCompetition(duration);
  await tx.wait();

  const now = Math.floor(Date.now() / 1000);
  const end = now + duration;

  console.log("✅ Competition started!");
  console.log("Start:", new Date(now * 1000).toLocaleString());
  console.log("End  :", new Date(end * 1000).toLocaleString());
  console.log("=================================");
}

main().catch((err) => {
  console.error("❌ Error starting competition:");
  console.error(err);
  process.exit(1);
});