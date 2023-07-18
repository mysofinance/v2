import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { Logger, loadConfig, saveDeployedContracts } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)

async function main() {
  logger.log(`Starting ${scriptName}...`)
  logger.log('Loading signer info (check hardhat.config.ts)...')

  const [deployer] = await ethers.getSigners()
  const deployerBal = await ethers.provider.getBalance(deployer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  logger.log('Running deployment script with the following deployer:', deployer.address)
  logger.log('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  logger.log(`Deploying to network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  logger.log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  logger.log(`Loading 'configs/deployConfig.json' with the following config data:`)
  const jsonDeployConfig = loadConfig(__dirname, `/configs/${scriptName}.json`)
  logger.log(JSON.stringify(jsonDeployConfig))

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
        logger.log('Deploy script completed.')
        break
      case 'n':
        logger.log('Ending deployment script.')
        break
      default:
        logger.log('Invalid input.')
        logger.log('Ending deployment script.')
    }
  } finally {
    rl.close()
  }
}

async function deploy(deployer: any, hardhatNetworkName: string, jsonDeployConfig: any) {
  let deployedContracts: any = {}

  let addressRegistry
  let borrowerGateway
  logger.log('Checking whether to deploy core contracts...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployCore']) {
    logger.log(`Starting core contract deployment to '${hardhatNetworkName}'...`)

    // deploy address registry (1/6)
    logger.log('======== Step 1 of 6 ========')
    logger.log('Deploying AddressRegistry...')
    const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
    addressRegistry = await AddressRegistry.connect(deployer).deploy()
    await addressRegistry.deployed()
    deployedContracts['addressRegistry'] = addressRegistry.address
    logger.log('AddressRegistry deployed at:', addressRegistry.address)

    // deploy borrower gateway (2/6)
    logger.log('======== Step 2 of 6 ========')
    logger.log('Deploying BorrowerGateway...')
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    borrowerGateway = await BorrowerGateway.connect(deployer).deploy(addressRegistry.address)
    await borrowerGateway.deployed()
    deployedContracts['borrowerGateway'] = borrowerGateway.address
    logger.log('BorrowerGateway deployed at:', borrowerGateway.address)

    // deploy quote handler (3/6)
    logger.log('======== Step 3 of 6 ========')
    logger.log('Deploying QuoteHandler...')
    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    const quoteHandler = await QuoteHandler.connect(deployer).deploy(addressRegistry.address)
    await quoteHandler.deployed()
    deployedContracts['quoteHandler'] = quoteHandler.address
    logger.log('QuoteHandler deployed at:', quoteHandler.address)

    // deploy lender vault implementation (4/6)
    logger.log('======== Step 4 of 6 ========')
    logger.log('Deploying LenderVaultImplementation...')
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(deployer).deploy()
    await lenderVaultImplementation.deployed()
    deployedContracts['lenderVaultImplementation'] = lenderVaultImplementation.address
    logger.log('LenderVaultImplementation deployed at:', lenderVaultImplementation.address)

    // deploy LenderVaultFactory (5/6)
    logger.log('======== Step 5 of 6 ========')
    logger.log('Deploying LenderVaultFactory...')
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.connect(deployer).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()
    deployedContracts['lenderVaultFactory'] = lenderVaultFactory.address
    logger.log('LenderVaultFactory deployed at:', lenderVaultFactory.address)

    // valid initialization (6/6)
    logger.log('======== Step 6 of 6 ========')
    logger.log('Initializing AddressRegistry...')
    await addressRegistry
      .connect(deployer)
      .initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
    logger.log('AddressRegistry initialized.')

    logger.log('Core contract deployment completed.')
  } else {
    logger.log(`Skipping core contract deployment '${hardhatNetworkName}'.`)
    logger.log(`Loading pre-existing core contracts peripheral contracts...`)
    addressRegistry = await ethers.getContractAt(
      'AddressRegistry',
      jsonDeployConfig[hardhatNetworkName]['preExistingCore']['addressRegistry']
    )
    borrowerGateway = await ethers.getContractAt(
      'BorrowerGateway',
      jsonDeployConfig[hardhatNetworkName]['preExistingCore']['borrowerGateway']
    )
  }

  logger.log(`Running peripheral contract deployments for '${hardhatNetworkName}'...`)

  logger.log('Checking whether to deploy testnet tokens...')
  let _testnetTokenData
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployTestnetTokens']) {
    const { testnetTokenData, tokenNamesToAddrs } = await deployTestnetTokens(
      deployer,
      addressRegistry,
      jsonDeployConfig,
      hardhatNetworkName
    )
    deployedContracts['deployedTestnetTokens'] = tokenNamesToAddrs
    _testnetTokenData = testnetTokenData
  } else {
    logger.log('Skipping testnet tokens.')
  }

  logger.log('Checking whether to deploy testnet oracle...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployTestnetOracle']) {
    deployedContracts['deployedTestnetOracle'] = await deployTestnetOracle(deployer, addressRegistry, _testnetTokenData)
  } else {
    logger.log('Skipping testnet oracles.')
  }
  logger.log('Checking whether to deploy callbacks...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployCallbacks']) {
    //const borrowerGateway = await ethers.getContractAt('BorrowerGateway', "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512")
    //const addressRegistry = await ethers.getContractAt('AddressRegistry', "0x5FbDB2315678afecb367f032d93F642f64180aa3")
    deployedContracts['deployedCallbacks'] = await deployCallbacks(deployer, borrowerGateway, addressRegistry)
  } else {
    logger.log('Skipping callbacks.')
  }

  logger.log('Checking whether to deploy compartment...')
  if (hardhatNetworkName in jsonDeployConfig && jsonDeployConfig[hardhatNetworkName]['deployCompartments']) {
    const tokensThatRequireCompartment = []
    for (let testnetTokenParam of _testnetTokenData) {
      if (testnetTokenParam['isRebasing']) {
        for (let deployedTestnetTokens of deployedContracts['deployedTestnetTokens']) {
          if (testnetTokenParam['name'] == deployedTestnetTokens['name']) {
            tokensThatRequireCompartment.push(deployedTestnetTokens['address'])
          }
        }
      }
    }
    deployedContracts['deployedCompartments'] = await deployCompartments(
      deployer,
      addressRegistry,
      tokensThatRequireCompartment
    )
    //const addressRegistry = await ethers.getContractAt('AddressRegistry', "0x5FbDB2315678afecb367f032d93F642f64180aa3")
    //deployedContracts['deployedCompartments'] = await deployCompartments(deployer, addressRegistry, ["0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0"])
  } else {
    logger.log('Skipping compartment.')
  }

  logger.log('Saving contracts to json...')
  saveDeployedContracts(deployedContracts, path.join(__dirname, 'output/'), scriptName)
  logger.log('Saving completed.')
}

