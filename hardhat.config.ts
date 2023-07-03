import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@nomiclabs/hardhat-ethers'
require('hardhat-abi-exporter')
require('hardhat-contract-sizer')
require('dotenv').config()
require('solidity-coverage')

export const getMainnetForkingConfig = () => {
  const INFURA_API_KEY = process.env.INFURA_API_KEY
  if (INFURA_API_KEY === undefined) {
    throw new Error('Invalid hardhat.config.ts! Need to set `INFURA_API_KEY`!')
  }
  const chainId = 1
  const url = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`
  const blockNumber = 16640270 // 2023-02-16
  return { chainId: chainId, url: url, blockNumber: blockNumber }
}

export const getRecentMainnetForkingConfig = () => {
  const INFURA_API_KEY = process.env.INFURA_API_KEY
  if (INFURA_API_KEY === undefined) {
    throw new Error('Invalid hardhat.config.ts! Need to set `INFURA_API_KEY`!')
  }
  const chainId = 1
  const url = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`
  const blockNumber = 17487097 // 2023-06-15
  return { chainId: chainId, url: url, blockNumber: blockNumber }
}

export const getArbitrumForkingConfig = () => {
  const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY
  if (ALCHEMY_API_KEY === undefined) {
    throw new Error('Invalid hardhat.config.ts! Need to set `ALCHEMY_API_KEY`!')
  }
  const chainId = 42161
  const url = `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  const blockNumber = 63771760 // 2023-02-23
  return { chainId: chainId, url: url, blockNumber: blockNumber }
}

const getForkingConfig = () => {
  // en var HARDHAT_CONFIG_NAME is used to run tests with different forking environments
  const HARDHAT_CONFIG_NAME = process.env.HARDHAT_CONFIG_NAME

  let url
  let blockNumber
  let chainId
  console.log(`                                             
  _|      _|  _|      _|    _|_|_|    _|_|    
  _|_|  _|_|    _|  _|    _|        _|    _|  
  _|  _|  _|      _|        _|_|    _|    _|  
  _|      _|      _|            _|  _|    _|  
  _|      _|      _|      _|_|_|      _|_|    
  `)
  switch (HARDHAT_CONFIG_NAME) {
    case undefined:
      console.log('NOTE: `HARDHAT_CONFIG_NAME` is undefined!')
      console.log('Using default/empty `hardhat` parameter in hardhat.config.ts!')
      console.log(
        'If you want to run hardhat with forking, please set `HARDHAT_CONFIG_NAME` environment variable and check hardhat.config.ts!\n'
      )
      console.log('Running npx hardhat test with the following config:')
      console.log('hardhat: {}')
      return { chainId: 31337 }
    case 'mainnet':
      const mainnetForkingConfig = getMainnetForkingConfig()
      chainId = mainnetForkingConfig.chainId
      url = mainnetForkingConfig.url
      blockNumber = mainnetForkingConfig.blockNumber
      break
    case 'arbitrum':
      const arbitrumForkingConfig = getArbitrumForkingConfig()
      chainId = arbitrumForkingConfig.chainId
      url = arbitrumForkingConfig.url
      blockNumber = arbitrumForkingConfig.blockNumber
      break
    case 'recent-mainnet':
      const recentMainnetForkingConfig = getRecentMainnetForkingConfig()
      chainId = recentMainnetForkingConfig.chainId
      url = recentMainnetForkingConfig.url
      blockNumber = recentMainnetForkingConfig.blockNumber
      break
    default:
      throw new Error(`Invalid hardhat.config.ts! Unknown HARDHAT_CONFIG_NAME '${HARDHAT_CONFIG_NAME}'!`)
  }
  console.log('Running npx hardhat test with the following config...')
  console.log('hardhat:')
  console.log({ chainId: chainId, forking: { url: url, blockNumber: blockNumber } })
  console.log('')
  return { chainId: chainId, forking: { url: url, blockNumber: blockNumber } }
}
export const HARDHAT_CHAIN_ID_AND_FORKING_CONFIG = getForkingConfig()

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.19',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      }
    }
  },
  networks: {
    hardhat: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG
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
