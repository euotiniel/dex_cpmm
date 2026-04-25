import hre from "hardhat";
import "dotenv/config";

async function main() {
  // Read duration from env var (set DURATION=300 in .env or prefix the command)
  const duration = parseInt(process.env.DURATION || "300");

  if (!duration || duration <= 0) throw new Error("Invalid duration. Set DURATION=<seconds> in .env or as env var");

  const exchangeAddress = process.env.EXCHANGE_ADDRESS;

  if (!exchangeAddress) throw new Error("Missing EXCHANGE_ADDRESS in .env");

  const exchange = await hre.ethers.getContractAt(
    "CPMMExchange",
    exchangeAddress
  );

  console.log("=================================");
  console.log("Starting Competition...");
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