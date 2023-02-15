import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-ethers";
require('hardhat-abi-exporter');
require('hardhat-contract-sizer');
require("dotenv").config();

const INFURA_API_KEY = "764119145a6a4d09a1cf8f8c7a2c7b46"; // added for private repo, otherwise use process.env.INFURA_API_KEY;
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '000000000000000000000000000000000000000000000000000000000000dead';

console.log(`Using hardhat config with GOERLI_URL=${ALCHEMY_API_KEY} and PRIVATE_KEY=${PRIVATE_KEY}`)

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
        blockNumber: 15200000
      }
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [PRIVATE_KEY]
    }
  },
  mocha: {
    timeout: 100000000,
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: [],
  },
  abiExporter: {
    path: './data/abi',
    runOnCompile: true,
    clear: true,
    flat: false,
    only: [],
    spacing: 2,
    format: "json",
  },
  gasReporter: {
    enabled: true
  }
};

export default config;
