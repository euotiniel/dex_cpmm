import hre from "hardhat";
import "dotenv/config";

async function main() {
  const duration = parseInt(process.env.DURATION || "300", 10);

  if (!duration || duration <= 0) {
    throw new Error("Invalid duration. Use DURATION=<seconds>");
  }

  const exchange = await hre.ethers.getContractAt(
    "CPMMExchange",
    process.env.EXCHANGE_ADDRESS
  );

  const tx = await exchange.startCompetition(duration);
  await tx.wait();

  const now = Math.floor(Date.now() / 1000);
  const end = now + duration;

  console.log("=================================");
  console.log("Competition started");
  console.log("Duration:", duration, "seconds");
  console.log("Start:", new Date(now * 1000).toLocaleString());
  console.log("End  :", new Date(end * 1000).toLocaleString());
  console.log("=================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});