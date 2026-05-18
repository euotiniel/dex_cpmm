import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "dotenv/config";

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },

  networks: {
    hardhat: {
      accounts: {
        count: 120,
      }
    },

    localhost: {
      url: process.env.RPC_URL,
    }
  }
};