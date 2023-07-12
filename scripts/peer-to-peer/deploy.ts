import { ethers } from 'hardhat'
import * as readline from 'readline/promises'

const { Console } = require('console')
const fs = require('fs')
const path = require('path')
const hre = require('hardhat')
const currDate = new Date()
const logFileName = `deploy-log-${currDate
  .toJSON()
  .slice(0, 10)}-${currDate.getHours()}-${currDate.getMinutes()}-${currDate.getSeconds()}`
const logFileNameWithPath = path.join(__dirname, `logs/${logFileName}.txt`)
const logger = new Console({
  stdout: fs.createWriteStream(logFileNameWithPath)
})

function formatConsoleDate(logMsg: string, ...rest: any) {
  const currDate = new Date()
  var hour = currDate.getHours()
  var minutes = currDate.getMinutes()
  var seconds = currDate.getSeconds()
  var milliseconds = currDate.getMilliseconds()

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
function consoleLog(logMsg: string, ...rest: any) {
  console.log(formatConsoleDate(logMsg, rest))
}
function consoleLogToFile(logMsg: string, ...rest: any) {
  logger.log(formatConsoleDate(logMsg, rest))
}

async function main() {
  consoleLog('Starting deploy script...')
  consoleLog('Logging into:', logFileNameWithPath)
  consoleLog('Loading signer info (check hardhat.config.ts)...')
  /*
  const provider = ethers.getDefaultProvider()
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider)
  const deployerAddr = await deployer.getAddress()
  */
  const [deployer] = await ethers.getSigners()
  const deployerBal = await ethers.provider.getBalance(deployer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name

  consoleLog('Running deployment script with the following deployer:', deployer.address)
  consoleLog('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  consoleLog(`Deploying to network '${network.name}' (Hardhat config network name '${hardhatNetworkName}')`)
  consoleLog(`Configured chain id '${network.chainId}'`)
  consoleLog(`Loading 'deploy-config.json' with the following config data:`)
  let jsonDeployConfig
  try {
    const jsonString = fs.readFileSync(path.join(__dirname, 'deploy-config.json'), 'utf-8')
    jsonDeployConfig = JSON.parse(jsonString)
  } catch (err) {
    console.error(err)
  }
  consoleLog(jsonDeployConfig)

  consoleLogToFile('Running deployment script with the following deployer:', deployer.address)
  consoleLogToFile('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  consoleLogToFile(`Deploying to network '${network.name}' (Hardhat config network name '${hardhatNetworkName}')`)
  consoleLogToFile(`Configured chain id '${network.chainId}'.`)
  consoleLogToFile(`Loading 'deploy-config.json' with the following config data:`, JSON.stringify(jsonDeployConfig))

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
        consoleLog('Deploy script completed.')
        break
      case 'n':
        consoleLog('Ending deployment script.')
        break
      default:
        consoleLog('Invalid input.')
        consoleLog('Ending deployment script.')
    }
  } finally {
    rl.close()
  }
}

async function deploy(deployer: any, hardhatNetworkName: string, jsonDeployConfig: any) {
  consoleLogToFile(`Starting core contract deployment to '${hardhatNetworkName}'...`)

  // deploy address registry (1/6)
  consoleLogToFile('======== Step 1 of 6 ========')
  consoleLogToFile('Deploying AddressRegistry...')
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.connect(deployer).deploy()
  await addressRegistry.deployed()
  consoleLogToFile('AddressRegistry deployed at:', addressRegistry.address)

  // deploy borrower gateway (2/6)
  consoleLogToFile('======== Step 2 of 6 ========')
  consoleLogToFile('Deploying BorrowerGateway...')
  const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
  const borrowerGateway = await BorrowerGateway.connect(deployer).deploy(addressRegistry.address)
  await borrowerGateway.deployed()
  consoleLogToFile('BorrowerGateway deployed at:', borrowerGateway.address)

  // deploy quote handler (3/6)
  consoleLogToFile('======== Step 3 of 6 ========')
  consoleLogToFile('Deploying QuoteHandler...')
  const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
  const quoteHandler = await QuoteHandler.connect(deployer).deploy(addressRegistry.address)
  await quoteHandler.deployed()
  consoleLogToFile('QuoteHandler deployed at:', quoteHandler.address)

  // deploy lender vault implementation (4/6)
  consoleLogToFile('======== Step 4 of 6 ========')
  consoleLogToFile('Deploying LenderVaultImplementation...')
  const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVaultImplementation = await LenderVaultImplementation.connect(deployer).deploy()
  await lenderVaultImplementation.deployed()
  consoleLogToFile('LenderVaultImplementation deployed at:', lenderVaultImplementation.address)

  // deploy LenderVaultFactory (5/6)
  consoleLogToFile('======== Step 5 of 6 ========')
  consoleLogToFile('Deploying LenderVaultFactory...')
  const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
  const lenderVaultFactory = await LenderVaultFactory.connect(deployer).deploy(
    addressRegistry.address,
    lenderVaultImplementation.address
  )
  await lenderVaultFactory.deployed()
  consoleLogToFile('LenderVaultFactory deployed at:', lenderVaultFactory.address)

  // valid initialization (6/6)
  consoleLogToFile('======== Step 6 of 6 ========')
  consoleLogToFile('Initializing AddressRegistry...')
  await addressRegistry
    .connect(deployer)
    .initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
  consoleLogToFile('AddressRegistry initialized.')

  consoleLogToFile('Core contract deployment completed.')

  if (hardhatNetworkName == 'localhost') {
    consoleLogToFile(`Running peripheral contract deployments for '${hardhatNetworkName}'...`)

    const testnetTokenData = await deployTestnetTokens(deployer, addressRegistry, jsonDeployConfig)

    if (jsonDeployConfig['testnet-deployment-config']['deployOracles']) {
      await deployTestnetOracles(deployer, addressRegistry, testnetTokenData)
    } else {
      consoleLogToFile('Skipping oracles.')
    }

    if (jsonDeployConfig['testnet-deployment-config']['deployCallbacks']) {
      await deployCallbacks(deployer, borrowerGateway, addressRegistry)
    } else {
      consoleLogToFile('Skipping oracles.')
    }

    if (jsonDeployConfig['testnet-deployment-config']['deployCompartments']) {
      await deployCompartments(deployer, borrowerGateway, addressRegistry)
    } else {
      consoleLogToFile('Skipping oracles.')
    }
  } else {
    consoleLogToFile(`No peripheral contract deployments for '${hardhatNetworkName}' defined.`)
  }
}

async function deployTestnetTokens(deployer: any, addressRegistry: any, jsonDeployConfig: any) {
  const TestnetToken = await ethers.getContractFactory('TestnetToken')

  consoleLogToFile('Deploying testnet tokens...')

  const testnetTokenData = jsonDeployConfig['testnet-deployment-config']['testnet-tokens']
  if (testnetTokenData.length == 0) {
    consoleLogToFile('Warning: no testnet token parameters configured in deploy-config.json!')
  }
  let tokenAddrs = []
  for (let testnetTokenParam of testnetTokenData) {
    consoleLogToFile('Deploying token with the following parameters:', JSON.stringify(testnetTokenParam))
    const testnetToken = await TestnetToken.connect(deployer).deploy(
      testnetTokenParam['name'],
      testnetTokenParam['symbol'],
      testnetTokenParam['decimals'],
      testnetTokenParam['initialMint'],
      testnetTokenParam['mintCoolDownPeriod'],
      testnetTokenParam['mintAmountPerCoolDownPeriod']
    )
    await testnetToken.deployed()
    consoleLogToFile(`Test token deployed at: ${testnetToken.address}`)
    tokenAddrs.push(testnetToken.address)
    testnetTokenParam['testnetTokenAddr'] = testnetToken.address
  }
  consoleLogToFile('Testnet tokens deployed.')

  consoleLogToFile('Whitelisting tokens with addresses:', tokenAddrs)
  await addressRegistry.connect(deployer).setWhitelistState(tokenAddrs, 1)
  consoleLogToFile('Tokens whitelisted.')

  return testnetTokenData
}

async function deployCallbacks(deployer: any, borrowerGateway: any, addressRegistry: any) {
  consoleLogToFile('Deploying callback contracts...')

  consoleLogToFile('Deploying Balancer v2 callback...')
  const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
  await BalancerV2Looping.connect(deployer)
  const balancerV2Looping = await BalancerV2Looping.deploy(borrowerGateway.address)
  await balancerV2Looping.deployed()
  consoleLogToFile('Balancer v2 callback deployed at:', balancerV2Looping.address)

  consoleLogToFile('Deploying Uni v3 callback...')
  const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
  await UniV3Looping.connect(deployer)
  const uniV3Looping = await UniV3Looping.deploy(borrowerGateway.address)
  await uniV3Looping.deployed()
  consoleLogToFile('Uni v3 callback deployed at:', uniV3Looping.address)

  consoleLogToFile('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([balancerV2Looping.address, uniV3Looping.address], 4)
  consoleLogToFile('Whitelist state set.')

  consoleLogToFile('Callback contract deployment completed.')
}

async function deployCompartments(deployer: any, addressRegistry: any, testnetTokenData: any) {}

async function deployTestnetOracles(deployer: any, addressRegistry: any, testnetTokenData: any) {
  consoleLogToFile('Deploying testnet oracle contract...')
  const TestnetOracle = await ethers.getContractFactory('TestnetOracle')
  const testnetOracle = await TestnetOracle.connect(deployer).deploy()
  await testnetOracle.deployed()
  consoleLogToFile('Testnet oracle deployed at:', testnetOracle.address)

  consoleLogToFile('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([testnetOracle.address], 2)
  consoleLogToFile('Whitelist state set.')

  consoleLogToFile('Testnet oracle contract deployment completed.')

  consoleLogToFile('Setting initial oracle prices for tokens...')

  if (testnetTokenData.length == 0) {
    consoleLogToFile('Warning: no testnet token!')
  }

  let tokenAddrs = []
  let initialOracleUsdcPrice = []
  for (let testnetTokenRowData of testnetTokenData) {
    consoleLogToFile(
      'Preparing testnet token oracle price according to following data:',
      JSON.stringify(testnetTokenRowData)
    )
    tokenAddrs.push(testnetTokenRowData['testnetTokenAddr'])
    initialOracleUsdcPrice.push(testnetTokenRowData['initialOracleUsdcPrice'])
  }

  consoleLogToFile('Initializing oracle with following initial price data:', tokenAddrs, initialOracleUsdcPrice)
  await testnetOracle.connect(deployer).setPrices(tokenAddrs, initialOracleUsdcPrice)
  consoleLogToFile('Initial oracle prices set.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
