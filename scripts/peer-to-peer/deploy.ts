import { ethers } from 'hardhat'
import * as readline from 'readline/promises'

const { Console } = require('console')
const fs = require('fs')
const path = require('path')
const hre = require('hardhat')
const currDate = new Date()
const fileName = `deploy-${currDate
  .toJSON()
  .slice(0, 10)}-${currDate.getHours()}-${currDate.getMinutes()}-${currDate.getSeconds()}`
const logFileNameWithPath = path.join(__dirname, `logs/log-${fileName}.txt`)
const logger = new Console({
  stdout: fs.createWriteStream(logFileNameWithPath)
})

function formatConsoleDate(logMsg: string, ...rest: any) {
  const currDate = new Date()
  const hour = currDate.getHours()
  const minutes = currDate.getMinutes()
  const seconds = currDate.getSeconds()
  const milliseconds = currDate.getMilliseconds()
  const timestampPrefix =
    '[' +
    (hour < 10 ? '0' + hour : hour) +
    ':' +
    (minutes < 10 ? '0' + minutes : minutes) +
    ':' +
    (seconds < 10 ? '0' + seconds : seconds) +
    '.' +
    ('00' + milliseconds).slice(-3) +
    '] '
  return timestampPrefix.concat(logMsg).concat(rest)
}

function log(logMsg: string, ...rest: any) {
  console.log(formatConsoleDate(logMsg, rest))
  logger.log(formatConsoleDate(logMsg, rest))
}

async function main() {
  log('Starting deploy script...')
  log('Logging into:', logFileNameWithPath)
  log('Loading signer info (check hardhat.config.ts)...')

  const [deployer] = await ethers.getSigners()
  const deployerBal = await ethers.provider.getBalance(deployer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  log('Running deployment script with the following deployer:', deployer.address)
  log('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  log(`Deploying to network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  log(`Loading 'deploy-config.json' with the following config data:`)
  let jsonDeployConfig
  try {
    const jsonString = fs.readFileSync(path.join(__dirname, 'deploy-config.json'), 'utf-8')
    jsonDeployConfig = JSON.parse(jsonString)
  } catch (err) {
    console.error(err)
  }
  log(JSON.stringify(jsonDeployConfig))

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    const answer = await rl.question('Do you want to continue the deployment script? [y/n] ', {
      signal: AbortSignal.timeout(15_000) // 10s timeout
    })

    switch (answer.toLowerCase()) {
      case 'y':
        await deploy(deployer, hardhatNetworkName, jsonDeployConfig)
        log('Deploy script completed.')
        break
      case 'n':
        log('Ending deployment script.')
        break
      default:
        log('Invalid input.')
        log('Ending deployment script.')
    }
  } finally {
    rl.close()
  }
}

async function deploy(deployer: any, hardhatNetworkName: string, jsonDeployConfig: any) {
  let deployedContracts: any = {}

  log(`Starting core contract deployment to '${hardhatNetworkName}'...`)

  // deploy address registry (1/6)
  log('======== Step 1 of 6 ========')
  log('Deploying AddressRegistry...')
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.connect(deployer).deploy()
  await addressRegistry.deployed()
  deployedContracts['addressRegistry'] = addressRegistry.address
  log('AddressRegistry deployed at:', addressRegistry.address)

  // deploy borrower gateway (2/6)
  log('======== Step 2 of 6 ========')
  log('Deploying BorrowerGateway...')
  const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
  const borrowerGateway = await BorrowerGateway.connect(deployer).deploy(addressRegistry.address)
  await borrowerGateway.deployed()
  deployedContracts['borrowerGateway'] = borrowerGateway.address
  log('BorrowerGateway deployed at:', borrowerGateway.address)

  // deploy quote handler (3/6)
  log('======== Step 3 of 6 ========')
  log('Deploying QuoteHandler...')
  const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
  const quoteHandler = await QuoteHandler.connect(deployer).deploy(addressRegistry.address)
  await quoteHandler.deployed()
  deployedContracts['quoteHandler'] = quoteHandler.address
  log('QuoteHandler deployed at:', quoteHandler.address)

  // deploy lender vault implementation (4/6)
  log('======== Step 4 of 6 ========')
  log('Deploying LenderVaultImplementation...')
  const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVaultImplementation = await LenderVaultImplementation.connect(deployer).deploy()
  await lenderVaultImplementation.deployed()
  deployedContracts['lenderVaultImplementation'] = lenderVaultImplementation.address
  log('LenderVaultImplementation deployed at:', lenderVaultImplementation.address)

  // deploy LenderVaultFactory (5/6)
  log('======== Step 5 of 6 ========')
  log('Deploying LenderVaultFactory...')
  const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
  const lenderVaultFactory = await LenderVaultFactory.connect(deployer).deploy(
    addressRegistry.address,
    lenderVaultImplementation.address
  )
  await lenderVaultFactory.deployed()
  deployedContracts['lenderVaultFactory'] = lenderVaultFactory.address
  log('LenderVaultFactory deployed at:', lenderVaultFactory.address)

  // valid initialization (6/6)
  log('======== Step 6 of 6 ========')
  log('Initializing AddressRegistry...')
  await addressRegistry
    .connect(deployer)
    .initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
  log('AddressRegistry initialized.')

  log('Core contract deployment completed.')

  log(`Running peripheral contract deployments for '${hardhatNetworkName}'...`)

  log('Checking whether to deploy testnet tokens...')
  let _testnetTokenData
  if (hardhatNetworkName in jsonDeployConfig && 'deployTestnetTokens' in jsonDeployConfig[hardhatNetworkName]) {
    const { testnetTokenData, tokenNamesToAddrs } = await deployTestnetTokens(
      deployer,
      addressRegistry,
      jsonDeployConfig,
      hardhatNetworkName
    )
    deployedContracts['deployedTestnetTokens'] = tokenNamesToAddrs
    _testnetTokenData = testnetTokenData
  } else {
    log('Skipping testnet tokens.')
  }

  log('Checking whether to deploy testnet oracle...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployTestnetOracle']) {
    deployedContracts['deployedTestnetOracle'] = await deployTestnetOracle(deployer, addressRegistry, _testnetTokenData)
  } else {
    log('Skipping testnet oracles.')
  }

  log('Checking whether to deploy callbacks...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployCallbacks']) {
    deployedContracts['deployedCallbacks'] = await deployCallbacks(deployer, borrowerGateway, addressRegistry)
  } else {
    log('Skipping callbacks.')
  }

  log('Checking whether to deploy compartment...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployCompartments']) {
    deployedContracts['deployedCompartments'] = await deployCompartments(deployer, borrowerGateway, addressRegistry)
  } else {
    log('Skipping compartment.')
  }

  log(`Save deployed contracts to ${path.join(__dirname, `output/contract-addrs-${fileName}.json`)}.`)
  fs.writeFile(
    path.join(__dirname, `output/contract-addrs-${fileName}.json`),
    JSON.stringify(deployedContracts),
    (err: any) => {
      if (err) {
        console.error(err)
        return
      }
    }
  )
}

