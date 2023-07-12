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
  console.log('Starting deploy script...')
  console.log('Logging into:', path.join(__dirname, `logs/${logfname}.txt`), '\n')
  /*
  const provider = ethers.getDefaultProvider()
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider)
  const deployerAddr = await deployer.getAddress()
  */
  const [deployer] = await ethers.getSigners()
  logger.log('Running deployment script with the following deployer:', deployer.address)
  logger.log('Deployer ETH balance:', await ethers.provider.getBalance(deployer.address), '\n')

  await deploy(deployer)

  console.log('Deploy script completed.')
}

async function deploy(deployer: any) {
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
    const testnetTokenData = await deployTestnetTokens(deployer, addressRegistry)
    await deployTestnetOracles(deployer, addressRegistry, testnetTokenData)
    await deployCallbacks(deployer, borrowerGateway, addressRegistry)
  }
}

async function deployTestnetTokens(deployer: any, addressRegistry: any) {
  logger.log('Loading deploy config with testnet token parameters...')
  let jsonData
  try {
    const jsonString = fs.readFileSync(path.join(__dirname, 'deploy-config.json'), 'utf-8')
    jsonData = JSON.parse(jsonString)
  } catch (err) {
    console.error(err)
  }

  const TestnetToken = await ethers.getContractFactory('TestnetToken')

  logger.log('Deploying testnet tokens...\n')

  const testnetTokenData = jsonData['testnet-deployment-config']['testnet-tokens']
  if (testnetTokenData.length == 0) {
    logger.log('Warning: no testnet token parameters configured in deploy-config.json!')
  }
  let tokenAddrs = []
  for (let testnetTokenParam of testnetTokenData) {
    logger.log('Deploying token with the following parameters:', testnetTokenParam)
    const testnetToken = await TestnetToken.connect(deployer).deploy(
      testnetTokenParam['name'],
      testnetTokenParam['symbol'],
      testnetTokenParam['decimals'],
      testnetTokenParam['initialMint'],
      testnetTokenParam['mintCoolDownPeriod'],
      testnetTokenParam['mintAmountPerCoolDownPeriod']
    )
    await testnetToken.deployed()
    logger.log(`Test token deployed at: ${testnetToken.address}\n`)
    tokenAddrs.push(testnetToken.address)
    testnetTokenParam['testnetTokenAddr'] = testnetToken.address
  }
  logger.log('Testnet tokens deployed.\n')

  logger.log('Whitelisting tokens with addresses:', tokenAddrs)
  await addressRegistry.connect(deployer).setWhitelistState(tokenAddrs, 1)
  logger.log('Tokens whitelisted.\n')

  return testnetTokenData
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

async function deployTestnetOracles(deployer: any, addressRegistry: any, testnetTokenData: any) {
  logger.log('Deploying testnet oracle contract...')
  const TestnetOracle = await ethers.getContractFactory('TestnetOracle')
  const testnetOracle = await TestnetOracle.connect(deployer).deploy()
  await testnetOracle.deployed()
  logger.log('Testnet oracle deployed at:', testnetOracle.address, '\n')

  logger.log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([testnetOracle.address], 2)
  logger.log('Whitelist state set.\n')

  logger.log('Testnet oracle contract deployment completed.\n')

  logger.log('Setting initial oracle prices for tokens...')

  if (testnetTokenData.length == 0) {
    logger.log('Warning: no testnet token!')
  }

  let tokenAddrs = []
  let initialOracleUsdcPrice = []
  for (let testnetTokenRowData of testnetTokenData) {
    logger.log('Preparing testnet token oracle price according to following data:', testnetTokenRowData)
    tokenAddrs.push(testnetTokenRowData['testnetTokenAddr'])
    initialOracleUsdcPrice.push(testnetTokenRowData['initialOracleUsdcPrice'])
  }

  logger.log('Initializing oracle with following initial price data:', tokenAddrs, initialOracleUsdcPrice)
  await testnetOracle.connect(deployer).setPrices(tokenAddrs, initialOracleUsdcPrice)
  logger.log('Initial oracle prices set.\n')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
