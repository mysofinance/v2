import { ethers } from 'hardhat'

const { Console } = require('console')
const fs = require('fs')
const path = require('path')
const hre = require('hardhat')

const currDate = new Date()

const logfname =
  'deploy-log-' +
  currDate.toJSON().slice(0, 10) +
  '_' +
  currDate.getHours() +
  '-' +
  currDate.getMinutes() +
  '-' +
  currDate.getSeconds()

const logger = new Console({
  stdout: fs.createWriteStream(path.join(__dirname, `logs/${logfname}.txt`))
})

async function main() {
  /*
  const { DEPLOYER_PRIVATE_KEY } = process.env
  const provider = ethers.getDefaultProvider()
  deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider)
  */
  const [deployer] = await ethers.getSigners()
  await deployCore(deployer, logger)
}

async function deployCore(deployer: any, logger: any) {
  logger.log('Starting core contract deployment...\n')

  // deploy address registry (1/6)
  logger.log('======== Step 1 of 6 ========')
  logger.log('Deploying AddressRegistry...')
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.connect(deployer).deploy()
  await addressRegistry.deployed()
  logger.log('AddressRegistry deployed at:', addressRegistry.address, '\n')

  // deploy borrower gateway (2/6)
  logger.log('======== Step 2 of 6 ========')
  logger.log('Deploying BorrowerGateway...')
  const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
  const borrowerGateway = await BorrowerGateway.connect(deployer).deploy(addressRegistry.address)
  await borrowerGateway.deployed()
  logger.log('BorrowerGateway deployed at:', borrowerGateway.address, '\n')

  // deploy quote handler (3/6)
  logger.log('======== Step 3 of 6 ========')
  logger.log('Deploying QuoteHandler...')
  const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
  const quoteHandler = await QuoteHandler.connect(deployer).deploy(addressRegistry.address)
  await quoteHandler.deployed()
  logger.log('QuoteHandler deployed at:', quoteHandler.address, '\n')

  // deploy lender vault implementation (4/6)
  logger.log('======== Step 4 of 6 ========')
  logger.log('Deploying LenderVaultImplementation...')
  const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVaultImplementation = await LenderVaultImplementation.connect(deployer).deploy()
  await lenderVaultImplementation.deployed()
  logger.log('LenderVaultImplementation deployed at:', lenderVaultImplementation.address, '\n')

  // deploy LenderVaultFactory (5/6)
  logger.log('======== Step 5 of 6 ========')
  logger.log('Deploying LenderVaultFactory...')
  const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
  const lenderVaultFactory = await LenderVaultFactory.connect(deployer).deploy(
    addressRegistry.address,
    lenderVaultImplementation.address
  )
  await lenderVaultFactory.deployed()
  logger.log('LenderVaultFactory deployed at:', lenderVaultFactory.address, '\n')

  // valid initialization (6/6)
  logger.log('======== Step 6 of 6 ========')
  logger.log('Initializing AddressRegistry...')
  await addressRegistry
    .connect(deployer)
    .initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
  logger.log('AddressRegistry initialized.\n')

  logger.log('Core contract deployment completed.\n')

  if (hre.network.name == 'localhost') {
    await deployTestTokens(deployer, addressRegistry)
    await deployCallbacks(deployer, borrowerGateway, addressRegistry)
    await deployOralces(deployer, addressRegistry)
  }
}

async function deployTestTokens(deployer: any, addressRegistry: any) {
  logger.log('Loading deploy config with test token info...')
  let jsonData
  try {
    const jsonString = fs.readFileSync(path.join(__dirname, 'deploy-config.json'), 'utf-8')
    jsonData = JSON.parse(jsonString)
  } catch (err) {
    console.error(err)
  }

  const MyERC20 = await ethers.getContractFactory('MyERC20')
  const MyERC721 = await ethers.getContractFactory('MyERC721')

  logger.log('Deploying test tokens...\n')

  // deploy test tokens
  const testTokenParams = jsonData['testnet-deployment-config']['testnet-tokens']
  for (var testTokenParam of testTokenParams) {
    const Contract = testTokenParam['type'] == 'ERC20' ? MyERC20 : MyERC721
    Contract.connect(deployer)
    const testToken = await Contract.deploy(testTokenParam['name'], testTokenParam['symbol'], testTokenParam['decimals'])
    await testToken.deployed()
    logger.log(
      `Test token with name '${testTokenParam['name']}', symbol '${testTokenParam['symbol']} and '${testTokenParam['decimals']}' decimals deployed at: ${testToken.address}`
    )

    logger.log(`Setting whitelist state to '${testTokenParam['whitelistState']}'...`)
    await addressRegistry.connect(deployer).setWhitelistState([testToken.address], testTokenParam['whitelistState'])
    logger.log('Whitelist state set.\n')
  }

  logger.log('Test tokens deployed.\n')
}

async function deployCallbacks(deployer: any, borrowerGateway: any, addressRegistry: any) {
  logger.log('Deploying callback contracts...')

  logger.log('Deploying Balancer v2 callback...')
  const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
  await BalancerV2Looping.connect(deployer)
  const balancerV2Looping = await BalancerV2Looping.deploy(borrowerGateway.address)
  await balancerV2Looping.deployed()
  logger.log('Balancer v2 callback deployed at:', balancerV2Looping.address, '\n')

  logger.log('Deploying Uni v3 callback...')
  const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
  await UniV3Looping.connect(deployer)
  const uniV3Looping = await UniV3Looping.deploy(borrowerGateway.address)
  await uniV3Looping.deployed()
  logger.log('Uni v3 callback deployed at:', uniV3Looping.address, '\n')

  logger.log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([balancerV2Looping.address, uniV3Looping.address], 4)
  logger.log('Whitelist state set.\n')

  logger.log('Callback contract deployment completed.\n')
}

async function deployOralces(deployer: any, addressRegistry: any) {
  logger.log('Deploying callback contracts...')

  /*
  logger.log('Deploying Chainlink basic...')
  const usdcEthChainlinkAddr = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
  const paxgEthChainlinkAddr = '0x9b97304ea12efed0fad976fbecaad46016bf269e'
  const BASE_TOKEN = '0x12345678912efed0fad976fbecaad46016bf269e'
  const BASE_UNIT = '1000000000000000000'
  const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
  const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(deployer).deploy(
    ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
    [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
    BASE_TOKEN,
    BASE_UNIT
  )
  await chainlinkBasicImplementation.deployed()
  logger.log('Chainlink basic deployed at:', chainlinkBasicImplementation.address, '\n')

  logger.log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([chainlinkBasicImplementation.address], 2)
  logger.log('Whitelist state set.\n')
  */

  logger.log('Oracle contract deployment completed.\n')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
