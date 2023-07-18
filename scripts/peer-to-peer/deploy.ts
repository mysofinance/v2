import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { log, logFileNameWithPathP2P, loadP2PDeployConfig, saveP2PDeployedContracts } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')

async function main() {
  log(`Starting ${path.basename(__filename)}...`)
  log('Logging into:', logFileNameWithPathP2P)
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
  log(`Loading 'configs/deployConfig.json' with the following config data:`)
  const jsonDeployConfig = loadP2PDeployConfig()
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
    //const borrowerGateway = await ethers.getContractAt('BorrowerGateway', "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512")
    //const addressRegistry = await ethers.getContractAt('AddressRegistry', "0x5FbDB2315678afecb367f032d93F642f64180aa3")
    deployedContracts['deployedCallbacks'] = await deployCallbacks(deployer, borrowerGateway, addressRegistry)
  } else {
    log('Skipping callbacks.')
  }

  log('Checking whether to deploy compartment...')
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
    log('Skipping compartment.')
  }

  saveP2PDeployedContracts(deployedContracts)
}

async function deployTestnetTokens(deployer: any, addressRegistry: any, jsonDeployConfig: any, hardhatNetworkName: string) {
  const TestnetToken = await ethers.getContractFactory('TestnetToken')
  const RebasingTestnetToken = await ethers.getContractFactory('RebasingTestnetToken')

  log('Deploying testnet tokens...')

  const testnetTokenData = jsonDeployConfig[hardhatNetworkName]['deployTestnetTokens']
  if (testnetTokenData.length == 0) {
    log('Warning: no testnet token parameters configured in deployConfig.json!')
  }
  let tokenAddrs = []
  let tokenNamesToAddrs = []
  for (let testnetTokenParam of testnetTokenData) {
    log('Deploying token with the following parameters:', JSON.stringify(testnetTokenParam))
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

async function deployCompartments(deployer: any, addressRegistry: any, tokensThatRequireCompartment: any) {
  let res = []
  log('Deploying compartment contracts...')

  log('Deploying aToken compartment...')
  const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
  await AaveStakingCompartmentImplementation.connect(deployer)
  const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
  await aaveStakingCompartmentImplementation.deployed()
  res.push({ name: 'aaveStakingCompartmentImplementation', address: aaveStakingCompartmentImplementation.address })
  log('aToken compartment implementation deployed at:', aaveStakingCompartmentImplementation.address)

  log('Setting whitelist state of compartment...')
  // whitelist compartment
  await addressRegistry.connect(deployer).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)
  log('Whitelist state set.')

  log('Setting allowed tokens for compartment...')
  await addressRegistry
    .connect(deployer)
    .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, tokensThatRequireCompartment, true)
  log('Allowed tokens for compartment set.')

  log('Compartment contract deployment completed.')
  return res
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
