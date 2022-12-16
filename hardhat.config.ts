import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
require("dotenv").config();

const { ALCHEMY_API_KEY } = process.env

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
        blockNumber: 16198575 // 16.12.2022 17:53
      }
    }
  }
};

export default config;
