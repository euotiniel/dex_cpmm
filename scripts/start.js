import hre from "hardhat";
import "dotenv/config";

async function main() 
{
  const exchange = await hre.ethers.getContractAt(
    "CPMMExchange",
    process.env.EXCHANGE_ADDRESS
  );

  const tx = await exchange.startCompetition();
  await tx.wait();


  console.log("=================================");
  console.log("Competition started");
  console.log("Vai terminar quando o professor quiser");
  console.log("=================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});