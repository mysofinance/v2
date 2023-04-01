import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@nomiclabs/hardhat-ethers'
require('hardhat-abi-exporter')
require('hardhat-contract-sizer')
require('dotenv').config()
require('solidity-coverage')

export const INFURA_API_KEY = '764119145a6a4d09a1cf8f8c7a2c7b46' // todo: replace with env before resubmitting
export const ALCHEMY_API_KEY = 'QLXkHVq78U_cbV-q0TMWTH8-QmK2Zp3y' // todo: replace with env before resubmitting
export const MAINNET_BLOCK_NUMBER = 16640270 // 2023-02-16
export const ARBITRUM_BLOCK_NUMBER = 63771760 // 2023-02-23
export const ARBITRUM_CHAIN_ID = 31336
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '000000000000000000000000000000000000000000000000000000000000dead' // todo: replace with env before resubmitting

console.log(`Using hardhat config with GOERLI_URL=${ALCHEMY_API_KEY} and PRIVATE_KEY=${PRIVATE_KEY}`) // todo: remove before resubmitting

const forkMainnet = {
  chainId: 1,
  forking: {
    url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    blockNumber: MAINNET_BLOCK_NUMBER // 2023-02-16
  }
}

const forkArbitrum = {
  chainId: ARBITRUM_CHAIN_ID,
  forking: {
    url: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    blockNumber: ARBITRUM_BLOCK_NUMBER // 2023-02-23
  }
}

const config: HardhatUserConfig = {
  solidity: '0.8.19',
  networks: {
    hardhat: Number(process.env.HARDHAT_CHAIN_ID) === 31336 ? forkArbitrum : forkMainnet,
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [PRIVATE_KEY]
    }
  },
  mocha: {
    timeout: 100000000
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: []
  },
  abiExporter: {
    path: './data/abi',
    runOnCompile: true,
    clear: true,
    flat: false,
    only: [],
    spacing: 2,
    format: 'json'
  },
  gasReporter: {
    enabled: true
  }
}

export default config