async function deployTestnetTokens(deployer: any, addressRegistry: any, jsonDeployConfig: any, hardhatNetworkName: string) {
  const TestnetToken = await ethers.getContractFactory('TestnetToken')

  log('Deploying testnet tokens...')

  const testnetTokenData = jsonDeployConfig[hardhatNetworkName]['deployTestnetTokens']
  if (testnetTokenData.length == 0) {
    log('Warning: no testnet token parameters configured in deploy-config.json!')
  }
  let tokenAddrs = []
  let tokenNamesToAddrs = []
  for (let testnetTokenParam of testnetTokenData) {
    log('Deploying token with the following parameters:', JSON.stringify(testnetTokenParam))
    const testnetToken = await TestnetToken.connect(deployer).deploy(
      testnetTokenParam['name'],
      testnetTokenParam['symbol'],
      testnetTokenParam['decimals'],
      testnetTokenParam['initialMint'],
      testnetTokenParam['mintCoolDownPeriod'],
      testnetTokenParam['mintAmountPerCoolDownPeriod']
    )
    await testnetToken.deployed()
    log(`Test token deployed at: ${testnetToken.address}`)
    tokenNamesToAddrs.push({ name: testnetTokenParam['name'], address: testnetToken.address })
    tokenAddrs.push(testnetToken.address)
    testnetTokenParam['testnetTokenAddr'] = testnetToken.address
  }
  log('Testnet tokens deployed.')

  log('Whitelisting tokens with addresses:', tokenAddrs)
  await addressRegistry.connect(deployer).setWhitelistState(tokenAddrs, 1)
  log('Tokens whitelisted.')

  return { testnetTokenData, tokenNamesToAddrs }
}

async function deployCallbacks(deployer: any, borrowerGateway: any, addressRegistry: any) {
  let res = []
  log('Deploying callback contracts...')

  log('Deploying Balancer v2 callback...')
  const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
  await BalancerV2Looping.connect(deployer)
  const balancerV2Looping = await BalancerV2Looping.deploy(borrowerGateway.address)
  await balancerV2Looping.deployed()
  res.push({ name: 'balancerV2Looping', address: balancerV2Looping.address })
  log('Balancer v2 callback deployed at:', balancerV2Looping.address)

  log('Deploying Uni v3 callback...')
  const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
  await UniV3Looping.connect(deployer)
  const uniV3Looping = await UniV3Looping.deploy(borrowerGateway.address)
  await uniV3Looping.deployed()
  res.push({ name: 'uniV3Looping', address: uniV3Looping.address })
  log('Uni v3 callback deployed at:', uniV3Looping.address)

  log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([balancerV2Looping.address, uniV3Looping.address], 4)
  log('Whitelist state set.')

  log('Callback contract deployment completed.')

  return res
}

async function deployCompartments(deployer: any, addressRegistry: any, testnetTokenData: any) {
  log('Not implemented...')
  return []
}

async function deployTestnetOracle(deployer: any, addressRegistry: any, testnetTokenData: any) {
  log('Deploying testnet oracle contract...')
  const TestnetOracle = await ethers.getContractFactory('TestnetOracle')
  const testnetOracle = await TestnetOracle.connect(deployer).deploy()
  await testnetOracle.deployed()
  log('Testnet oracle deployed at:', testnetOracle.address)

  log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([testnetOracle.address], 2)
  log('Whitelist state set.')

  log('Testnet oracle contract deployment completed.')

  log('Setting initial oracle prices for tokens...')

  if (testnetTokenData.length == 0) {
    log('Warning: no testnet token!')
  }

  let tokenAddrs = []
  let initialOracleUsdcPrice = []
  for (let testnetTokenRowData of testnetTokenData) {
    log('Preparing testnet token oracle price according to following data:', JSON.stringify(testnetTokenRowData))
    tokenAddrs.push(testnetTokenRowData['testnetTokenAddr'])
    initialOracleUsdcPrice.push(testnetTokenRowData['initialOracleUsdcPrice'])
  }

  log('Initializing oracle with following initial price data:', tokenAddrs, initialOracleUsdcPrice)
  await testnetOracle.connect(deployer).setPrices(tokenAddrs, initialOracleUsdcPrice)
  log('Initial oracle prices set.')

  return testnetOracle.address
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
