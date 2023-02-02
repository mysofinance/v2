import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-ethers";
require("dotenv").config();

//const INFURA_API_KEY = process.env.INFURA_API_KEY;
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '000000000000000000000000000000000000000000000000000000000000dead';

console.log(`Using hardhat config with GOERLI_URL=${ALCHEMY_API_KEY} and PRIVATE_KEY=${PRIVATE_KEY}`)

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  networks: {
    goerli: {
      url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_API_KEY}`, //url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`, //
      accounts: [PRIVATE_KEY]
    }
  }
};

export default config;
