require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const POLYGON_RPC   = process.env.POLYGON_RPC   || "https://polygon-rpc.com";
const DEPLOYER_PK   = process.env.DEPLOYER_PK   || "";
const POLYGONSCAN   = process.env.POLYGONSCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    polygon: {
      url: POLYGON_RPC,
      accounts: DEPLOYER_PK ? [DEPLOYER_PK] : [],
      chainId: 137,
      gasPrice: "auto",
    },
    amoy: {
      url: process.env.AMOY_RPC || "https://rpc-amoy.polygon.technology",
      accounts: DEPLOYER_PK ? [DEPLOYER_PK] : [],
      chainId: 80002,
    },
  },
  etherscan: {
    apiKey: {
      polygon: POLYGONSCAN,
      polygonAmoy: POLYGONSCAN,
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  paths: {
    sources:   "./src",
    artifacts: "./artifacts",
    cache:     "./cache",
    tests:     "./test",
  },
};