async function deployTestnetTokens(deployer: any, addressRegistry: any, jsonDeployConfig: any, hardhatNetworkName: string) {
  const TestnetToken = await ethers.getContractFactory('TestnetToken')
  const RebasingTestnetToken = await ethers.getContractFactory('RebasingTestnetToken')

  logger.log('Deploying testnet tokens...')

  let tokenAddrs = []
  let tokenNamesToAddrs = []

  const testnetTokenData = jsonDeployConfig[hardhatNetworkName]['testnetTokenConfig']
  if (testnetTokenData.length == 0) {
    logger.log('Warning: no testnet token parameters configured in deployConfig.json!')
  } else {
    for (let testnetTokenParam of testnetTokenData) {
      logger.log('Deploying token with the following parameters:', JSON.stringify(testnetTokenParam))
      const Token = testnetTokenParam['isRebasing'] ? RebasingTestnetToken : TestnetToken
      const testnetToken = await Token.connect(deployer).deploy(
        testnetTokenParam['name'],
        testnetTokenParam['symbol'],
        testnetTokenParam['decimals'],
        testnetTokenParam['initialMint'],
        testnetTokenParam['mintCoolDownPeriod'],
        testnetTokenParam['mintAmountPerCoolDownPeriod']
      )
      await testnetToken.deployed()
      logger.log(`Test token deployed at: ${testnetToken.address}`)
      tokenNamesToAddrs.push({ name: testnetTokenParam['name'], address: testnetToken.address })
      tokenAddrs.push(testnetToken.address)
      testnetTokenParam['testnetTokenAddr'] = testnetToken.address
    }
    logger.log('Testnet tokens deployed.')

    logger.log('Whitelisting tokens with addresses:', tokenAddrs)
    await addressRegistry.connect(deployer).setWhitelistState(tokenAddrs, 1)
    logger.log('Tokens whitelisted.')
  }
  return { testnetTokenData, tokenNamesToAddrs }
}

