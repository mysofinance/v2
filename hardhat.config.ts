import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import '@nomiclabs/hardhat-ethers'
require('hardhat-abi-exporter')
require('hardhat-contract-sizer')
require('dotenv').config()
require('solidity-coverage')

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
      const INFURA_API_KEY = process.env.INFURA_API_KEY
      if (INFURA_API_KEY === undefined) {
        throw new Error('Invalid hardhat.config.ts! Need to set `INFURA_API_KEY`!')
      }
      chainId = 1
      url = `https://mainnet.infura.io/v3/${INFURA_API_KEY}`
      blockNumber = 16640270 // 2023-02-16
      break
    case 'arbitrum':
      const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY
      if (ALCHEMY_API_KEY === undefined) {
        throw new Error('Invalid hardhat.config.ts! Need to set `ALCHEMY_API_KEY`!')
      }
      chainId = 42161
      url = `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
      blockNumber = 63771760 // 2023-02-23
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
  solidity: '0.8.19',
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