async function deployCallbacks(deployer: any, borrowerGateway: any, addressRegistry: any) {
  let res = []
  logger.log('Deploying callback contracts...')

  logger.log('Deploying Balancer v2 callback...')
  const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
  await BalancerV2Looping.connect(deployer)
  const balancerV2Looping = await BalancerV2Looping.deploy(borrowerGateway.address)
  await balancerV2Looping.deployed()
  res.push({ name: 'balancerV2Looping', address: balancerV2Looping.address })
  logger.log('Balancer v2 callback deployed at:', balancerV2Looping.address)

  logger.log('Deploying Uni v3 callback...')
  const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
  await UniV3Looping.connect(deployer)
  const uniV3Looping = await UniV3Looping.deploy(borrowerGateway.address)
  await uniV3Looping.deployed()
  res.push({ name: 'uniV3Looping', address: uniV3Looping.address })
  logger.log('Uni v3 callback deployed at:', uniV3Looping.address)

  logger.log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([balancerV2Looping.address, uniV3Looping.address], 4)
  logger.log('Whitelist state set.')

  logger.log('Callback contract deployment completed.')

  return res
}

async function deployCompartments(deployer: any, addressRegistry: any, tokensThatRequireCompartment: any) {
  let res = []
  logger.log('Deploying compartment contracts...')

  logger.log('Deploying aToken compartment...')
  const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
  await AaveStakingCompartmentImplementation.connect(deployer)
  const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
  await aaveStakingCompartmentImplementation.deployed()
  res.push({ name: 'aaveStakingCompartmentImplementation', address: aaveStakingCompartmentImplementation.address })
  logger.log('aToken compartment implementation deployed at:', aaveStakingCompartmentImplementation.address)

  logger.log('Setting whitelist state of compartment...')
  // whitelist compartment
  await addressRegistry.connect(deployer).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)
  logger.log('Whitelist state set.')

  logger.log('Setting allowed tokens for compartment...')
  await addressRegistry
    .connect(deployer)
    .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, tokensThatRequireCompartment, true)
  logger.log('Allowed tokens for compartment set.')

  logger.log('Compartment contract deployment completed.')
  return res
}

async function deployTestnetOracle(deployer: any, addressRegistry: any, testnetTokenData: any) {
  logger.log('Deploying testnet oracle contract...')
  const TestnetOracle = await ethers.getContractFactory('TestnetOracle')
  const testnetOracle = await TestnetOracle.connect(deployer).deploy()
  await testnetOracle.deployed()
  logger.log('Testnet oracle deployed at:', testnetOracle.address)

  logger.log('Setting whitelist state...')
  await addressRegistry.connect(deployer).setWhitelistState([testnetOracle.address], 2)
  logger.log('Whitelist state set.')

  logger.log('Testnet oracle contract deployment completed.')

  logger.log('Setting initial oracle prices for tokens...')

  if (testnetTokenData.length == 0) {
    logger.log('Warning: no testnet token!')
  }

  let tokenAddrs = []
  let initialOracleUsdcPrice = []
  for (let testnetTokenRowData of testnetTokenData) {
    logger.log('Preparing testnet token oracle price according to following data:', JSON.stringify(testnetTokenRowData))
    tokenAddrs.push(testnetTokenRowData['testnetTokenAddr'])
    initialOracleUsdcPrice.push(testnetTokenRowData['initialOracleUsdcPrice'])
  }

  logger.log('Initializing oracle with following initial price data:', tokenAddrs, initialOracleUsdcPrice)
  await testnetOracle.connect(deployer).setPrices(tokenAddrs, initialOracleUsdcPrice)
  logger.log('Initial oracle prices set.')

  return testnetOracle.address
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
