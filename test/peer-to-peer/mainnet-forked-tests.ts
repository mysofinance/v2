import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG, getMainnetForkingConfig } from '../../hardhat.config'
import {
  balancerV2VaultAbi,
  balancerV2PoolAbi,
  collTokenAbi,
  aavePoolAbi,
  crvRewardsDistributorAbi,
  chainlinkAggregatorAbi,
  gohmAbi,
  uniV2RouterAbi,
  uniV2Abi,
  payloadScheme
} from './helpers/abi'
import { fromReadableAmount, toReadableAmount, getOptimCollSendAndFlashBorrowAmount } from './helpers/uniV3'
import { SupportedChainId, Token } from '@uniswap/sdk-core'
import {
  createOnChainRequest,
  transferFeeHelper,
  calcLoanBalanceDelta,
  getExactLpTokenPriceInEth,
  getFairReservesPriceAndEthValue,
  getDeltaBNComparison,
  setupBorrowerWhitelist,
  encodeGlobalPolicy,
  encodePairPolicy
} from './helpers/misc'

// test config constants & vars
let snapshotId: String // use snapshot id to reset state before each test

// constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const ONE_PAXG = ethers.BigNumber.from(10).pow(18)
const ONE_GOHM = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const YEAR_IN_SECONDS = 31_536_000
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const UNI_V3_SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
const BALANCER_V2_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'

function getLoopingSendAmount(
  collTokenFromBorrower: number,
  loanPerColl: number,
  collTokenInDexPool: number,
  loanTokenInDexPool: number,
  swapFee: number
): number {
  const p = collTokenFromBorrower + loanTokenInDexPool / (loanPerColl * (1 - swapFee)) - collTokenInDexPool
  const q = -collTokenInDexPool * collTokenFromBorrower
  const collTokenReceivedFromDex = -p / 2 + Math.sqrt(Math.pow(p, 2) / 4 - q)
  return collTokenReceivedFromDex + collTokenFromBorrower
}

async function generateOffChainQuote({
  lenderVault,
  signer,
  collTokenAddr,
  loanTokenAddr,
  oracleAddr,
  quoteTuples,
  whitelistAuthority = ZERO_ADDR,
  offChainQuoteBodyInfo = {},
  generalQuoteInfo = {},
  customSignatures = [],
  earliestRepayTenor = 0,
  minLoan = 1,
  maxLoan = MAX_UINT256
}: {
  lenderVault: any
  signer: any
  collTokenAddr: any
  loanTokenAddr: any
  oracleAddr: any
  quoteTuples: any[]
  whitelistAuthority?: any
  offChainQuoteBodyInfo?: any
  generalQuoteInfo?: any
  customSignatures?: any[]
  earliestRepayTenor?: any
  minLoan?: any
  maxLoan?: any
}) {
  // lenderVault owner gives quote
  const blocknum = await ethers.provider.getBlockNumber()
  const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

  const quoteTuplesTree = StandardMerkleTree.of(
    quoteTuples.map(quoteTuple => Object.values(quoteTuple)),
    ['uint256', 'uint256', 'uint256', 'uint256']
  )
  const quoteTuplesRoot = quoteTuplesTree.root
  let offChainQuote = {
    generalQuoteInfo: {
      collToken: collTokenAddr,
      loanToken: loanTokenAddr,
      oracleAddr: oracleAddr,
      minLoan: minLoan,
      maxLoan: maxLoan,
      validUntil: timestamp + 60,
      earliestRepayTenor: earliestRepayTenor,
      borrowerCompartmentImplementation: ZERO_ADDR,
      isSingleUse: false,
      whitelistAddr: whitelistAuthority == ZERO_ADDR ? ZERO_ADDR : whitelistAuthority.address,
      isWhitelistAddrSingleBorrower: false,
      ...generalQuoteInfo
    },
    quoteTuplesRoot: quoteTuplesRoot,
    salt: ZERO_BYTES32,
    nonce: 0,
    compactSigs: [],
    ...offChainQuoteBodyInfo
  }

  const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
    offChainQuote.generalQuoteInfo,
    offChainQuote.quoteTuplesRoot,
    offChainQuote.salt,
    offChainQuote.nonce,
    lenderVault.address,
    HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId
  ])

  const payloadHash = ethers.utils.keccak256(payload)
  const signature = await signer.signMessage(ethers.utils.arrayify(payloadHash))
  const sig = ethers.utils.splitSignature(signature)
  const compactSig = sig.compact

  const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
  expect(recoveredAddr).to.equal(signer.address)

  // add sig to quote and pass to borrower
  offChainQuote.compactSigs = customSignatures.length != 0 ? customSignatures : [compactSig]
  return { offChainQuote, quoteTuplesTree, payloadHash }
}

describe('Peer-to-Peer: Forked Mainnet Tests', function () {
  before(async () => {
    console.log('Note: Running mainnet tests with the following forking config:')
    console.log(HARDHAT_CHAIN_ID_AND_FORKING_CONFIG)
    if (HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId !== 1) {
      console.warn('Invalid hardhat forking config! Expected `HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId` to be 1!')

      console.warn('Assuming that current test run is using `npx hardhat coverage`!')

      console.warn('Re-importing mainnet forking config from `hardhat.config.ts`...')
      const mainnetForkingConfig = getMainnetForkingConfig()

      console.warn('Overwriting chainId to hardhat default `31337` to make off-chain signing consistent...')
      HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId = 31337

      console.warn('Trying to manually switch network to forked mainnet for this test file...')
      await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [
          {
            forking: {
              jsonRpcUrl: mainnetForkingConfig.url,
              blockNumber: mainnetForkingConfig.blockNumber
            }
          }
        ]
      })
    }
  })

  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  async function setupTest() {
    const [lender, signer, borrower, team, whitelistAuthority] = await ethers.getSigners()
    /* ************************************ */
    /* DEPLOYMENT OF SYSTEM CONTRACTS START */
    /* ************************************ */
    // deploy address registry
    const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
    const addressRegistry = await AddressRegistry.connect(team).deploy()
    await addressRegistry.deployed()

    // deploy borrower gate way
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    const borrowerGateway = await BorrowerGateway.connect(team).deploy(addressRegistry.address)
    await borrowerGateway.deployed()

    // deploy quote handler
    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    const quoteHandler = await QuoteHandler.connect(team).deploy(addressRegistry.address)
    await quoteHandler.deployed()

    // deploy lender vault implementation
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(team).deploy()
    await lenderVaultImplementation.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // initialize address registry
    await addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault(ZERO_BYTES32)
    const lenderVaultAddrs = await addressRegistry.registeredVaults()
    const lenderVaultAddr = lenderVaultAddrs[0]
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // prepare USDC balances
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const USDC_MASTER_MINTER = '0xe982615d461dd5cd06575bbea87624fda4e3de17'
    const usdc = await ethers.getContractAt('IUSDC', USDC_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [USDC_MASTER_MINTER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_MASTER_MINTER]
    })
    const masterMinter = await ethers.getSigner(USDC_MASTER_MINTER)
    await usdc.connect(masterMinter).configureMinter(masterMinter.address, MAX_UINT128)
    await usdc.connect(masterMinter).mint(lender.address, MAX_UINT128)

    // prepare WETH balance
    const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const weth = await ethers.getContractAt('IWETH', WETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [borrower.address, '0x204FCE5E3E25026110000000'])
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(1) })

    // prepare PAXG balances
    const PAXG_ADDRESS = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'
    const SUPPLY_CONTROLLER = '0xE25a329d385f77df5D4eD56265babe2b99A5436e'
    const paxg = await ethers.getContractAt('IPAXG', PAXG_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [SUPPLY_CONTROLLER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [SUPPLY_CONTROLLER]
    })
    const supplyController = await ethers.getSigner(SUPPLY_CONTROLLER)

    await paxg.connect(supplyController).increaseSupply('800000000000000000000000000')
    await paxg.connect(supplyController).transfer(borrower.address, '800000000000000000000000000')

    // prepare LDO balances
    const LDO_ADDRESS = '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32'
    const LDO_HOLDER = '0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c'
    const ldo = await ethers.getContractAt('IWETH', LDO_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [LDO_HOLDER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [LDO_HOLDER]
    })

    const ldoHolder = await ethers.getSigner(LDO_HOLDER)

    await ldo.connect(ldoHolder).transfer(team.address, '10000000000000000000000')

    // prepare GOHM balances
    const GOHM_ADDRESS = '0x0ab87046fBb341D058F17CBC4c1133F25a20a52f'
    const GOHM_HOLDER = '0x168fa4917e7cD18f4eD3dc313c4975851cA9E5E7'
    const gohm = await ethers.getContractAt('IWETH', GOHM_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [GOHM_HOLDER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [GOHM_HOLDER]
    })

    const gohmHolder = await ethers.getSigner(GOHM_HOLDER)

    await gohm.connect(gohmHolder).transfer(team.address, '100000000000000000000')

    const wbtc = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    const btcToUSDChainlinkAddr = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
    const wBTCToBTCChainlinkAddr = '0xfdfd9c85ad200c506cf9e21f1fd8dd01932fbb23'

    // deploy balancer v2 callbacks
    const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
    await BalancerV2Looping.connect(lender)
    const balancerV2Looping = await BalancerV2Looping.deploy(borrowerGateway.address)
    await balancerV2Looping.deployed()

    // whitelist addrs
    await expect(addressRegistry.connect(lender).setWhitelistState([balancerV2Looping.address], 4)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
    await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 4)

    return {
      addressRegistry,
      borrowerGateway,
      quoteHandler,
      lenderVaultImplementation,
      lender,
      signer,
      borrower,
      team,
      whitelistAuthority,
      usdc,
      weth,
      paxg,
      ldo,
      gohm,
      wbtc,
      btcToUSDChainlinkAddr,
      wBTCToBTCChainlinkAddr,
      lenderVault,
      lenderVaultFactory,
      balancerV2Looping
    }
  }

  async function setupUniV3Test() {
    const [lender, borrower, team] = await ethers.getSigners()
    /* ************************************ */
    /* DEPLOYMENT OF SYSTEM CONTRACTS START */
    /* ************************************ */
    // deploy address registry
    const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
    const addressRegistry = await AddressRegistry.connect(team).deploy()
    await addressRegistry.deployed()

    // deploy borrower gate way
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    const borrowerGateway = await BorrowerGateway.connect(team).deploy(addressRegistry.address)
    await borrowerGateway.deployed()

    // deploy quote handler
    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    const quoteHandler = await QuoteHandler.connect(team).deploy(addressRegistry.address)
    await quoteHandler.deployed()

    // deploy lender vault implementation
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(team).deploy()
    await lenderVaultImplementation.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // initialize address registry
    await addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault(ZERO_BYTES32)
    const lenderVaultAddrs = await addressRegistry.registeredVaults()
    const lenderVaultAddr = lenderVaultAddrs[0]
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // prepare USDC balances
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const USDC_MASTER_MINTER = '0xe982615d461dd5cd06575bbea87624fda4e3de17'
    const usdc = await ethers.getContractAt('IUSDC', USDC_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [USDC_MASTER_MINTER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_MASTER_MINTER]
    })
    const masterMinter = await ethers.getSigner(USDC_MASTER_MINTER)
    await usdc.connect(masterMinter).configureMinter(masterMinter.address, MAX_UINT128)
    await usdc.connect(masterMinter).mint(lender.address, MAX_UINT128)

    // prepare WETH balance
    const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const weth = await ethers.getContractAt('IWETH', WETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [borrower.address, '0x204FCE5E3E25026110000000'])
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(10) })

    // deploy uni v3 callback
    const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
    await UniV3Looping.connect(lender)
    const uniV3Looping = await UniV3Looping.deploy(borrowerGateway.address)
    await uniV3Looping.deployed()

    // whitelist addrs
    await addressRegistry.connect(team).setWhitelistState([USDC_ADDRESS, WETH_ADDRESS], 1)
    await addressRegistry.connect(team).setWhitelistState([uniV3Looping.address], 4)

    return {
      borrowerGateway,
      quoteHandler,
      lender,
      borrower,
      usdc,
      weth,
      lenderVault,
      uniV3Looping
    }
  }

  describe('On-Chain Quote Testing', function () {
    it('Should validate correctly the quote loanPerCollUnitOrLtv', async function () {
      const { addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // deploy chainlinkOracleContract
      const usdcEthChainlinkAddr = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
      const paxgEthChainlinkAddr = '0x9b97304ea12efed0fad976fbecaad46016bf269e'
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
        [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
        weth.address,
        BASE
      )
      await chainlinkBasicImplementation.deployed()

      await expect(
        addressRegistry.connect(borrower).setWhitelistState([chainlinkBasicImplementation.address], 2)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

      // lender vault getter fails if no loans
      await expect(lenderVault.loan(0)).to.be.revertedWithCustomError(lenderVault, 'InvalidArrayIndex')

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.add(1),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')

      onChainQuote.generalQuoteInfo.whitelistAddr = team.address

      // now non-overcollateralized loan should work since whitelist authority is non-zero
      await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
    })

    it('Should validate correctly the wrong quote interestRatePctInBase', async function () {
      const { addressRegistry, quoteHandler, lender, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.sub(BASE).sub(BASE),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong quote tenor', async function () {
      const { addressRegistry, quoteHandler, lender, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY.mul(366),
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong quote validUntil', async function () {
      const { addressRegistry, quoteHandler, lender, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp - 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong quote minLoan/maxLoan', async function () {
      const { addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: 0,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')

      onChainQuote.generalQuoteInfo.maxLoan = ONE_USDC.mul(100).toNumber()

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong upfrontFeePctInBase', async function () {
      const { addressRegistry, quoteHandler, lender, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(10),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong quoteTuples length', async function () {
      const { addressRegistry, quoteHandler, lender, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: [],
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong quote collToken, loanToken', async function () {
      const { addressRegistry, quoteHandler, lender, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: weth.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong addOnChainQuote', async function () {
      const { addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(borrower.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler.connect(borrower).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')
      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 1)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([weth.address], 1)
      await addressRegistry.connect(team).setWhitelistState([usdc.address], 0)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.revertedWithCustomError(quoteHandler, 'OnChainQuoteAlreadyAdded')
    })

    it('Should validate correctly the wrong updateOnChainQuote', async function () {
      const {
        borrowerGateway,
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const compAddress = '0xc00e94Cb662C3520282E6f5717214004A7f26888'

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      let otherOnChainQuote = {
        ...onChainQuote,
        generalQuoteInfo: {
          ...onChainQuote.generalQuoteInfo,
          isSingleUse: true
        }
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, otherOnChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      const quoteHashAndValidUntilArr = await quoteHandler.getOnChainQuoteHistorySlice(lenderVault.address, 0, 2)

      expect(quoteHashAndValidUntilArr.length).to.equal(2)

      let newOnChainQuote = {
        ...onChainQuote,
        generalQuoteInfo: {
          ...onChainQuote.generalQuoteInfo,
          collToken: compAddress,
          loanToken: compAddress,
          isSingleUse: true
        }
      }

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 0)

      await expect(
        quoteHandler
          .connect(lender)
          .updateOnChainQuote(borrower.address, quoteHashAndValidUntilArr[0].quoteHash, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler
          .connect(borrower)
          .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')
      await expect(
        quoteHandler
          .connect(lender)
          .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

      newOnChainQuote.generalQuoteInfo.loanToken = usdc.address

      await expect(
        quoteHandler
          .connect(lender)
          .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([compAddress], 1)

      await expect(
        quoteHandler
          .connect(lender)
          .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 1)

      onChainQuote.generalQuoteInfo.loanToken = compAddress

      await expect(
        quoteHandler.connect(lender).updateOnChainQuote(lenderVault.address, ZERO_BYTES32, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnknownOnChainQuote')

      onChainQuote.generalQuoteInfo.loanToken = usdc.address

      // should revert if you add new quote same as old quote
      await expect(
        quoteHandler
          .connect(lender)
          .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'OnChainQuoteAlreadyAdded')
      // should revert if you add new quote which is already added
      await expect(
        quoteHandler
          .connect(lender)
          .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, otherOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'OnChainQuoteAlreadyAdded')

      const updateOnChainQuoteTransaction = await quoteHandler
        .connect(lender)
        .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash, newOnChainQuote)

      const updateOnChainQuoteReceipt = await updateOnChainQuoteTransaction.wait()

      const borrowQuoteDeletedEvent = updateOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'OnChainQuoteDeleted'
      })

      expect(borrowQuoteDeletedEvent).to.be.not.undefined

      const borrowQuoteAddedEvent = updateOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'OnChainQuoteAdded'
      })

      expect(borrowQuoteAddedEvent).to.be.not.undefined

      const quoteHashAndValidUntilArrAfterUpdate = await quoteHandler.getOnChainQuoteHistorySlice(lenderVault.address, 0, 3)

      expect(quoteHashAndValidUntilArrAfterUpdate.length).to.equal(3)

      await quoteHandler
        .connect(lender)
        .updateOnChainQuote(lenderVault.address, quoteHashAndValidUntilArrAfterUpdate[2].quoteHash, onChainQuote)

      expect(await quoteHandler.getOnChainQuoteHistorySlice(lenderVault.address, 0, 4)).to.have.lengthOf(4)

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      expect(borrowEvent).to.not.be.undefined
    })

    it('Should handle unlocking collateral correctly (1/3)', async function () {
      const {
        borrowerGateway,
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault,
        uniV3Looping
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      expect(borrowEvent).to.not.be.undefined

      // test partial repays with no compartment
      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']

      // lender transfers usdc so borrower can repay (lender is like a faucet)
      await usdc.connect(lender).transfer(borrower.address, 10000000000)

      const collBalPreRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPreRepay = await lenderVault.lockedAmounts(weth.address)
      const tokenBalanceAndLockedAmountsPreRepay = await lenderVault
        .connect(lender)
        .getTokenBalancesAndLockedAmounts([weth.address])
      expect(tokenBalanceAndLockedAmountsPreRepay._lockedAmounts[0]).to.equal(lockedVaultCollPreRepay)

      // borrower approves borrower gateway for repay
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: loanId,
          targetRepayAmount: repayAmount.div(2),
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
      )

      const collBalPostRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostRepay = await lenderVault.lockedAmounts(weth.address)

      expect(collBalPreRepayVault.sub(collBalPostRepayVault)).to.equal(initCollAmount.div(2))
      expect(lockedVaultCollPreRepay.sub(lockedVaultCollPostRepay)).to.equal(collBalPreRepayVault.sub(collBalPostRepayVault))

      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // only owner can unlock
      await expect(lenderVault.connect(borrower).unlockCollateral(weth.address, [loanId])).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // cannot pass empty loan array to bypass valid token check
      await expect(lenderVault.connect(lender).unlockCollateral(weth.address, [])).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidArrayLength'
      )

      // valid unlock
      await lenderVault.connect(lender).unlockCollateral(weth.address, [loanId])

      // revert if trying to unlock twice
      await expect(lenderVault.connect(lender).unlockCollateral(weth.address, [loanId])).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidCollUnlock'
      )

      const collBalPostUnlock = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostUnlock = await lenderVault.lockedAmounts(weth.address)

      await expect(lenderVault.connect(lender).getTokenBalancesAndLockedAmounts([])).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidArrayLength'
      )
      await expect(lenderVault.connect(lender).getTokenBalancesAndLockedAmounts([ZERO_ADDR])).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      const tokenBalanceAndLockedAmountsPostRepay = await lenderVault
        .connect(lender)
        .getTokenBalancesAndLockedAmounts([weth.address])
      expect(tokenBalanceAndLockedAmountsPostRepay._lockedAmounts[0]).to.equal(0)

      // set whitelist state to compartmentalized token and should still go through
      await addressRegistry.connect(team).setWhitelistState([weth.address], 5)

      await lenderVault.connect(lender).getTokenBalancesAndLockedAmounts([weth.address])
      expect(tokenBalanceAndLockedAmountsPostRepay._lockedAmounts[0]).to.equal(0)

      // no change in collateral balance
      expect(collBalPostUnlock).to.equal(collBalPostRepayVault)
      // all coll has been unlocked
      expect(lockedVaultCollPreRepay.sub(lockedVaultCollPostUnlock)).to.equal(initCollAmount)
    })

    it('Should handle unlocking collateral correctly (2/3)', async function () {
      const {
        borrowerGateway,
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      // top up weth balance
      await weth.connect(borrower).deposit({ value: ONE_WETH.mul(20) })

      // do 20 borrows, get receipt for last one
      let totalCollSent = ethers.BigNumber.from(0)
      let totalUpfrontFees = ethers.BigNumber.from(0)
      let totalLockedColl = ethers.BigNumber.from(0)
      for (var i = 0; i < 19; i++) {
        totalCollSent = totalCollSent.add(borrowInstructions.collSendAmount)
        const borrowWithOnChainQuoteTransaction = await borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
        const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()
        const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
          return x.event === 'Borrowed'
        })
        const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']
        totalLockedColl = totalLockedColl.add(initCollAmount)
        totalUpfrontFees = totalUpfrontFees.add(borrowInstructions.collSendAmount.sub(initCollAmount))
      }
      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()
      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })
      expect(borrowEvent).to.not.be.undefined
      // get last loan expiry
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']

      // update local vars
      totalCollSent = totalCollSent.add(borrowInstructions.collSendAmount)
      totalLockedColl = totalLockedColl.add(initCollAmount)
      totalUpfrontFees = totalUpfrontFees.add(borrowInstructions.collSendAmount.sub(initCollAmount))

      // check locked amounts
      const lockedVaultCollPreRepay = await lenderVault.lockedAmounts(weth.address)
      expect(lockedVaultCollPreRepay).to.equal(totalLockedColl)

      // borrower approves borrower gateway for repay
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // move forward past last loan expiry
      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // valid unlock
      const preVaultBal = await weth.balanceOf(lenderVault.address)
      const preOwnerBal = await weth.balanceOf(lender.address)
      await lenderVault.connect(lender).unlockCollateral(weth.address, [...Array(20).keys()])
      const postVaultBal = await weth.balanceOf(lenderVault.address)
      const postOwnerBal = await weth.balanceOf(lender.address)
      const postLockedAmounts = await lenderVault.lockedAmounts(weth.address)
      expect(preVaultBal.sub(postVaultBal)).to.be.equal(0)
      expect(postOwnerBal.sub(preOwnerBal)).to.be.equal(0)
      //const totalUpfrontFeesExpected = quoteTuples[0].upfrontFeePctInBase.mul(totalCollSent).div(BASE)
      expect(preVaultBal).to.equal(totalLockedColl.add(totalUpfrontFees))
      expect(postLockedAmounts).to.be.equal(0)

      // revert if trying to unlock twice
      await expect(
        lenderVault.connect(lender).unlockCollateral(weth.address, [...Array(20).keys()])
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidCollUnlock')
      await expect(lenderVault.connect(lender).unlockCollateral(weth.address, [1, 4, 10])).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidCollUnlock'
      )
    })

    it('Should handle unlocking collateral correctly (3/3)', async function () {
      const {
        borrowerGateway,
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      // top up weth balance
      await weth.connect(borrower).deposit({ value: ONE_WETH.mul(20) })

      // do 20 borrows, get receipt for last one
      let totalLockedColl = ethers.BigNumber.from(0)
      for (var i = 0; i < 19; i++) {
        const borrowWithOnChainQuoteTransaction = await borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
        const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()
        const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
          return x.event === 'Borrowed'
        })
        const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']
        totalLockedColl = totalLockedColl.add(initCollAmount)
      }
      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()
      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })
      expect(borrowEvent).to.not.be.undefined
      // get last loan expiry
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']
      totalLockedColl = totalLockedColl.add(initCollAmount)

      // check locked amounts
      const lockedVaultCollPreRepay = await lenderVault.lockedAmounts(weth.address)
      expect(lockedVaultCollPreRepay).to.equal(totalLockedColl)

      // borrower approves borrower gateway for repay
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // move forward past last loan expiry
      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // valid unlock
      const preVaultBal = await weth.balanceOf(lenderVault.address)
      const preOwnerBal = await weth.balanceOf(lender.address)
      await lenderVault.connect(lender).unlockCollateral(weth.address, [...Array(20).keys()])
      const postVaultBal = await weth.balanceOf(lenderVault.address)
      const postOwnerBal = await weth.balanceOf(lender.address)
      const postLockedAmounts = await lenderVault.lockedAmounts(weth.address)
      expect(preVaultBal).to.be.equal(postVaultBal)
      expect(preOwnerBal).to.be.equal(postOwnerBal)
      expect(postLockedAmounts).to.be.equal(0)

      // check withdraw
      const preVaultBal2 = await weth.balanceOf(lenderVault.address)
      const preOwnerBal2 = await weth.balanceOf(lender.address)
      const withdrawAmount = preVaultBal2
      await lenderVault.connect(lender).withdraw(weth.address, withdrawAmount)
      const postVaultBal2 = await weth.balanceOf(lenderVault.address)
      const postOwnerBal2 = await weth.balanceOf(lender.address)
      expect(preVaultBal2.sub(postVaultBal2)).to.be.equal(postOwnerBal2.sub(preOwnerBal2))
      expect(preVaultBal2.sub(postVaultBal2)).to.be.equal(withdrawAmount)
      expect(postLockedAmounts).to.be.equal(0)
      expect(postVaultBal2).to.be.equal(0)
    })

    it('Should handle multiple repays correctly', async function () {
      const {
        borrowerGateway,
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const upfrontFeePctInBase = BASE.mul(1).div(100)
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: upfrontFeePctInBase,
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      expect(borrowEvent).to.not.be.undefined

      // test partial repays with no compartment
      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']

      // lender transfers usdc so borrower can repay (lender is like a faucet)
      await usdc.connect(lender).transfer(borrower.address, 10000000000)

      const collBalPreRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPreRepay = await lenderVault.lockedAmounts(weth.address)
      const tokenBalanceAndLockedAmountsPreRepay = await lenderVault
        .connect(lender)
        .getTokenBalancesAndLockedAmounts([weth.address])
      expect(tokenBalanceAndLockedAmountsPreRepay._lockedAmounts[0]).to.equal(lockedVaultCollPreRepay)

      // borrower approves borrower gateway for repay
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: loanId,
          targetRepayAmount: repayAmount.div(2),
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
      )

      // after first repay, half the init collateral should be unlocked and sent from vault
      const collBalPostFirstRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostRepay = await lenderVault.lockedAmounts(weth.address)

      expect(collBalPreRepayVault.sub(collBalPostFirstRepayVault)).to.equal(initCollAmount.div(2))
      expect(lockedVaultCollPreRepay.sub(lockedVaultCollPostRepay)).to.equal(
        collBalPreRepayVault.sub(collBalPostFirstRepayVault)
      )

      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: loanId,
          targetRepayAmount: repayAmount.div(4),
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
      )

      // second repay should unlock another quarter of the init collateral, so only 1/4 should be locked
      const collBalPostSecondRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostSecondRepay = await lenderVault.lockedAmounts(weth.address)

      expect(collBalPostFirstRepayVault.sub(collBalPostSecondRepayVault)).to.equal(initCollAmount.div(4))
      expect(lockedVaultCollPostRepay.sub(lockedVaultCollPostSecondRepay)).to.equal(
        collBalPostFirstRepayVault.sub(collBalPostSecondRepayVault)
      )
      expect(lockedVaultCollPostSecondRepay).to.equal(initCollAmount.div(4))

      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: loanId,
          targetRepayAmount: repayAmount.div(16),
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
      )

      // third repay should unlock 1/16 of the init collateral, so only 3/16 should be locked
      const collBalPostThirdRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostThirdRepay = await lenderVault.lockedAmounts(weth.address)

      expect(collBalPostSecondRepayVault.sub(collBalPostThirdRepayVault)).to.equal(initCollAmount.div(16))
      expect(lockedVaultCollPostSecondRepay.sub(lockedVaultCollPostThirdRepay)).to.equal(
        collBalPostSecondRepayVault.sub(collBalPostThirdRepayVault)
      )
      expect(lockedVaultCollPostThirdRepay).to.equal(initCollAmount.mul(3).div(16))

      // final repay should unlock remaining 3/16 of collateral
      const loan = await lenderVault.loan(loanId)
      expect(loan.initRepayAmount.sub(loan.amountRepaidSoFar)).to.be.equal(repayAmount.mul(3).div(16))
      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: loanId,
          targetRepayAmount: repayAmount.mul(3).div(16),
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
      )
      const collBalPostFourthRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostFourthRepay = await lenderVault.lockedAmounts(weth.address)
      expect(collBalPostFourthRepayVault).to.equal(collSendAmount.mul(upfrontFeePctInBase).div(BASE))
      expect(lockedVaultCollPostFourthRepay).to.equal(0)
    })

    it('Should revert on invalid repays', async function () {
      const {
        borrowerGateway,
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10000000000), // set super high interest rate to test rounding error on repay
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: 1,
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH.div(1000000)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      expect(borrowEvent).to.not.be.undefined

      // test partial repays with no compartment
      const loanId = borrowEvent?.args?.['loanId']

      // borrower approves borrower gateway for repay
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // check revert on zero repay amount
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: 0,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      ).to.be.revertedWithCustomError(borrowerGateway, 'InvalidRepayAmount')

      // check revert if reclaim amount is zero (due to rounding)
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: 1,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      ).to.be.revertedWithCustomError(borrowerGateway, 'ReclaimAmountIsZero')
    })

    it('Should validate correctly the wrong deleteOnChainQuote', async function () {
      const { addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      const quoteHashAndValidUntilArr = await quoteHandler.getOnChainQuoteHistorySlice(lenderVault.address, 0, 1)
      // revert if index out of bounds
      await expect(quoteHandler.getOnChainQuoteHistory(lenderVault.address, 5)).to.be.revertedWithCustomError(
        quoteHandler,
        'InvalidArrayIndex'
      )
      const onChainQuoteHistoryElem = await quoteHandler.getOnChainQuoteHistory(lenderVault.address, 0)
      expect(quoteHashAndValidUntilArr.length).to.equal(1)
      expect(quoteHashAndValidUntilArr[0].quoteHash).to.be.equal(onChainQuoteHistoryElem.quoteHash)
      expect(quoteHashAndValidUntilArr[0].validUntil).to.be.equal(onChainQuoteHistoryElem.validUntil)

      await expect(
        quoteHandler.connect(lender).deleteOnChainQuote(borrower.address, quoteHashAndValidUntilArr[0].quoteHash)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler.connect(borrower).deleteOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')
      await expect(
        quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, ZERO_BYTES32)
      ).to.revertedWithCustomError(quoteHandler, 'UnknownOnChainQuote')

      await expect(
        quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash)
      ).to.emit(quoteHandler, 'OnChainQuoteDeleted')
    })
  })

  describe('Callback Testing', function () {
    it('Should handle looping via Uni V3 correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault, uniV3Looping } =
        await setupUniV3Test()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // prepare looping
      const dexSwapTokenIn = new Token(SupportedChainId.MAINNET, usdc.address, 6, 'USDC', 'USD//C')
      const dexSwapTokenOut = new Token(SupportedChainId.MAINNET, weth.address, 18, 'WETH', 'Wrapped Ether')
      const initCollUnits = 10
      const transferFee = 0
      const poolFee = 3000 // assume "medium" uni v3 swap fee
      const { finalTotalPledgeAmount, minSwapReceive, finalFlashBorrowAmount } = await getOptimCollSendAndFlashBorrowAmount(
        initCollUnits,
        transferFee,
        toReadableAmount(quoteTuples[0].loanPerCollUnitOrLtv.toString(), dexSwapTokenIn.decimals),
        dexSwapTokenIn,
        dexSwapTokenOut,
        poolFee
      )

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT128)

      // borrower approves and executes quote
      const collSendAmountBn = fromReadableAmount(initCollUnits + minSwapReceive, dexSwapTokenOut.decimals)
      const slippage = 0.01
      const minSwapReceiveBn = fromReadableAmount(minSwapReceive * (1 - slippage), dexSwapTokenOut.decimals)
      const quoteTupleIdx = 0
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const deadline = MAX_UINT128
      const callbackAddr = uniV3Looping.address

      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint24'],
        [minSwapReceiveBn, deadline, poolFee]
      )
      const borrowInstructions = {
        collSendAmount: collSendAmountBn,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // pre callback allowances
      let preWethAllowance = await weth.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)
      let preUsdcAllowance = await usdc.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.emit(lenderVault, 'QuoteProcessed')

      // post callback allowances
      let postWethAllowance = await weth.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)
      let postUsdcAllowance = await usdc.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)

      // check callback allowances are zero
      expect(preWethAllowance).to.be.equal(0)
      expect(preUsdcAllowance).to.be.equal(0)
      expect(postWethAllowance).to.be.equal(0)
      expect(postUsdcAllowance).to.be.equal(0)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const borrowerWethBalDiffActual = borrowerWethBalPre.add(borrowerWethBalPost)
      const borrowerWethBalDiffExpected = borrowerWethBalPre.sub(collSendAmountBn)
      const PRECISION = 10000
      const borrowerWethBalDiffComparison = Math.abs(
        Number(
          borrowerWethBalDiffActual
            .sub(borrowerWethBalDiffExpected)
            .mul(PRECISION)
            .div(borrowerWethBalDiffActual)
            .div(ONE_WETH)
            .toString()
        ) / PRECISION
      )
      expect(borrowerWethBalDiffComparison).to.be.lessThan(0.01)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(0) // borrower: no usdc change as all swapped for weth
      expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(collSendAmountBn)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(
        onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmountBn).div(ONE_WETH)
      )

      // pre callback allowances
      preWethAllowance = await weth.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)
      preUsdcAllowance = await usdc.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)

      // check repay callback reverts when called by anyone else than borrower gateway
      const loanId = 0
      const loan = await lenderVault.loan(loanId)
      await expect(uniV3Looping.connect(borrower).repayCallback(loan, callbackData)).to.be.revertedWithCustomError(
        uniV3Looping,
        'InvalidSender'
      )
      await expect(uniV3Looping.connect(lender).repayCallback(loan, callbackData)).to.be.revertedWithCustomError(
        uniV3Looping,
        'InvalidSender'
      )

      // check repay
      const minSwapReceiveLoanToken = 0
      const callbackDataRepay = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint24'],
        [minSwapReceiveLoanToken, deadline, poolFee]
      )

      // borrower approves borrower gateway for repay
      await usdc.connect(borrower).approve(borrowerGateway.address, loan.initRepayAmount)

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: 0,
            targetRepayAmount: loan.initRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackDataRepay
          },
          lenderVault.address
        )
      )
        .to.emit(borrowerGateway, 'Repaid')
        .withArgs(lenderVault.address, loanId, loan.initRepayAmount)

      // post callback allowances
      postWethAllowance = await weth.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)
      postUsdcAllowance = await usdc.allowance(callbackAddr, UNI_V3_SWAP_ROUTER)

      // check callback allowances are zero
      expect(preWethAllowance).to.be.equal(0)
      expect(preUsdcAllowance).to.be.equal(0)
      expect(postWethAllowance).to.be.equal(0)
      expect(postUsdcAllowance).to.be.equal(0)
    })

    it('Should handle looping via Balancer correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault,
        balancerV2Looping
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // Balancer V2 integration: calculate which send amount would be needed to max. lever up in 1-click
      const poolAddr = '0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8'
      const poolId = '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019' // look up via getPoolId() on bal pool
      const balancerV2Pool = await new ethers.Contract(poolAddr, balancerV2PoolAbi, team) // could be any signer, here used team

      const PRECISION = 10000
      const collBuffer = BASE.mul(990).div(1000)
      const initCollFromBorrower = ONE_WETH.mul(collBuffer).div(BASE)
      const initCollFromBorrowerNumber = Number(initCollFromBorrower.mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanPerColl =
        Number(onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
      const swapFee = Number((await balancerV2Pool.getSwapFeePercentage()).mul(PRECISION).div(BASE).toString()) / PRECISION
      const balancerV2Vault = await new ethers.Contract(BALANCER_V2_VAULT, balancerV2VaultAbi, team) // could be any signer, here used team
      const balancerV2PoolTokens = await balancerV2Vault.getPoolTokens(poolId)
      const collTokenInDexPool =
        Number(
          (balancerV2PoolTokens.tokens[0] == weth.address
            ? balancerV2PoolTokens.balances[0]
            : balancerV2PoolTokens.balances[1]
          )
            .mul(PRECISION)
            .div(ONE_WETH)
            .toString()
        ) / PRECISION
      const loanTokenInDexPool =
        Number(
          (balancerV2PoolTokens.tokens[0] == usdc.address
            ? balancerV2PoolTokens.balances[0]
            : balancerV2PoolTokens.balances[1]
          )
            .mul(PRECISION)
            .div(ONE_USDC)
            .toString()
        ) / PRECISION
      const collSendAmountNumber = getLoopingSendAmount(
        initCollFromBorrowerNumber,
        loanPerColl,
        collTokenInDexPool,
        loanTokenInDexPool,
        swapFee
      )
      const collSendAmount = ethers.BigNumber.from(Math.floor(collSendAmountNumber * PRECISION))
        .mul(ONE_WETH)
        .div(PRECISION)

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      // borrower approves and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const slippageTolerance = BASE.mul(30).div(10000)
      const minSwapReceive = collSendAmount.sub(initCollFromBorrower).mul(BASE.sub(slippageTolerance)).div(BASE)
      const deadline = MAX_UINT128

      const callbackAddr = balancerV2Looping.address
      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [poolId, minSwapReceive, deadline]
      )
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 0)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.revertedWithCustomError(borrowerGateway, 'NonWhitelistedCallback')

      await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 4)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(
            lenderVault.address,
            { ...borrowInstructions, expectedProtocolAndVaultTransferFee: BigNumber.from(0).add(1) },
            onChainQuote,
            quoteTupleIdx
          )
      ).to.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')

      // pre callback allowances
      let preWethAllowance = await weth.allowance(callbackAddr, BALANCER_V2_VAULT)
      let preUsdcAllowance = await usdc.allowance(callbackAddr, BALANCER_V2_VAULT)

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // post callback allowances
      let postWethAllowance = await weth.allowance(callbackAddr, BALANCER_V2_VAULT)
      let postUsdcAllowance = await usdc.allowance(callbackAddr, BALANCER_V2_VAULT)

      // check callback allowances are zero
      expect(preWethAllowance).to.be.equal(0)
      expect(preUsdcAllowance).to.be.equal(0)
      expect(postWethAllowance).to.be.equal(0)
      expect(postUsdcAllowance).to.be.equal(0)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const borrowerWethBalDiffActual = borrowerWethBalPre.add(borrowerWethBalPost)
      const borrowerWethBalDiffExpected = borrowerWethBalPre.sub(collSendAmount)
      const borrowerWethBalDiffComparison = Math.abs(
        Number(
          borrowerWethBalDiffActual
            .sub(borrowerWethBalDiffExpected)
            .mul(PRECISION)
            .div(borrowerWethBalDiffActual)
            .div(ONE_WETH)
            .toString()
        ) / PRECISION
      )
      expect(borrowerWethBalDiffComparison).to.be.lessThan(0.01)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(0) // borrower: no usdc change as all swapped for weth
      expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(collSendAmount)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(
        onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmount).div(ONE_WETH)
      )
    })
  })

  describe('Compartment Testing', function () {
    const stakeInLiquidityGauge = async ({
      collTokenAddress,
      collTokenSlot,
      crvGaugeAddress,
      crvGaugeIndex,
      rewardTokenAddress,
      isPartialRepay,
      rewardsDistributionAddress
    }: {
      collTokenAddress: string
      collTokenSlot: number
      crvGaugeAddress: string
      crvGaugeIndex: number
      rewardTokenAddress?: string
      isPartialRepay?: boolean
      rewardsDistributionAddress?: string
    }) => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, ldo, lenderVault, addressRegistry } =
        await setupTest()

      // create curve staking implementation
      const CurveLPStakingCompartmentImplementation = await ethers.getContractFactory('CurveLPStakingCompartment')
      await CurveLPStakingCompartmentImplementation.connect(team)
      const curveLPStakingCompartmentImplementation = await CurveLPStakingCompartmentImplementation.deploy()
      await curveLPStakingCompartmentImplementation.deployed()

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address], 1)

      // whitelist compartment
      await addressRegistry.connect(team).setWhitelistState([curveLPStakingCompartmentImplementation.address], 3)

      // whitelist tokens for compartment
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(curveLPStakingCompartmentImplementation.address, [collTokenAddress], true)

      // increase borrower CRV balance
      const crvTokenAddress = '0xD533a949740bb3306d119CC777fa900bA034cd52'
      const gaugeControllerAddress = '0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB'

      const locallyCollBalance = ethers.BigNumber.from(10).pow(18)
      const crvInstance = new ethers.Contract(crvTokenAddress, collTokenAbi, borrower.provider)
      const crvLPInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)
      const crvGaugeInstance = new ethers.Contract(crvGaugeAddress, collTokenAbi, borrower.provider)
      //const rewardContractInstance = new ethers.Contract(rewardContractAddress || '0', collTokenAbi, borrower.provider)
      const rewardDistributionInstance = new ethers.Contract(
        rewardsDistributionAddress || '0',
        crvRewardsDistributorAbi,
        borrower.provider
      )
      const rewardTokenInstance = new ethers.Contract(rewardTokenAddress || '0', collTokenAbi, borrower.provider)
      //const stableSwapInstance = new ethers.Contract(stableSwapAddress || '0', stableSwapAbi, borrower.provider)

      const gaugeControllerInstance = new ethers.Contract(gaugeControllerAddress, collTokenAbi, borrower.provider)

      // check support gauge in gauge controller
      await expect(gaugeControllerInstance.connect(borrower).gauge_types(crvGaugeAddress)).to.be.not.reverted

      // drop crv borrower balance to 0
      const crvSlotIndex = 3
      const crvIndex = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [crvSlotIndex, borrower.address])
      await ethers.provider.send('hardhat_setStorageAt', [
        crvTokenAddress,
        crvIndex.toString(),
        ethers.utils.hexZeroPad(BigNumber.from(0).toHexString(), 32)
      ])

      const borrowerCRVBalancePre = await crvInstance.balanceOf(borrower.address)

      expect(borrowerCRVBalancePre).to.equal(BigNumber.from(0))

      // Get coll storage slot index
      const collIndex = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [collTokenSlot, borrower.address])
      await ethers.provider.send('hardhat_setStorageAt', [
        collTokenAddress,
        collIndex.toString(),
        ethers.utils.hexZeroPad(locallyCollBalance.toHexString(), 32)
      ])

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get pre balances
      const borrowerCRVLpBalPre = await crvLPInstance.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)
      const lenderVaultCollBalPre = await crvLPInstance.balanceOf(lenderVault.address)

      expect(borrowerCRVLpBalPre).to.equal(locallyCollBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // borrower approves borrower gateway
      await crvLPInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const ONE_CRV = BigNumber.from(10).pow(18)

      const onChainQuote = await createOnChainRequest({
        lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: curveLPStakingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // borrow with on chain quote
      const collSendAmount = ONE_CRV
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const compartmentData = crvGaugeIndex
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']
      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const upfrontFee = borrowEvent?.args?.['upfrontFee']

      const crvCompInstance = await curveLPStakingCompartmentImplementation.attach(collTokenCompartmentAddr)

      await expect(crvCompInstance.connect(lender).stake(compartmentData)).to.be.revertedWithCustomError(
        crvCompInstance,
        'InvalidSender'
      )
      await expect(crvCompInstance.connect(borrower).stake(1000)).to.be.revertedWithCustomError(
        crvCompInstance,
        'InvalidGaugeIndex'
      )
      await expect(crvCompInstance.connect(borrower).stake(10)).to.be.revertedWithCustomError(
        crvCompInstance,
        'IncorrectGaugeForLpToken'
      )
      await expect(crvCompInstance.connect(lender).toggleApprovedStaker(lender.address)).to.be.revertedWithCustomError(
        crvCompInstance,
        'InvalidSender'
      )
      await crvCompInstance.connect(borrower).stake(compartmentData)
      await expect(crvCompInstance.connect(borrower).stake(compartmentData)).to.be.revertedWithCustomError(
        crvCompInstance,
        'AlreadyStaked'
      )
      await expect(
        crvCompInstance.connect(team).transferCollFromCompartment(1, 1, 1, borrower.address, collTokenAddress, ZERO_ADDR)
      ).to.be.revertedWithCustomError(crvCompInstance, 'InvalidSender')

      const lenderStakeStatus = await crvCompInstance.approvedStaker(lender.address)

      expect(lenderStakeStatus).to.equal(false)

      await crvCompInstance.connect(borrower).toggleApprovedStaker(lender.address)

      const lenderStakeStatusPost = await crvCompInstance.approvedStaker(lender.address)

      expect(lenderStakeStatusPost).to.equal(true)

      // this passes the invalid sender check
      await expect(crvCompInstance.connect(lender).stake(compartmentData)).to.be.revertedWithCustomError(
        crvCompInstance,
        'AlreadyStaked'
      )

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const lenderVaultCollBalPostBorrow = await crvLPInstance.balanceOf(lenderVault.address)

      const compartmentGaugeBalPost = await crvGaugeInstance.balanceOf(collTokenCompartmentAddr)

      expect(compartmentGaugeBalPost).to.equal(borrowerCRVLpBalPre.sub(upfrontFee))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      expect(lenderVaultCollBalPostBorrow.sub(lenderVaultCollBalPre)).to.equal(upfrontFee)

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // mine 50000 blocks with an interval of 60 seconds, ~1 month
      await hre.network.provider.send('hardhat_mine', [
        BigNumber.from(50000).toHexString(),
        BigNumber.from(60).toHexString()
      ])

      // The total amount of CRV, both mintable and already minted
      const totalGaugeRewardCRV = await crvGaugeInstance.claimable_tokens(collTokenCompartmentAddr)
      let rewardTokenBalPreCompartment = BigNumber.from(0)

      if (rewardTokenAddress) {
        rewardTokenBalPreCompartment = await rewardTokenInstance.balanceOf(collTokenCompartmentAddr)
        if (rewardsDistributionAddress) {
          await ldo.connect(team).transfer(rewardDistributionInstance.address, '100000000000000000000')
          await rewardDistributionInstance.connect(team).start_next_rewards_period()
        }
      }

      // check balance pre repay
      const borrowerUsdcBalancePre = await usdc.balanceOf(borrower.address)
      if (repayAmount.gt(borrowerUsdcBalancePre)) {
        await usdc.connect(lender).transfer(borrower.address, repayAmount.sub(borrowerUsdcBalancePre))
      }

      const repay = async () => {
        const borrowerRewardTokenBalancePre = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(borrower.address)
          : BigNumber.from(0)
        // repay
        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: loanId,
              targetRepayAmount: repayAmount,
              expectedTransferFee: 0,
              deadline: MAX_UINT256,
              callbackAddr: callbackAddr,
              callbackData: callbackData
            },
            lenderVault.address
          )
        )
          .to.emit(borrowerGateway, 'Repaid')
          .withArgs(lenderVault.address, loanId, repayAmount)

        // check balance post repay
        const borrowerCRVBalancePost = await crvInstance.balanceOf(borrower.address)
        const borrowerCRVLpRepayBalPost = await crvLPInstance.balanceOf(borrower.address)

        expect(borrowerCRVBalancePost.toString().substring(0, 3)).to.equal(totalGaugeRewardCRV.toString().substring(0, 3))

        if (rewardTokenAddress) {
          const borrowerRewardTokenBalancePost = await rewardTokenInstance.balanceOf(borrower.address)
          expect(borrowerRewardTokenBalancePost).to.be.greaterThan(borrowerRewardTokenBalancePre)
        }
        expect(borrowerCRVLpRepayBalPost).to.equal(locallyCollBalance.sub(upfrontFee))
      }

      const partialRepay = async () => {
        const coeffRepay = 2
        const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

        const borrowerRewardTokenBalancePre = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(borrower.address)
          : BigNumber.from(0)
        const compartmentRewardTokenBalancePre = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(collTokenCompartmentAddr)
          : BigNumber.from(0)

        // too large target repay amount should fail
        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: loanId,
              targetRepayAmount: MAX_UINT128,
              expectedTransferFee: 0,
              deadline: MAX_UINT256,
              callbackAddr: callbackAddr,
              callbackData: callbackData
            },
            lenderVault.address
          )
        ).to.be.revertedWithCustomError(borrowerGateway, 'InvalidRepayAmount')

        await expect(
          lenderVault.connect(lender).transferTo(collTokenAddress, lender.address, repayAmount)
        ).to.be.revertedWithCustomError(lenderVault, 'UnregisteredGateway')

        // partial repay
        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: loanId,
              targetRepayAmount: partialRepayAmount,
              expectedTransferFee: 0,
              deadline: MAX_UINT256,
              callbackAddr: callbackAddr,
              callbackData: callbackData
            },
            lenderVault.address
          )
        )
          .to.emit(borrowerGateway, 'Repaid')
          .withArgs(lenderVault.address, loanId, partialRepayAmount)

        // check balance post repay
        const borrowerCRVBalancePost = await crvInstance.balanceOf(borrower.address)
        const borrowerCRVLpRepayBalPost = await crvLPInstance.balanceOf(borrower.address)
        const collTokenCompartmentCRVBalancePost = await crvInstance.balanceOf(collTokenCompartmentAddr)
        const approxPartialCRVReward = totalGaugeRewardCRV.div(coeffRepay).toString().substring(0, 3)

        expect(borrowerCRVBalancePost.toString().substring(0, 3)).to.equal(approxPartialCRVReward)
        expect(borrowerCRVLpRepayBalPost).to.equal(locallyCollBalance.sub(upfrontFee).div(coeffRepay))
        expect(collTokenCompartmentCRVBalancePost.toString().substring(0, 3)).to.equal(approxPartialCRVReward)

        // unlock before expiry should revert
        await expect(lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId])).to.be.revertedWithCustomError(
          lenderVault,
          'InvalidCollUnlock'
        )

        await ethers.provider.send('evm_mine', [loanExpiry + 12])

        // check borrower cannot access collateral anymore after default
        await expect(crvCompInstance.connect(lender).stake(compartmentData)).to.be.revertedWithCustomError(
          crvCompInstance,
          'LoanExpired'
        )

        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: loanId,
              targetRepayAmount: partialRepayAmount,
              expectedTransferFee: 0,
              deadline: MAX_UINT256,
              callbackAddr: callbackAddr,
              callbackData: callbackData
            },
            lenderVault.address
          )
        ).to.be.revertedWithCustomError(borrowerGateway, 'OutsideValidRepayWindow')

        // check crv reward for compartment address
        const totalGaugeRewardCRVPost = await crvGaugeInstance.claimable_tokens(collTokenCompartmentAddr)

        // calculate new crv rewards with partial rewards have already claimed
        const approxPartialCRVPostReward = totalGaugeRewardCRVPost
          .add(totalGaugeRewardCRV.div(coeffRepay))
          .toString()
          .substring(0, 3)
        let compartmentRewardTokenBalancePost = BigNumber.from(0)

        if (rewardTokenAddress) {
          const borrowerRewardTokenBalancePost = await rewardTokenInstance.balanceOf(borrower.address)
          compartmentRewardTokenBalancePost = await rewardTokenInstance.balanceOf(collTokenCompartmentAddr)

          expect(borrowerRewardTokenBalancePost).to.be.greaterThan(borrowerRewardTokenBalancePre)

          if (borrowerRewardTokenBalancePost.gt(borrowerRewardTokenBalancePre)) {
            expect(
              borrowerRewardTokenBalancePost.sub(borrowerRewardTokenBalancePre).sub(compartmentRewardTokenBalancePost)
            ).to.be.closeTo(0, 2)
          }
        }

        // unlock collateral
        const lenderVaultRewardTokenBalancePreUnlock = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(lenderVault.address)
          : BigNumber.from(0)
        await expect(lenderVault.connect(lender).unlockCollateral(lender.address, [loanId])).to.be.revertedWithCustomError(
          lenderVault,
          'InconsistentUnlockTokenAddresses'
        )
        await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId])
        const compartmentRewardTokenBalancePostUnlock = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(collTokenCompartmentAddr)
          : BigNumber.from(0)

        // check vault balance
        const lenderVaultCollBalPost = await crvLPInstance.balanceOf(lenderVault.address)
        const lenderVaultCRVBalancePost = await crvInstance.balanceOf(lenderVault.address)
        const lenderVaultRewardTokenBalancePostUnlock = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(lenderVault.address)
          : BigNumber.from(0)

        // (post partial repay: lenderVaultBalance = upfrontFee + (locallyCollBalance-upfrontFee)/2)
        expect(lenderVaultCollBalPost).to.equal(locallyCollBalance.sub(upfrontFee).div(coeffRepay).add(upfrontFee))
        expect(lenderVaultCRVBalancePost.toString().substring(0, 3)).to.equal(approxPartialCRVPostReward)
        if (compartmentRewardTokenBalancePost.gt(0) && lenderVaultRewardTokenBalancePostUnlock.gt(0)) {
          expect(compartmentRewardTokenBalancePostUnlock).to.be.equal(0)
        }
      }

      isPartialRepay ? await partialRepay() : await repay()
    }

    it('Should process Curve LP staking in LGauge v1 and repay correctly', async () => {
      const collTokenAddress = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490' // LP 3pool
      const crvGaugeAddress = '0xbfcf63294ad7105dea65aa58f8ae5be2d9d0952a'

      await stakeInLiquidityGauge({
        collTokenAddress,
        collTokenSlot: 3,
        crvGaugeAddress,
        crvGaugeIndex: 9
      })
    })

    it('Should process Curve LP staking in LGauge v2 with LDO rewards and repay correctly', async () => {
      const collTokenAddress = '0x06325440D014e39736583c165C2963BA99fAf14E' // LP steth
      const crvGaugeAddress = '0x182B723a58739a9c974cFDB385ceaDb237453c28'
      const lidoTokenAddress = '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32'
      const rewardsDistributionAddress = '0x753D5167C31fBEB5b49624314d74A957Eb271709'

      await stakeInLiquidityGauge({
        collTokenAddress,
        collTokenSlot: 2,
        crvGaugeAddress,
        crvGaugeIndex: 27,
        rewardTokenAddress: lidoTokenAddress,
        rewardsDistributionAddress
      })
    })

    it('Should process Curve LP staking in LGauge v2 with LDO rewards and partial repay correctly', async () => {
      const collTokenAddress = '0x06325440D014e39736583c165C2963BA99fAf14E' // LP steth
      const crvGaugeAddress = '0x182B723a58739a9c974cFDB385ceaDb237453c28'
      const lidoTokenAddress = '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32'
      const rewardsDistributionAddress = '0x753D5167C31fBEB5b49624314d74A957Eb271709'

      await stakeInLiquidityGauge({
        collTokenAddress,
        collTokenSlot: 2,
        crvGaugeAddress,
        crvGaugeIndex: 27,
        rewardTokenAddress: lidoTokenAddress,
        rewardsDistributionAddress,
        isPartialRepay: true
      })
    })

    it('Should process Curve LP staking in LGauge v4 and repay correctly', async () => {
      const collTokenAddress = '0xEd4064f376cB8d68F770FB1Ff088a3d0F3FF5c4d' // LP crvCRVETH
      const crvGaugeAddress = '0x1cEBdB0856dd985fAe9b8fEa2262469360B8a3a6'

      await stakeInLiquidityGauge({
        collTokenAddress,
        collTokenSlot: 5,
        crvGaugeAddress,
        crvGaugeIndex: 84
      })
    })

    it('Should process Curve LP staking in LGauge v5 with partial repay and unlock coll correctly with rewards', async () => {
      const collTokenAddress = '0x3F436954afb722F5D14D868762a23faB6b0DAbF0' // LP FRAXBP
      const crvGaugeAddress = '0xCf79921D99b99FEe3DcF1A4657fCDA95195B46d1'

      await stakeInLiquidityGauge({
        collTokenAddress,
        collTokenSlot: 6,
        crvGaugeAddress,
        crvGaugeIndex: 192,
        isPartialRepay: true
      })
    })

    it('Should process borrow/repay correctly when collateral crv was mistakenly whitelisted for crv compartment', async function () {
      const { borrowerGateway, lender, borrower, quoteHandler, team, usdc, lenderVault, addressRegistry } = await setupTest()

      const CRV_ADDR = '0xD533a949740bb3306d119CC777fa900bA034cd52'
      const collInstance = new ethers.Contract(CRV_ADDR, collTokenAbi, borrower.provider)

      // drop crv borrower balance to ONE_CRV
      const crvSlotIndex = 3
      const crvIndex = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [crvSlotIndex, borrower.address])
      await ethers.provider.send('hardhat_setStorageAt', [
        CRV_ADDR,
        crvIndex.toString(),
        ethers.utils.hexZeroPad(BigNumber.from(10).pow(18).toHexString(), 32)
      ])

      // create crv staking implementation
      const CrvStakingCompartmentImplementation = await ethers.getContractFactory('CurveLPStakingCompartment')
      await CrvStakingCompartmentImplementation.connect(team)
      const crvStakingCompartmentImplementation = await CrvStakingCompartmentImplementation.deploy()
      await crvStakingCompartmentImplementation.deployed()

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([CRV_ADDR, usdc.address], 1)
      // whitelist compartment
      await addressRegistry.connect(team).setWhitelistState([crvStakingCompartmentImplementation.address], 3)
      // whitelist tokens for compartment
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(crvStakingCompartmentImplementation.address, [CRV_ADDR], true)

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

      // get pre balances
      const borrowerWethBalPre = await collInstance.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)
      const vaultWethBalPre = await collInstance.balanceOf(lenderVault.address)

      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(10000000))

      // borrower approves borrower gateway
      await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const onChainQuote = await createOnChainRequest({
        lender,
        collToken: collInstance.address,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: crvStakingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000),
        validUntil: MAX_UINT256
      })

      // borrow with on chain quote
      const collSendAmount = BigNumber.from(10).pow(18)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']

      const coeffRepay = 2
      const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

      // check balance post borrow
      const borrowerCollBalPost = await collInstance.balanceOf(borrower.address)
      expect(borrowerWethBalPre.sub(borrowerCollBalPost)).to.be.equal(collSendAmount)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      const expUpfrontFee = collSendAmount.mul(onChainQuote.quoteTuples[0].upfrontFeePctInBase).div(BASE)
      const vaultCollBalPost = await collInstance.balanceOf(lenderVault.address)
      expect(vaultCollBalPost.sub(vaultWethBalPre)).to.equal(expUpfrontFee)

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // mine 50000 blocks with an interval of 60 seconds, ~1 month
      await hre.network.provider.send('hardhat_mine', [
        BigNumber.from(50000).toHexString(),
        BigNumber.from(60).toHexString()
      ])

      // increase borrower usdc balance to repay
      await usdc.connect(lender).transfer(borrower.address, partialRepayAmount)

      // partial repay
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      )
        .to.emit(borrowerGateway, 'Repaid')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

      // check balance post repay
      const vaultUsdcBalPostRepay = await usdc.balanceOf(lenderVault.address)
      const borrowerUsdcBalPostRepay = await usdc.balanceOf(borrower.address)
      const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)
      const expReclaimedColl = initCollAmount.mul(partialRepayAmount).div(repayAmount)
      expect(borrowerUsdcBalPost).to.be.equal(borrowerUsdcBalPostRepay)
      expect(vaultUsdcBalPostRepay.sub(vaultUsdcBalPost)).to.be.equal(partialRepayAmount)
      expect(borrowerCollRepayBalPost.sub(borrowerCollBalPost)).to.be.equal(expReclaimedColl)

      // move forward past loan expiry
      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // unlock unclaimed collateral
      const lenderVaultWethBalPre = await collInstance.balanceOf(lenderVault.address)
      const lenderCollBalPre = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPre).to.equal(BigNumber.from(0))

      await lenderVault.connect(lender).unlockCollateral(CRV_ADDR, [loanId])

      const lenderCollBalPost = await collInstance.balanceOf(lender.address)
      const lenderVaultCollBalPost = await collInstance.balanceOf(lenderVault.address)

      // unlock collateral
      expect(lenderCollBalPost).to.equal(lenderCollBalPre)
      expect(lenderVaultCollBalPost).to.equal(initCollAmount.sub(expReclaimedColl).add(expUpfrontFee))
    })

    it('Should process aToken borrow and partial repayment correctly with rewards', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault, addressRegistry } =
        await setupTest()

      // create aave staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      // increase borrower aWETH balance
      const locallyCollBalance = ethers.BigNumber.from(10).pow(18)
      const collTokenAddress = '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8' // aave WETH
      const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address], 1)
      // whitelist compartment
      await addressRegistry.connect(team).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)

      // whitelisting should revert if empty array
      await expect(
        addressRegistry.connect(team).setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [], true)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidArrayLength')

      // whitelisting should revert if trying to whitelist tokens for an unknown compartment implementation
      await expect(
        addressRegistry.connect(team).setAllowedTokensForCompartment(team.address, [collTokenAddress], true)
      ).to.be.revertedWithCustomError(addressRegistry, 'NonWhitelistedCompartment')

      // whitelisting should revert if address is zero, or any non-whitelisted token
      await expect(
        addressRegistry
          .connect(team)
          .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [ZERO_ADDR], true)
      ).to.be.revertedWithCustomError(addressRegistry, 'NonWhitelistedToken')
      await expect(
        addressRegistry
          .connect(team)
          .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [team.address], true)
      ).to.be.revertedWithCustomError(addressRegistry, 'NonWhitelistedToken')

      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [collTokenAddress], true)

      const poolAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'
      const poolInstance = new ethers.Contract(poolAddress, aavePoolAbi, borrower.provider)

      // supply aave pool
      await weth.connect(borrower).approve(poolAddress, MAX_UINT256)
      await poolInstance.connect(borrower).supply(weth.address, locallyCollBalance, borrower.address, '0')

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get pre balances
      const borrowerCollBalPre = await collInstance.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(borrowerCollBalPre).to.be.above(locallyCollBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // borrower approves borrower gateway
      await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const onChainQuote = await createOnChainRequest({
        lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: aaveStakingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      await expect(
        createOnChainRequest({
          lender,
          collToken: collTokenAddress,
          loanToken: usdc.address,
          borrowerCompartmentImplementation: team.address,
          lenderVault,
          quoteHandler,
          loanPerCollUnit: ONE_USDC.mul(1000)
        })
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidCompartmentForToken')

      // whitelist team.address as a valid compartment implementation
      await addressRegistry.connect(team).setWhitelistState([team.address], 3)
      // whitelist compartment for token
      await addressRegistry.connect(team).setAllowedTokensForCompartment(team.address, [collTokenAddress], true)

      const badCompartmentOnChainQuote = await createOnChainRequest({
        lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: team.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // de-whitelist compartment for token
      await addressRegistry.connect(team).setAllowedTokensForCompartment(team.address, [collTokenAddress], false)

      // borrow with on chain quote
      const collSendAmount = BigNumber.from(10).pow(18)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      //borrow with bad compartment before token-compartment-pair is whitelisted should fail
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, badCompartmentOnChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidCompartmentForToken')

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanId = borrowEvent?.args?.['loanId']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const upfrontFee = borrowEvent?.args?.['upfrontFee']
      const collateralCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']

      const coeffRepay = 2
      const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // repay
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      )
        .to.emit(borrowerGateway, 'Repaid')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

      // check balance post repay
      const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)

      expect(borrowerCollRepayBalPost).to.be.above(borrowerCollBalPre.sub(upfrontFee).div(coeffRepay))

      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // unlock collateral
      const lenderCollBalPre = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPre).to.equal(BigNumber.from(0))

      const lockedAmountsPre = await lenderVault.lockedAmounts(collTokenAddress)

      expect(lockedAmountsPre).to.equal(0)

      const lenderVaultCollBalPre = await collInstance.balanceOf(lenderVault.address)

      const compartmentCollBalPreRepay = await collInstance.balanceOf(collateralCompartmentAddr)

      await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId])

      const lockedAmountsPost = await lenderVault.lockedAmounts(collTokenAddress)

      expect(lockedAmountsPost).to.equal(0)

      const lenderVaultCollBalPost = await collInstance.balanceOf(lenderVault.address)

      // above because of rebasing rewards
      expect(lenderVaultCollBalPost.sub(lenderVaultCollBalPre)).to.be.above(collSendAmount.sub(upfrontFee).div(coeffRepay))

      expect(lenderVaultCollBalPost.sub(lenderVaultCollBalPre)).to.be.above(compartmentCollBalPreRepay)

      const lenderCollBalPost = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPost).to.be.equal(0)
    })

    it('Should delegate voting correctly with borrow and partial repayment', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, lenderVault, addressRegistry } = await setupTest()

      // create uni staking implementation
      const VotingCompartmentImplementation = await ethers.getContractFactory('VoteCompartment')
      await VotingCompartmentImplementation.connect(team)
      const votingCompartmentImplementation = await VotingCompartmentImplementation.deploy()
      await votingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([votingCompartmentImplementation.address], 3)

      // increase borrower UNI balance
      const locallyUNIBalance = ethers.BigNumber.from(10).pow(18)
      const collTokenAddress = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' // UNI
      const UNI_SLOT = 4
      const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

      // Get storage slot index
      const index = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [borrower.address, UNI_SLOT])
      await ethers.provider.send('hardhat_setStorageAt', [
        collTokenAddress,
        index.toString(),
        ethers.utils.hexZeroPad(locallyUNIBalance.toHexString(), 32)
      ])

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get pre balances
      const borrowerUNIBalPre = await collInstance.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUNIBalPre = BigNumber.from(0) // compartment balance
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(borrowerUNIBalPre).to.equal(locallyUNIBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address], 1)

      // whitelist compartment for token
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(votingCompartmentImplementation.address, [collTokenAddress], true)

      // borrower approves borrower gateway
      await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const ONE_UNI = BigNumber.from(10).pow(18)

      const onChainQuote = await createOnChainRequest({
        lender: lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: votingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // borrow with on chain quote
      const collSendAmount = ONE_UNI
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanId = borrowEvent?.args?.['loanId']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']
      const upfrontFee = borrowEvent?.args?.['upfrontFee']

      const coeffRepay = 2
      const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

      const uniCompInstance = await votingCompartmentImplementation.attach(collTokenCompartmentAddr)

      const borrowerVotesPreDelegation = await collInstance.getCurrentVotes(borrower.address)

      await expect(uniCompInstance.connect(team).delegate(borrower.address)).to.be.revertedWithCustomError(
        votingCompartmentImplementation,
        'InvalidSender'
      )
      await uniCompInstance.connect(borrower).delegate(borrower.address)

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const borroweUNIBalPost = await collInstance.balanceOf(borrower.address)
      const vaultUNIBalPost = await collInstance.balanceOf(collTokenCompartmentAddr)

      const borrowerVotesPost = await collInstance.getCurrentVotes(borrower.address)

      expect(borrowerVotesPost).to.equal(borrowerUNIBalPre.sub(upfrontFee))
      expect(borrowerVotesPreDelegation).to.equal(0)

      await expect(uniCompInstance.connect(team).toggleApprovedDelegator(team.address)).to.be.revertedWithCustomError(
        votingCompartmentImplementation,
        'InvalidSender'
      )

      await uniCompInstance.connect(borrower).toggleApprovedDelegator(team.address)

      const teamApprovedDelegator = await uniCompInstance.approvedDelegator(team.address)

      expect(teamApprovedDelegator).to.equal(true)

      const teamVotesPreDelegation = await collInstance.getCurrentVotes(team.address)

      await uniCompInstance.connect(team).delegate(team.address)

      const teamVotesPostDelegation = await collInstance.getCurrentVotes(team.address)

      expect(teamVotesPostDelegation).to.equal(borrowerVotesPost.sub(teamVotesPreDelegation))

      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      expect(borrowerUNIBalPre.sub(borroweUNIBalPost)).to.equal(vaultUNIBalPost.sub(vaultUNIBalPre).add(upfrontFee))

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // partial repay
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      )
        .to.emit(borrowerGateway, 'Repaid')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

      // check balance post repay
      const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)
      expect(borrowerCollRepayBalPost).to.be.equal(borrowerUNIBalPre.sub(upfrontFee).div(coeffRepay))

      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // check borrower cannot access collateral anymore after default
      await expect(uniCompInstance.connect(borrower).delegate(borrower.address)).to.be.revertedWithCustomError(
        uniCompInstance,
        'LoanExpired'
      )

      // unlock collateral
      const lenderCollBalPre = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPre).to.equal(BigNumber.from(0))

      const lockedAmountsPre = await lenderVault.lockedAmounts(collTokenAddress)

      expect(lockedAmountsPre).to.equal(0)

      const lenderVaultCollBalPre = await collInstance.balanceOf(lenderVault.address)

      expect(lenderVaultCollBalPre).to.equal(upfrontFee)

      await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId])

      const lockedAmountsPost = await lenderVault.lockedAmounts(collTokenAddress)

      expect(lockedAmountsPost).to.equal(0)

      const lenderVaultCollBalPost = await collInstance.balanceOf(lenderVault.address)

      expect(lenderVaultCollBalPost).to.be.equal(borrowerUNIBalPre.sub(upfrontFee).div(coeffRepay).add(upfrontFee))

      const lenderCollBalPost = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPost).to.equal(0)

      await expect(lenderVault.connect(lender).withdraw(collTokenAddress, MAX_UINT128)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )
    })

    it('Should delegate voting correctly with borrow and partial repayment with callback', async () => {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        team,
        weth,
        lenderVault,
        addressRegistry,
        balancerV2Looping
      } = await setupTest()

      // create uni staking implementation
      const VotingCompartmentImplementation = await ethers.getContractFactory('VoteCompartment')
      await VotingCompartmentImplementation.connect(team)
      const votingCompartmentImplementation = await VotingCompartmentImplementation.deploy()
      await votingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([votingCompartmentImplementation.address], 3)

      // increase borrower UNI balance
      const locallyUNIBalance = ethers.BigNumber.from(10).pow(18)
      const collTokenAddress = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' // UNI
      const UNI_SLOT = 4
      const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

      // Get storage slot index
      const index = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [borrower.address, UNI_SLOT])
      await ethers.provider.send('hardhat_setStorageAt', [
        collTokenAddress,
        index.toString(),
        ethers.utils.hexZeroPad(locallyUNIBalance.toHexString(), 32)
      ])

      // lender deposits weth
      await weth.connect(lender).deposit({ value: ONE_WETH.mul(1000) })
      await weth.connect(lender).transfer(lenderVault.address, ONE_WETH.mul(1000))

      // get pre balances
      const borrowerCollBalPre = await collInstance.balanceOf(borrower.address)
      const borrowerLoanBalPre = await weth.balanceOf(borrower.address)
      const vaultLoanBalPre = await weth.balanceOf(lenderVault.address)

      expect(borrowerCollBalPre).to.equal(locallyUNIBalance)
      expect(vaultLoanBalPre).to.equal(ONE_WETH.mul(1000))

      // whitelist token pair
      await addressRegistry.connect(team).setWhitelistState([collTokenAddress, weth.address], 1)

      // whitelist compartment for token
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(votingCompartmentImplementation.address, [collTokenAddress], true)

      expect(await addressRegistry.connect(team).whitelistState(collTokenAddress)).to.be.equal(1)
      expect(await addressRegistry.connect(team).whitelistState(weth.address)).to.be.equal(1)

      // borrower approves borrower gateway
      await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const ONE_UNI = BigNumber.from(10).pow(18)

      const onChainQuote = await createOnChainRequest({
        lender: lender,
        collToken: collTokenAddress,
        loanToken: weth.address,
        borrowerCompartmentImplementation: votingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_WETH.div(400)
      })

      // borrow with on chain quote
      const collSendAmount = ONE_UNI
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0

      const PRECISION = 10000
      const collBuffer = BASE.mul(990).div(1000)
      const initCollFromBorrower = ONE_UNI.mul(collBuffer).div(BASE)
      const slippageTolerance = BASE.mul(30).div(10000)
      const poolId = '0x5aa90c7362ea46b3cbfbd7f01ea5ca69c98fef1c000200000000000000000020' // look up via getPoolId() on bal pool
      const minSwapReceive = collSendAmount.sub(initCollFromBorrower).mul(BASE.sub(slippageTolerance)).div(BASE)
      const deadline = MAX_UINT128

      const callbackAddr = balancerV2Looping.address
      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [poolId, minSwapReceive, deadline]
      )
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanId = borrowEvent?.args?.['loanId']
      const upfrontFee = borrowEvent?.args?.['upfrontFee']

      const coeffRepay = 2
      const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

      const uniCompInstance = await votingCompartmentImplementation.attach(collTokenCompartmentAddr)

      await expect(uniCompInstance.connect(team).initialize(borrower.address, 1)).to.be.reverted

      await expect(
        uniCompInstance.connect(team).transferCollFromCompartment(1, 1, 1, borrower.address, collTokenAddress, ZERO_ADDR)
      ).to.be.revertedWithCustomError(uniCompInstance, 'InvalidSender')

      await expect(uniCompInstance.connect(team).unlockCollToVault(collTokenAddress)).to.be.revertedWithCustomError(
        uniCompInstance,
        'InvalidSender'
      )

      const borrowerVotesPreDelegation = await collInstance.getCurrentVotes(borrower.address)

      await expect(uniCompInstance.connect(team).delegate(borrower.address)).to.be.revertedWithCustomError(
        uniCompInstance,
        'InvalidSender'
      )
      await expect(uniCompInstance.connect(borrower).delegate(ZERO_ADDR)).to.be.revertedWithCustomError(
        uniCompInstance,
        'InvalidDelegatee'
      )
      await uniCompInstance.connect(borrower).delegate(borrower.address)

      // check balance post borrow
      const borrowerLoanBalPost = await weth.balanceOf(borrower.address)
      const borrowerCollBalPost = await collInstance.balanceOf(borrower.address)
      const compartmentCollBalPost = await collInstance.balanceOf(collTokenCompartmentAddr)

      expect(borrowerLoanBalPost.sub(borrowerLoanBalPre)).to.equal(0) // borrower: no weth change as all swapped for uni
      expect(compartmentCollBalPost).to.equal(collSendAmount.sub(upfrontFee))
      expect(borrowerVotesPreDelegation).to.equal(0)

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const minSwapReceiveRepay = partialRepayAmount.mul(BASE.sub(slippageTolerance)).div(BASE).div(1000)

      const callbackDataRepay = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [poolId, minSwapReceiveRepay, deadline]
      )

      await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 0)

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackDataRepay
          },
          lenderVault.address
        )
      ).to.revertedWithCustomError(borrowerGateway, 'NonWhitelistedCallback')

      await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 4)

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: BigNumber.from(0).add(1),
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackDataRepay
          },
          lenderVault.address
        )
      ).to.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')

      // pre callback allowances
      let preCollAllowance = await collInstance.allowance(callbackAddr, BALANCER_V2_VAULT)
      let preLoanAllowance = await weth.allowance(callbackAddr, BALANCER_V2_VAULT)

      // partial repay
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackDataRepay
          },
          lenderVault.address
        )
      )
        .to.emit(borrowerGateway, 'Repaid')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

      // post callback allowances
      let postCollAllowance = await collInstance.allowance(callbackAddr, BALANCER_V2_VAULT)
      let postLoanAllowance = await weth.allowance(callbackAddr, BALANCER_V2_VAULT)

      // check allowances are zero
      expect(preCollAllowance).to.be.equal(0)
      expect(preLoanAllowance).to.be.equal(0)
      expect(postCollAllowance).to.be.equal(0)
      expect(postLoanAllowance).to.be.equal(0)

      // check balance post repay
      const borrowerCollBalPostRepay = await collInstance.balanceOf(borrower.address)
      const compartmentCollBalPostRepay = await collInstance.balanceOf(collTokenCompartmentAddr)
      const borrowerLoanBalPostRepay = await weth.balanceOf(borrower.address)

      expect(borrowerCollBalPostRepay).to.equal(borrowerCollBalPost) // coll swapped out for loan, no change in coll
      expect(borrowerLoanBalPostRepay).to.be.greaterThan(partialRepayAmount)
      expect(compartmentCollBalPostRepay).to.equal(compartmentCollBalPost.div(coeffRepay))
    })

    it('Should thwart malcious withdraw from vault impersonating token', async () => {
      const { lender, team, weth, lenderVault } = await setupTest()

      await ethers.provider.send('hardhat_setBalance', [team.address, '0x2004FCE5E3E25026110000000'])
      await weth.connect(team).deposit({ value: ONE_WETH.mul(10) })

      await weth.connect(team).transfer(lenderVault.address, ONE_WETH.mul(10))

      const wethBalPreAttack = await weth.balanceOf(lenderVault.address)

      // create maliciousToken
      const MyMaliciousERC20 = await ethers.getContractFactory('MyMaliciousERC20')
      await MyMaliciousERC20.connect(team)
      const myMaliciousERC20 = await MyMaliciousERC20.deploy('MaliciousToken', 'MyMal', 18, ZERO_ADDR, lenderVault.address)
      await myMaliciousERC20.deployed()

      await expect(lenderVault.connect(lender).withdraw(myMaliciousERC20.address, ONE_WETH)).to.be.reverted

      const wethBalPostAttack = await weth.balanceOf(lenderVault.address)
      expect(wethBalPostAttack).to.equal(wethBalPreAttack)
    })

    it('Should not allow callbacks into withdraw(...)', async function () {
      const { lender, team, usdc, addressRegistry, lenderVault } = await setupTest()

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([usdc.address], 1)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get vault balance
      const bal = await usdc.balanceOf(lenderVault.address)

      // deploy malicious callback contract
      const MyMaliciousCallback2 = await ethers.getContractFactory('MyMaliciousCallback2')
      const myMaliciousCallback2 = await MyMaliciousCallback2.deploy(lenderVault.address, usdc.address, bal)
      await myMaliciousCallback2.deployed()

      await expect(lenderVault.connect(lender).withdraw(myMaliciousCallback2.address, 0)).to.be.revertedWithCustomError(
        lenderVault,
        'WithdrawEntered'
      )
    })

    it('Should process compartment with protocol fee and transfer fees correctly with rewards', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, paxg, lenderVault, addressRegistry } =
        await setupTest()

      // create curve staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)

      // increase borrower aWETH balance
      const locallyCollBalance = ethers.BigNumber.from(10).pow(18)
      const collTokenAddress = '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8' // aave WETH
      const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

      const poolAddress = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'
      const poolInstance = new ethers.Contract(poolAddress, aavePoolAbi, borrower.provider)

      // supply aave pool
      await weth.connect(borrower).approve(poolAddress, MAX_UINT256)
      await poolInstance.connect(borrower).supply(weth.address, locallyCollBalance, borrower.address, '0')

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get pre balances
      const borrowerCollBalPre = await collInstance.balanceOf(borrower.address)
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(borrowerCollBalPre).to.be.above(locallyCollBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address, paxg.address], 1)

      // whitelist compartment for tokens
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [paxg.address, collTokenAddress], true)

      // borrower approves borrower gateway
      await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // set protocol fee 10 bps
      await borrowerGateway.connect(team).setProtocolFeeParams([0, BASE.div(1000)])

      const onChainQuote = await createOnChainRequest({
        lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: aaveStakingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      const paxgWithCompartmentOnChainQuote = await createOnChainRequest({
        lender,
        collToken: paxg.address,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: aaveStakingCompartmentImplementation.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // borrow with on chain quote no token transfer fee
      const collSendAmount = BigNumber.from(10).pow(18)
      // 90 day tenor with 10 bps protocol fee
      const expectedProtocolAndVaultTransferFee = collSendAmount.mul(90).div(365 * 1000)
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const borrowInstructionsWithExtraVaultTransferFee = {
        ...borrowInstructions,
        expectedProtocolAndVaultTransferFee: expectedProtocolAndVaultTransferFee.add(1)
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(
            lenderVault.address,
            borrowInstructionsWithExtraVaultTransferFee,
            onChainQuote,
            quoteTupleIdx
          )
      ).to.be.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const upfrontFee = borrowEvent?.args?.['upfrontFee']
      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const aTokenCompartmentCollBal = await collInstance.balanceOf(collTokenCompartmentAddr)
      const vaultCollBalPost = await collInstance.balanceOf(lenderVault.address)

      // checks that loan currency delta is equal magnitude, but opposite sign for borrower and vault
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      // checks that loan amount = (sendAmount - transfer fee) * loanPerColl
      // note: expected transfer fee is just protocol fee since no coll token transfer fee
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(
        collSendAmount.sub(expectedProtocolAndVaultTransferFee).mul(ONE_USDC.mul(1000)).div(BASE)
      )
      // compartment coll balance = sendAmount - transfer fee - upfront fee
      expect(aTokenCompartmentCollBal).to.equal(collSendAmount.sub(expectedProtocolAndVaultTransferFee).sub(upfrontFee))
      // vault coll balance = upfrontFee
      expect(vaultCollBalPost).to.equal(upfrontFee)

      // 90 day tenor with 10 bps protocol fee
      const protocolFeeAmount = expectedProtocolAndVaultTransferFee
      const compartmentTransferAmount = collSendAmount.sub(protocolFeeAmount).sub(upfrontFee)
      // paxg transfer fee is 2 bps
      const paxgFeeOnCompartmentTransferAmount = compartmentTransferAmount.mul(2).div(10000)
      let paxgExpectedProtocolAndVaultTransferFee = protocolFeeAmount.add(paxgFeeOnCompartmentTransferAmount)

      // initially no extra upfront fee to vault transfer fee will revert
      const paxgBorrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee: paxgExpectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee: BigNumber.from(0),
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(
            lenderVault.address,
            paxgBorrowInstructions,
            paxgWithCompartmentOnChainQuote,
            quoteTupleIdx
          )
      ).to.be.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')

      const upfrontFeeFromQuote = paxgWithCompartmentOnChainQuote.quoteTuples[quoteTupleIdx].upfrontFeePctInBase
      const commonFeeNumerator = collSendAmount.sub(protocolFeeAmount)
      const commonFeeDenominator = BASE.mul(10000)

      const paxgExpectedTransferFee1Numerator = commonFeeNumerator.mul(upfrontFeeFromQuote)
      const paxgExpectedTransferFee2Numerator = commonFeeNumerator.mul(BASE.sub(upfrontFeeFromQuote))
      const paxgExpectedTransferFee1 = paxgExpectedTransferFee1Numerator.mul(2).div(commonFeeDenominator)
      const paxgExpectedTransferFee2 = paxgExpectedTransferFee2Numerator.mul(2).div(commonFeeDenominator)
      paxgExpectedProtocolAndVaultTransferFee = paxgExpectedTransferFee1.add(protocolFeeAmount)

      // now add in transfer fee on the upfront fee portion
      paxgBorrowInstructions.expectedCompartmentTransferFee = paxgExpectedTransferFee2
      paxgBorrowInstructions.expectedProtocolAndVaultTransferFee = paxgExpectedProtocolAndVaultTransferFee

      const collateralUsedForLoan = collSendAmount.sub(paxgExpectedProtocolAndVaultTransferFee).sub(paxgExpectedTransferFee2)

      const borrowWithPaxgOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, paxgBorrowInstructions, paxgWithCompartmentOnChainQuote, quoteTupleIdx)
      const borrowWithPaxgOnChainQuoteReceipt = await borrowWithPaxgOnChainQuoteTransaction.wait()

      const borrowPaxgEvent = borrowWithPaxgOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const paxgUpfrontFee = borrowPaxgEvent?.args?.['upfrontFee']
      const paxgCollTokenCompartmentAddr = borrowPaxgEvent?.args?.loan?.['collTokenCompartmentAddr']

      expect(paxgUpfrontFee).to.equal(collateralUsedForLoan.mul(upfrontFeeFromQuote).div(BASE))

      // check balance post borrow
      const borrowerUsdcBalPostPaxg = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPostPaxg = await usdc.balanceOf(lenderVault.address)
      const compartmentPaxgBal = await paxg.balanceOf(paxgCollTokenCompartmentAddr)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)

      // checks that loan currency delta is equal magnitude, but opposite sign for borrower and vault
      expect(borrowerUsdcBalPostPaxg.sub(borrowerUsdcBalPost)).to.equal(vaultUsdcBalPost.sub(vaultUsdcBalPostPaxg))
      // checks that loan amount = (sendAmount - transfer fee - transfer fee for upfront coll) * loanPerColl
      // note: expected transfer fee is just protocol fee since no coll token transfer fee
      expect(vaultUsdcBalPost.sub(vaultUsdcBalPostPaxg)).to.equal(
        collSendAmount
          .sub(paxgExpectedProtocolAndVaultTransferFee)
          .sub(paxgExpectedTransferFee2)
          .mul(ONE_USDC.mul(1000))
          .div(BASE)
      )
      // compartment coll (paxg) balance = sendAmount - transfer fee - transfer fee for upfront coll - upfront fee
      // note this still equals loan.initCollAmount
      expect(compartmentPaxgBal).to.equal(
        collSendAmount.sub(paxgExpectedProtocolAndVaultTransferFee).sub(paxgExpectedTransferFee2).sub(paxgUpfrontFee)
      )
      // vault coll (paxg) balance = upfrontFee
      expect(vaultPaxgBalPost).to.equal(paxgUpfrontFee)
    })

    it('Should process compartment with protocol fee and transfer fees correctly with high upfront fee', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, paxg, lenderVault, addressRegistry } =
        await setupTest()

      // create curve staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).setWhitelistState([usdc.address, paxg.address], 1)

      // whitelist compartment for tokens
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [paxg.address], true)

      // borrower approves borrower gateway
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // set protocol fee of 10 bps annulized and 2bp fixed protocol fee
      await borrowerGateway.connect(team).setProtocolFeeParams([BASE.div(5000), BASE.div(1000)])

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const buyPricePerCollToken = ONE_USDC.mul(1200)
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: buyPricePerCollToken,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: BASE.mul(999).div(1000),
          tenor: ONE_DAY.mul(90)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: aaveStakingCompartmentImplementation.address,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrow with on chain quote with token transfer fee
      // fixed part has 2bp protocol fee
      const fixedProtocolFeeAmount = ONE_PAXG.div(5000)
      // 90 day tenor with 10 bps variable protocol fee
      const variableProtocolFeeAmount = ONE_PAXG.mul(quoteTuples[0].tenor).div(BigNumber.from(YEAR_IN_SECONDS).mul(1000))
      const protocolFeeAmount = fixedProtocolFeeAmount.add(variableProtocolFeeAmount)
      const collSendAmount = ONE_PAXG
      const sendAmountAfterProtcolFee = collSendAmount.sub(protocolFeeAmount)
      const sendAmountForVault = sendAmountAfterProtcolFee.mul(quoteTuples[0].upfrontFeePctInBase).div(BASE)
      const sendAmountForCompartment = sendAmountAfterProtcolFee.mul(BASE.sub(quoteTuples[0].upfrontFeePctInBase)).div(BASE)

      const expectedProtocolAndVaultTransferFee = protocolFeeAmount.add(sendAmountForVault.mul(2).div(10000))
      const expectedCompartmentTransferFee = sendAmountForCompartment.mul(2).div(10000)
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const collateralUsedForLoan = collSendAmount
        .sub(expectedProtocolAndVaultTransferFee)
        .sub(expectedCompartmentTransferFee)

      const borrowWithPaxgOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithPaxgOnChainQuoteReceipt = await borrowWithPaxgOnChainQuoteTransaction.wait()

      const borrowPaxgEvent = borrowWithPaxgOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const paxgUpfrontFee = borrowPaxgEvent?.args?.['upfrontFee']
      const paxgCollTokenCompartmentAddr = borrowPaxgEvent?.args?.loan?.['collTokenCompartmentAddr']

      expect(paxgUpfrontFee).to.equal(collateralUsedForLoan.mul(quoteTuples[0].upfrontFeePctInBase).div(BASE))

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const compartmentPaxgBal = await paxg.balanceOf(paxgCollTokenCompartmentAddr)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)

      // checks that loan currency delta is equal magnitude, but opposite sign for borrower and vault
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      // checks that loan amount = (sendAmount - transfer fee - transfer fee for upfront coll) * loanPerColl
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(
        collSendAmount
          .sub(expectedProtocolAndVaultTransferFee)
          .sub(expectedCompartmentTransferFee)
          .mul(ONE_USDC.mul(1200))
          .div(ONE_PAXG)
      )
      // compartment coll (paxg) balance = sendAmount - transfer fee - transfer fee for upfront coll - upfront fee
      // note this still equals loan.initCollAmount
      expect(compartmentPaxgBal).to.equal(
        collSendAmount.sub(expectedProtocolAndVaultTransferFee).sub(expectedCompartmentTransferFee).sub(paxgUpfrontFee)
      )
      // vault coll (paxg) balance = upfrontFee
      expect(vaultPaxgBalPost).to.equal(paxgUpfrontFee)
    })

    it('Should process correctly excess vault fee when no vault transfer (compartment, no upfront fee)', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault, addressRegistry } =
        await setupTest()

      // create curve staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).setWhitelistState([usdc.address, weth.address], 1)

      // whitelist compartment for tokens
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [weth.address], true)

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // set protocol fee of 10 bps annulized and 2bp fixed protocol fee
      await borrowerGateway.connect(team).setProtocolFeeParams([BASE.div(5000), BASE.div(1000)])

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const buyPricePerCollToken = ONE_USDC.mul(1200)
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: buyPricePerCollToken,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: aaveStakingCompartmentImplementation.address,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrow with on chain quote with token transfer fee
      // fixed part has 2bp protocol fee
      const fixedProtocolFeeAmount = ONE_PAXG.div(5000)
      // 90 day tenor with 10 bps variable protocol fee
      const variableProtocolFeeAmount = ONE_PAXG.mul(quoteTuples[0].tenor).div(BigNumber.from(YEAR_IN_SECONDS).mul(1000))
      const protocolFeeAmount = fixedProtocolFeeAmount.add(variableProtocolFeeAmount)
      const collSendAmount = ONE_WETH

      const expectedProtocolAndVaultTransferFee = protocolFeeAmount.add(1)
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(borrowerGateway, 'InconsistentExpVaultBalIncrease')
    })

    it('Should handle swap with protocol fee and transfer fee correctly', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, team, borrower, usdc, paxg, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).setWhitelistState([usdc.address, paxg.address], 1)

      await borrowerGateway.connect(team).setProtocolFeeParams([BASE.div(500), BASE.div(100)])

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const buyPricePerCollToken = ONE_USDC.mul(1890)
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: buyPricePerCollToken,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: BASE,
          tenor: 0
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPre = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)
      const numLoansPre = await lenderVault.totalNumLoans()
      const lockedAmountsWethPre = await lenderVault.lockedAmounts(paxg.address)
      const lockedAmountsUsdcPre = await lenderVault.lockedAmounts(usdc.address)

      // borrower approves gateway and executes quote
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const sellAmountOfCollToken = ONE_PAXG.mul(499).div(500).mul(4999).div(5000)
      const expectedProtocolAndVaultTransferFee = ONE_PAXG.div(500).add(ONE_PAXG.mul(499).mul(2).div(10000).div(500))
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount: ONE_PAXG,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const numLoansPost = await lenderVault.totalNumLoans()
      const lockedAmountsPaxgPost = await lenderVault.lockedAmounts(paxg.address)
      const lockedAmountsUsdcPost = await lenderVault.lockedAmounts(usdc.address)

      // check balance post borrow
      expect(borrowerPaxgBalPre.sub(borrowerPaxgBalPost)).to.equal(
        vaultPaxgBalPost.sub(vaultPaxgBalPre).add(expectedProtocolAndVaultTransferFee)
      )
      expect(vaultPaxgBalPost.sub(vaultPaxgBalPre)).to.equal(sellAmountOfCollToken)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(
        buyPricePerCollToken.mul(sellAmountOfCollToken).div(ONE_PAXG)
      )

      // check no change in locked amounts
      expect(lockedAmountsPaxgPost).to.equal(lockedAmountsWethPre)
      expect(lockedAmountsPaxgPost).to.equal(0)
      expect(lockedAmountsUsdcPost).to.equal(lockedAmountsUsdcPre)
      expect(lockedAmountsUsdcPost).to.equal(0)

      // check no loan was pushed
      expect(numLoansPost).to.equal(numLoansPre)
      expect(numLoansPost).to.equal(0)

      // check no repay possible
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: 0,
            targetRepayAmount: buyPricePerCollToken,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidArrayIndex')

      // check lender can unlock swapped amount (=upfront fee) immediately
      const userPaxgBalPreWithdraw = await paxg.balanceOf(lender.address)
      const vaultPaxgBalPreWithdraw = await paxg.balanceOf(lenderVault.address)
      await lenderVault.connect(lender).withdraw(paxg.address, sellAmountOfCollToken)
      const userPaxgBalPostWithdraw = await paxg.balanceOf(lender.address)
      const vaultPaxgBalPostWithdraw = await paxg.balanceOf(lenderVault.address)
      // must account for paxg transfer fees on withdrawal
      expect(userPaxgBalPostWithdraw.sub(userPaxgBalPreWithdraw)).to.be.equal(
        vaultPaxgBalPreWithdraw.sub(vaultPaxgBalPostWithdraw).mul(4999).div(5000)
      )
      expect(userPaxgBalPostWithdraw.sub(userPaxgBalPreWithdraw)).to.be.equal(sellAmountOfCollToken.mul(4999).div(5000))
    })

    it('Should not allow callbacks into transferCollFromCompartment(...)', async function () {
      const { lender, borrower, team, weth, usdc, addressRegistry, borrowerGateway, quoteHandler, lenderVault } =
        await setupTest()

      // create curve staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      // whitelist aave compartment implementation
      await addressRegistry.connect(team).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      // whitelist weth-compartment pair
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [weth.address], true)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: aaveStakingCompartmentImplementation.address,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves and prepares borrow instructions
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // send borrow instructions and get compartment
      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()
      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })
      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']

      // deploy malicious callback contract
      const MyMaliciousCallback1 = await ethers.getContractFactory('MyMaliciousCallback1')
      const myMaliciousCallback1 = await MyMaliciousCallback1.deploy(
        lenderVault.address,
        weth.address,
        collTokenCompartmentAddr
      )
      await myMaliciousCallback1.deployed()

      // trick vault owner to call withdraw with malicious token contract that uses delegate call to call back
      // into compartment contract and try bypassing access control.
      // This is expected to revert due to mutex in vault; moreover, note that even without mutex the delegate call would
      // operate on state/balances of myMaliciousCallback rather than compartment, leaving delegate call unable to access
      // compartment balances
      await expect(lenderVault.connect(lender).withdraw(myMaliciousCallback1.address, 0)).to.be.revertedWithCustomError(
        lenderVault,
        'WithdrawEntered'
      )
    })
  })

  describe('Testing with token transfer fees', function () {
    it('Should process onChain quote with fees', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, team, usdc, paxg, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([paxg.address, usdc.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPre = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = ONE_PAXG.mul(2).div(9998)
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_PAXG.mul(10000).div(9998)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerPaxgBalPre.sub(borrowerPaxgBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(ONE_USDC.mul(1000))
      expect(
        Math.abs(Number(vaultPaxgBalPost.sub(vaultPaxgBalPre).sub(collSendAmount.mul(9998).div(10000).toString())))
      ).to.lessThanOrEqual(1)
      expect(
        Math.abs(
          Number(
            vaultUsdcBalPre
              .sub(vaultUsdcBalPost)
              .sub(onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmount.mul(9998)).div(10000).div(ONE_PAXG))
              .toString()
          )
        )
      ).to.lessThanOrEqual(1)
    })

    it('Should process onChain quote with fees including protocol fee', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, team, usdc, paxg, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      //team sets protocolFee
      const protocolFee = BigNumber.from(10).pow(16)
      await borrowerGateway.connect(team).setProtocolFeeParams([0, protocolFee]) // 1% or 100 bp protocolFee

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(90)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: 1,
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([paxg.address, usdc.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      const collSendAmount = ONE_PAXG
      const protocolFeeAmount = ONE_PAXG.mul(protocolFee).mul(ONE_DAY.mul(90)).div(BASE).div(YEAR_IN_SECONDS)
      const sendAmountPostProtocolFee = collSendAmount.sub(protocolFeeAmount)
      const tokenTransferFee = sendAmountPostProtocolFee.mul(2).div(10000)
      const totalExpectedFees = protocolFeeAmount.add(tokenTransferFee)

      // check balance pre borrow
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPre = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const quoteTupleIdx = 0
      //const collSendAmount = ONE_PAXG.mul(10000).div(9998)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee: totalExpectedFees,
        expectedCompartmentTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerPaxgBalPre.sub(borrowerPaxgBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(
        ONE_USDC.mul(1000).mul(collSendAmount.sub(totalExpectedFees)).div(ONE_PAXG)
      )
      expect(vaultPaxgBalPost.sub(vaultPaxgBalPre)).to.equal(collSendAmount.sub(totalExpectedFees))
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(
        ONE_USDC.mul(1000).mul(collSendAmount.sub(totalExpectedFees)).div(ONE_PAXG)
      )
    })

    it('Should process onChain quote and repay with loan token transfer fees', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, team, borrower, usdc, paxg, lenderVault } =
        await setupTest()

      // borrower transfers paxg to lender
      await paxg.connect(borrower).transfer(lender.address, ONE_PAXG.mul(20).mul(10000).div(9998))
      // lender transfers usdc to borroower
      await usdc.connect(lender).transfer(borrower.address, ONE_USDC.mul(100000))
      // owner approves lender vault
      await paxg.connect(lender).approve(lenderVault.address, MAX_UINT256)
      // lenderVault owner deposits paxg
      await paxg.connect(lender).transfer(lenderVault.address, ONE_PAXG.mul(20))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_PAXG.div(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: usdc.address,
          loanToken: paxg.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_PAXG.div(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([paxg.address, usdc.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPre = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }
      const borrowTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowTransactionReceipt = await borrowTransaction.wait()

      const borrowEvent = borrowTransactionReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      const loanId = borrowEvent?.args?.['loanId']

      // check balance post borrow
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const maxLoanPerCollOrLtv = quoteTuples[0].loanPerCollUnitOrLtv

      expect(borrowerPaxgBalPost.sub(borrowerPaxgBalPre)).to.equal(
        calcLoanBalanceDelta(maxLoanPerCollOrLtv, 2, collSendAmount, 6)
      )
      expect(borrowerUsdcBalPre.sub(borrowerUsdcBalPost)).to.equal(collSendAmount)
      expect(vaultUsdcBalPost.sub(vaultUsdcBalPre).sub(collSendAmount)).to.equal(0)

      expect(
        vaultPaxgBalPre.sub(vaultPaxgBalPost).sub(calcLoanBalanceDelta(maxLoanPerCollOrLtv, 0, collSendAmount, 6))
      ).to.equal(0)

      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT128)

      const repayBody = {
        targetLoanId: loanId,
        targetRepayAmount: ONE_PAXG.mul(10).mul(110).div(100),
        expectedTransferFee: transferFeeHelper(ONE_PAXG.mul(10).mul(110).div(100), 2),
        deadline: MAX_UINT256,
        callbackAddr: callbackAddr,
        callbackData: callbackData
      }

      await expect(borrowerGateway.connect(borrower).repay(repayBody, team.address)).to.be.reverted

      await expect(borrowerGateway.connect(borrower).repay({ ...repayBody, expectedTransferFee: BASE }, lenderVault.address))
        .to.be.reverted

      await expect(borrowerGateway.connect(team).repay(repayBody, lenderVault.address)).to.be.revertedWithCustomError(
        borrowerGateway,
        'InvalidBorrower'
      )

      await expect(borrowerGateway.connect(borrower).repay(repayBody, lenderVault.address))
        .to.emit(borrowerGateway, 'Repaid')
        .withArgs(lenderVault.address, loanId, ONE_PAXG.mul(10).mul(110).div(100))
      const borrowerUsdcBalPostRepay = await usdc.balanceOf(borrower.address)
      // full repay of USDC less upfront fee
      expect(borrowerUsdcBalPre.sub(borrowerUsdcBalPostRepay)).to.be.equal(collSendAmount.mul(1).div(100))
    })
  })

  describe('Testing chainlink oracles', function () {
    const aaveEthChainlinkAddr = '0x6df09e975c830ecae5bd4ed9d90f3a95a4f88012'
    const linkEthChainlinkAddr = '0xdc530d9457755926550b59e8eccdae7624181557'
    const crvEthChainlinkAddr = '0x8a12be339b0cd1829b91adc01977caa5e9ac121e'
    const usdcEthChainlinkAddr = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
    const paxgEthChainlinkAddr = '0x9b97304ea12efed0fad976fbecaad46016bf269e'
    const ldoEthChainlinkAddr = '0x4e844125952d32acdf339be976c98e22f6f318db'
    const usdtEthChainlinkAddr = '0xee9f2375b4bdf6387aa8265dd4fb8f16512a1d46'

    const aaveUsdChainlinkAddr = '0x547a514d5e3769680ce22b2361c10ea13619e8a9'
    const crvUsdChainlinkAddr = '0xcd627aa160a6fa45eb793d19ef54f5062f20f33f'
    const linkUsdChainlinkAddr = '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c'
    const usdcUsdChainlinkAddr = '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6'
    const ethUsdChainlinkAddr = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'

    it('Should process onChain quote with eth-based oracle address (non-weth)', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, usdc, paxg, weth, ldo, team, lenderVault } =
        await setupTest()

      // deploy chainlinkOracleContract
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      // deploy errors on base oracles
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy([], [usdcEthChainlinkAddr], weth.address, BASE)
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidArrayLength')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcEthChainlinkAddr],
          weth.address,
          BASE
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidArrayLength')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
          [usdcEthChainlinkAddr],
          ZERO_ADDR,
          BASE
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidAddress')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [ZERO_ADDR, paxgEthChainlinkAddr],
          weth.address,
          BASE
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidAddress')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          [ZERO_ADDR, '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
          weth.address,
          BASE
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidAddress')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcUsdChainlinkAddr, paxgEthChainlinkAddr],
          weth.address,
          BASE
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidOracleDecimals')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcUsdChainlinkAddr, paxgEthChainlinkAddr],
          lenderVault.address,
          BASE
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidOracleDecimals')

      // correct deploy
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
        [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
        weth.address,
        BASE
      )
      await chainlinkBasicImplementation.deployed()

      await expect(
        addressRegistry.connect(borrower).setWhitelistState([chainlinkBasicImplementation.address], 2)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)
      const paxgOracleInstance = new ethers.Contract(paxgEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.mul(75).div(100),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      let badOnChainQuoteAddrNotInOracle = {
        generalQuoteInfo: {
          collToken: ldo.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([paxg.address, usdc.address, ldo.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )
      await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, badOnChainQuoteAddrNotInOracle)

      // check balance pre borrow
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPre = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = ONE_PAXG.mul(2).div(9998)
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_PAXG.mul(10000).div(9998)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const badBorrowInstructionsTransferFee = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee: collSendAmount.mul(2),
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const badBorrowInstructionsBelowMinLoan = {
        collSendAmount: collSendAmount.div(1000),
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      const badBorrowInstructionsTooSmallLoanAmount = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: MAX_UINT128,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, badOnChainQuoteAddrNotInOracle, quoteTupleIdx)
      ).to.be.revertedWithCustomError(chainlinkBasicImplementation, 'NoOracle')

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, badBorrowInstructionsTransferFee, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(lenderVault, 'InsufficientSendAmount')

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, badBorrowInstructionsBelowMinLoan, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidSendAmount')

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, badBorrowInstructionsTooSmallLoanAmount, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(lenderVault, 'TooSmallLoanAmount')

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()
      const collTokenRoundData = await paxgOracleInstance.latestRoundData()
      const loanTokenPriceRaw = loanTokenRoundData.answer
      const collTokenPriceRaw = collTokenRoundData.answer

      const collTokenPriceInLoanToken = collTokenPriceRaw.mul(ONE_USDC).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      expect(borrowerPaxgBalPre.sub(borrowerPaxgBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(maxLoanPerColl)
      expect(
        Math.abs(Number(vaultPaxgBalPost.sub(vaultPaxgBalPre).sub(collSendAmount.mul(9998).div(10000).toString())))
      ).to.lessThanOrEqual(1)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(maxLoanPerColl)).to.equal(0)
    })

    it('Should process onChain quote with eth-based oracle address (coll weth)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, team, lenderVault, addressRegistry } =
        await setupTest()

      // deploy chainlinkOracleContract
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        weth.address,
        BASE
      )
      await chainlinkBasicImplementation.deployed()

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.mul(75).div(100),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)
      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedOracle')

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_WETH
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedOracle')

      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()
      const loanTokenPriceRaw = loanTokenRoundData.answer

      const collTokenPriceInLoanToken = ONE_WETH.mul(ONE_USDC).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(maxLoanPerColl)
      expect(Math.abs(Number(vaultWethBalPost.sub(vaultWethBalPre).sub(collSendAmount).toString()))).to.equal(0)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(maxLoanPerColl)).to.equal(0)
    })

    it('Should process onChain quote with eth-based oracle address (loan weth)', async function () {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        weth,
        team,
        whitelistAuthority,
        lenderVault,
        addressRegistry
      } = await setupTest()

      // deploy chainlinkOracleContract

      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        weth.address,
        BASE
      )
      await chainlinkBasicImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

      // lenderVault owner deposits weth
      await weth.connect(lender).deposit({ value: ONE_WETH.mul(1000) })
      await weth.connect(lender).transfer(lenderVault.address, ONE_WETH.mul(1000))

      // lender gives borrower USDC for collateral
      await usdc.connect(lender).transfer(borrower.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_WETH.div(10),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: usdc.address,
          loanToken: weth.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_WETH.div(100),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      // borrower approves and executes quote
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT128)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const collTokenRoundData = await usdcOracleInstance.latestRoundData()
      const collTokenPriceRaw = collTokenRoundData.answer

      const maxLoanPerColl = collTokenPriceRaw.div(10).mul(10000)

      expect(borrowerUsdcBalPre.sub(borrowerUsdcBalPost)).to.equal(collSendAmount)
      expect(borrowerWethBalPost.sub(borrowerWethBalPre)).to.equal(maxLoanPerColl)
      expect(Math.abs(Number(vaultUsdcBalPost.sub(vaultUsdcBalPre).sub(collSendAmount).toString()))).to.equal(0)
      expect(vaultWethBalPre.sub(vaultWethBalPost).sub(maxLoanPerColl)).to.equal(0)
    })

    it('Should handle pair policies correctly', async function () {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        signer,
        borrower,
        weth,
        paxg,
        ldo,
        usdc,
        team,
        lenderVault,
        addressRegistry
      } = await setupTest()

      // borrower mints weth
      await weth.connect(borrower).deposit({ value: ONE_WETH.mul(100) })

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address, paxg.address, ldo.address], 1)

      // deploy and set basic quote policy manager
      const BasicQuotePolicyManager = await ethers.getContractFactory('BasicQuotePolicyManager')
      const basicQuotePolicyManager = await BasicQuotePolicyManager.connect(team).deploy(addressRegistry.address)
      await basicQuotePolicyManager.deployed()
      await addressRegistry.connect(team).setWhitelistState([basicQuotePolicyManager.address], 10)

      // deploy chainlinkOracleContract
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        [usdc.address, paxg.address],
        [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
        weth.address,
        BASE
      )
      await chainlinkBasicImplementation.deployed()
      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

      // lender deposits
      await usdc.connect(lender).transfer(lenderVault.address, MAX_UINT128)

      // lender sets high min num of signers
      await lenderVault.connect(lender).setMinNumOfSigners(100)
      await lenderVault.connect(lender).addSigners([signer.address])

      // lender sets policy manager for his vault
      await expect(
        quoteHandler.connect(lender).updateQuotePolicyManagerForVault(lenderVault.address, basicQuotePolicyManager.address)
      )
        .to.emit(quoteHandler, 'QuotePolicyManagerUpdated')
        .withArgs(lenderVault.address, basicQuotePolicyManager.address)

      // check initial state
      expect(await basicQuotePolicyManager.hasGlobalQuotingPolicy(lenderVault.address)).to.be.false
      await expect(basicQuotePolicyManager.globalQuotingPolicy(lenderVault.address)).to.be.revertedWithCustomError(
        basicQuotePolicyManager,
        'NoPolicy'
      )
      expect(await basicQuotePolicyManager.hasPairQuotingPolicy(lenderVault.address, weth.address, usdc.address)).to.be.false
      await expect(
        basicQuotePolicyManager.pairQuotingPolicy(lenderVault.address, weth.address, usdc.address)
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'NoPolicy')

      // lender defines global policy
      const globalQuoteBounds = {
        minTenor: ONE_DAY.mul(11),
        maxTenor: ONE_DAY.mul(11),
        minFee: BASE.mul(11).div(100),
        minApr: BASE.mul(11).div(100),
        minEarliestRepayTenor: ethers.BigNumber.from(0),
        minLtv: BASE.mul(11).div(100),
        maxLtv: BASE.mul(11).div(100),
        minLoanPerCollUnit: ONE_USDC.mul(100),
        maxLoanPerCollUnit: ONE_USDC.mul(10000)
      }
      let globalRequiresOracle = false
      let globalPolicyData = encodeGlobalPolicy(globalQuoteBounds, globalRequiresOracle)

      // check revert when trying to delete global policy although not yet set
      await expect(
        basicQuotePolicyManager.connect(lender).setGlobalPolicy(lenderVault.address, '0x')
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'NoPolicyToDelete')

      // lender produces off-chain quote
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE,
          interestRatePctInBase: globalQuoteBounds.minApr.mul(ONE_DAY).div(ONE_DAY.mul(365)),
          upfrontFeePctInBase: BASE.mul(11).div(100),
          tenor: ONE_DAY
        },
        {
          loanPerCollUnitOrLtv: BASE,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: BASE.mul(11).div(100),
          tenor: ONE_DAY.mul(11)
        },
        {
          loanPerCollUnitOrLtv: BASE,
          interestRatePctInBase: globalQuoteBounds.minApr.mul(ONE_DAY).div(ONE_DAY.mul(365)).add(1),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(11)
        },
        {
          loanPerCollUnitOrLtv: BASE.mul(1).div(100),
          interestRatePctInBase: BASE.mul(22).div(100),
          upfrontFeePctInBase: BASE.mul(22).div(100),
          tenor: ONE_DAY.mul(11)
        },
        {
          loanPerCollUnitOrLtv: BASE.mul(33).div(100),
          interestRatePctInBase: BASE.mul(22).div(100),
          upfrontFeePctInBase: BASE.mul(22).div(100),
          tenor: ONE_DAY.mul(11)
        },
        {
          loanPerCollUnitOrLtv: BASE.mul(11).div(100),
          interestRatePctInBase: BASE.mul(22).div(100),
          upfrontFeePctInBase: BASE.mul(22).div(100),
          tenor: ONE_DAY.mul(11)
        },
        {
          loanPerCollUnitOrLtv: BASE,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: BASE,
          tenor: 0
        }
      ]
      const { offChainQuote, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault: lenderVault,
        signer: signer,
        collTokenAddr: weth.address,
        loanTokenAddr: usdc.address,
        oracleAddr: chainlinkBasicImplementation.address,
        quoteTuples: quoteTuples
      })

      // borrower obtains proof for chosen quote tuple
      let quoteTupleIdx = 0
      let selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      let proof = quoteTuplesTree.getProof(quoteTupleIdx)
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // borrower approves gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // check revert if borrow violates policy (here because no global policy is set in which case
      // per default all pairs are blocked)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // add global policy to allow all pairs
      globalPolicyData = encodeGlobalPolicy(globalQuoteBounds, globalRequiresOracle)
      await basicQuotePolicyManager.connect(lender).setGlobalPolicy(lenderVault.address, globalPolicyData)

      // check global policy is set correctly
      expect(await basicQuotePolicyManager.hasGlobalQuotingPolicy(lenderVault.address)).to.be.true
      const actGlobalPolicyData = await basicQuotePolicyManager.globalQuotingPolicy(lenderVault.address)
      expect(actGlobalPolicyData.requiresOracle).to.be.equal(globalRequiresOracle)
      expect(actGlobalPolicyData.quoteBounds.minTenor).to.be.equal(globalQuoteBounds.minTenor)
      expect(actGlobalPolicyData.quoteBounds.maxTenor).to.be.equal(globalQuoteBounds.maxTenor)
      expect(actGlobalPolicyData.quoteBounds.minFee).to.be.equal(globalQuoteBounds.minFee)
      expect(actGlobalPolicyData.quoteBounds.minApr).to.be.equal(globalQuoteBounds.minApr)
      expect(actGlobalPolicyData.quoteBounds.minEarliestRepayTenor).to.be.equal(globalQuoteBounds.minEarliestRepayTenor)
      expect(actGlobalPolicyData.quoteBounds.minLtv).to.be.equal(globalQuoteBounds.minLtv)
      expect(actGlobalPolicyData.quoteBounds.maxLtv).to.be.equal(globalQuoteBounds.maxLtv)

      // check revert if borrow violates policy (here because min signer threshold is breached)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // lender sets lower min num of signers
      await lenderVault.connect(lender).setMinNumOfSigners(1)
      // check revert if borrow violates policy (here because tenor is too short)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // use other tuple
      quoteTupleIdx = 1
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      // check revert if borrow violates policy (here because interest too low)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // use other tuple
      quoteTupleIdx = 2
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      // check revert if borrow violates policy (here because upfront fee is too low)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // use other tuple
      quoteTupleIdx = 3
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      // check revert if borrow violates policy (here because LTV too low)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // use other tuple
      quoteTupleIdx = 4
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      // check revert if borrow violates policy (here because LTV too high)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // use other tuple
      quoteTupleIdx = 5
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      // borrow should go through
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // lender sets higher min num of signers again (test that overwrite works)
      await lenderVault.connect(lender).setMinNumOfSigners(100)

      // lender defines less strict pair policy
      const pairQuoteBounds = {
        minTenor: ONE_DAY.mul(10),
        maxTenor: ONE_DAY.mul(365),
        minFee: ethers.BigNumber.from(0),
        minApr: ethers.BigNumber.from(0),
        minEarliestRepayTenor: ethers.BigNumber.from(0),
        minLtv: BASE.mul(1).div(100),
        maxLtv: BASE.sub(1)
      }
      const minLoanPerColl = ethers.BigNumber.from(1)
      const maxLoanPerColl = ethers.BigNumber.from(1)

      const pairRequiresOracle = true
      const pairMinNumOfSignersOverwrite = 1
      let pairPolicyData = encodePairPolicy(
        pairQuoteBounds,
        minLoanPerColl,
        maxLoanPerColl,
        pairRequiresOracle,
        pairMinNumOfSignersOverwrite
      )

      // check revert when trying to delete pair policy although not yet set
      await expect(
        basicQuotePolicyManager.connect(lender).setPairPolicy(lenderVault.address, weth.address, usdc.address, '0x')
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'NoPolicyToDelete')

      // check revert for pair policy with either token being zero address
      await expect(
        basicQuotePolicyManager.connect(lender).setPairPolicy(lenderVault.address, ZERO_ADDR, usdc.address, pairPolicyData)
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'InvalidAddress')
      await expect(
        basicQuotePolicyManager.connect(lender).setPairPolicy(lenderVault.address, weth.address, ZERO_ADDR, pairPolicyData)
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'InvalidAddress')
      await expect(
        basicQuotePolicyManager.connect(lender).setPairPolicy(lenderVault.address, ZERO_ADDR, ZERO_ADDR, pairPolicyData)
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'InvalidAddress')

      // set pair policy
      await basicQuotePolicyManager
        .connect(lender)
        .setPairPolicy(lenderVault.address, weth.address, usdc.address, pairPolicyData)

      const actPairPolicyData = await basicQuotePolicyManager.pairQuotingPolicy(
        lenderVault.address,
        weth.address,
        usdc.address
      )
      expect(actPairPolicyData.requiresOracle).to.be.equal(pairRequiresOracle)
      expect(actPairPolicyData.minNumOfSignersOverwrite).to.be.equal(pairMinNumOfSignersOverwrite)
      expect(actPairPolicyData.quoteBounds.minTenor).to.be.equal(pairQuoteBounds.minTenor)
      expect(actPairPolicyData.quoteBounds.maxTenor).to.be.equal(pairQuoteBounds.maxTenor)
      expect(actPairPolicyData.quoteBounds.minFee).to.be.equal(pairQuoteBounds.minFee)
      expect(actPairPolicyData.quoteBounds.minApr).to.be.equal(pairQuoteBounds.minApr)
      expect(actPairPolicyData.quoteBounds.minEarliestRepayTenor).to.be.equal(pairQuoteBounds.minEarliestRepayTenor)
      expect(actPairPolicyData.minLoanPerCollUnit).to.be.equal(minLoanPerColl)
      expect(actPairPolicyData.maxLoanPerCollUnit).to.be.equal(maxLoanPerColl)
      expect(actPairPolicyData.quoteBounds.minLtv).to.be.equal(pairQuoteBounds.minLtv)
      expect(actPairPolicyData.quoteBounds.maxLtv).to.be.equal(pairQuoteBounds.maxLtv)

      // check revert when trying to set same policy again
      await expect(
        basicQuotePolicyManager
          .connect(lender)
          .setPairPolicy(lenderVault.address, weth.address, usdc.address, pairPolicyData)
      ).to.be.revertedWithCustomError(basicQuotePolicyManager, 'PolicyAlreadySet')

      // check revert if borrow violates policy (here because LTV too high)
      quoteTupleIdx = 0
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // check revert if borrow violates policy (here because LTV too high)
      quoteTupleIdx = 1
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // check revert if borrow violates policy (here because LTV too high)
      quoteTupleIdx = 2
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // borrow should go through
      quoteTupleIdx = 3
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // borrow should go through
      quoteTupleIdx = 4
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // borrow should go through
      quoteTupleIdx = 5
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // delete global policy
      await basicQuotePolicyManager.connect(lender).setGlobalPolicy(lenderVault.address, '0x')
      expect(await basicQuotePolicyManager.hasGlobalQuotingPolicy(lenderVault.address)).to.be.false

      // check borrow should still go through
      quoteTupleIdx = 5
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // swap should initially revert
      quoteTupleIdx = 6
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // update pair policy
      pairQuoteBounds.minTenor = ethers.BigNumber.from(0)
      pairQuoteBounds.maxLtv = BASE
      pairPolicyData = encodePairPolicy(
        pairQuoteBounds,
        minLoanPerColl,
        maxLoanPerColl,
        pairRequiresOracle,
        pairMinNumOfSignersOverwrite
      )
      await basicQuotePolicyManager
        .connect(lender)
        .setPairPolicy(lenderVault.address, weth.address, usdc.address, pairPolicyData)

      // swap should now go through
      quoteTupleIdx = 6
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // delete pair policy
      await basicQuotePolicyManager.connect(lender).setPairPolicy(lenderVault.address, weth.address, usdc.address, '0x')
      expect(await basicQuotePolicyManager.hasPairQuotingPolicy(lenderVault.address, weth.address, usdc.address)).to.be.false

      // check borrow shouldn't go through anymore
      quoteTupleIdx = 5
      selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      proof = quoteTuplesTree.getProof(quoteTupleIdx)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')
    })

    it('Should process off-chain quote with too high ltv or negative rate correctly', async function () {
      const { borrowerGateway, lender, signer, borrower, team, usdc, weth, lenderVault, addressRegistry } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const preTotalNumSigners = await lenderVault.totalNumSigners()
      await lenderVault.connect(lender).addSigners([team.address])
      const postTotalNumSigners = await lenderVault.totalNumSigners()
      expect(postTotalNumSigners.sub(preTotalNumSigners)).to.be.equal(1)

      // deploy chainlinkOracleContract
      const usdcEthChainlinkAddr = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        [usdc.address],
        [usdcEthChainlinkAddr],
        weth.address,
        BASE
      )
      await chainlinkBasicImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

      let badQuoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.add(1),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.sub(BASE.mul(3)),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]

      const badQuoteTuplesTree = StandardMerkleTree.of(
        badQuoteTuples.map(quoteTuple => Object.values(quoteTuple)),
        ['uint256', 'int256', 'uint256', 'uint256']
      )
      const badQuoteTuplesRoot = badQuoteTuplesTree.root

      let offChainQuoteWithBadTuples = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuplesRoot: badQuoteTuplesRoot,
        salt: ZERO_BYTES32,
        nonce: 0,
        v: [0],
        r: [ZERO_BYTES32],
        s: [ZERO_BYTES32]
      }

      const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
        offChainQuoteWithBadTuples.generalQuoteInfo,
        offChainQuoteWithBadTuples.quoteTuplesRoot,
        offChainQuoteWithBadTuples.salt,
        offChainQuoteWithBadTuples.nonce,
        lenderVault.address,
        HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId
      ])

      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await signer.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const compactSig = sig.compact
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      expect(recoveredAddr).to.equal(signer.address)

      // add signer
      await lenderVault.connect(lender).addSigners([signer.address])

      // lender add sig to quote and pass to borrower
      offChainQuoteWithBadTuples.compactSigs = [compactSig]

      // borrower obtains proof for quote tuple idx 0
      let quoteTupleIdx = 0
      let selectedQuoteTuple = badQuoteTuples[quoteTupleIdx]
      let proof = badQuoteTuplesTree.getProof(quoteTupleIdx)

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // too large ltv reverts
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(
            lenderVault.address,
            borrowInstructions,
            offChainQuoteWithBadTuples,
            selectedQuoteTuple,
            proof
          )
      ).to.be.revertedWithCustomError(lenderVault, 'LtvHigherThanMax')

      // borrower obtains proof for quote tuple idx 1
      quoteTupleIdx = 1
      selectedQuoteTuple = badQuoteTuples[quoteTupleIdx]
      proof = badQuoteTuplesTree.getProof(quoteTupleIdx)

      // repayment amount negative reverts
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(
            lenderVault.address,
            borrowInstructions,
            offChainQuoteWithBadTuples,
            selectedQuoteTuple,
            proof
          )
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidInterestRateFactor')
    })

    it('Should process onChain quote with olympus gohm oracle (non-weth, gohm is coll)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, gohm, weth, ldo, team, lenderVault, addressRegistry } =
        await setupTest()

      // deploy chainlinkOracleContract
      const ohmEthChainlinkAddr = '0x9a72298ae3886221820B1c878d12D872087D3a23'
      const OlympusOracleImplementation = await ethers.getContractFactory('OlympusOracle')
      const olympusOracleImplementation = await OlympusOracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr]
      )
      await olympusOracleImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([olympusOracleImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)
      const ohmOracleInstance = new ethers.Contract(ohmEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)
      const gohmInstance = new ethers.Contract(gohm.address, gohmAbi, borrower.provider)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      await gohm.connect(team).transfer(borrower.address, ONE_GOHM.mul(10))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.mul(75).div(100),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: gohm.address,
          loanToken: usdc.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithNeitherAddressGohm = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithNoOracle = {
        generalQuoteInfo: {
          collToken: gohm.address,
          loanToken: ldo.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).setWhitelistState([gohm.address, usdc.address, ldo.address, weth.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuoteWithNeitherAddressGohm)
      await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuoteWithNoOracle)

      // check balance pre borrow
      const borrowerGohmBalPre = await gohm.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultGohmBalPre = await gohm.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await gohm.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_GOHM
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuoteWithNeitherAddressGohm, quoteTupleIdx)
      ).to.be.revertedWithCustomError(olympusOracleImplementation, 'NeitherTokenIsGOHM')

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuoteWithNoOracle, quoteTupleIdx)
      ).to.be.revertedWithCustomError(olympusOracleImplementation, 'NoOracle')

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerGohmBalPost = await gohm.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultGohmBalPost = await gohm.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      // retrieve prices directly from chainlink
      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()
      const collTokenRoundDataPreIndex = await ohmOracleInstance.latestRoundData()
      const loanTokenPriceRaw = loanTokenRoundData.answer
      const collTokenPriceRawPreIndex = collTokenRoundDataPreIndex.answer
      const index = await gohmInstance.index()
      // take into account index to determine gohm price
      const SOHM_DECIMALS = ethers.BigNumber.from(10).pow(9)
      const collTokenPriceRawPostIndex = collTokenPriceRawPreIndex.mul(index).div(SOHM_DECIMALS)

      // retrieve prices from myso oracle (implicitly takes into account gohm index)
      const tokenPrices = await olympusOracleImplementation.getRawPrices(gohm.address, usdc.address)

      // check that retrieved prices match
      expect(collTokenPriceRawPostIndex).to.be.equal(tokenPrices[0])
      expect(loanTokenPriceRaw).to.be.equal(tokenPrices[1])

      const loanPerCollUnit = BASE.mul(75).div(100)
      const maxLoanPerColl = loanPerCollUnit.mul(collTokenPriceRawPostIndex).mul(ONE_USDC).div(loanTokenPriceRaw).div(BASE)

      expect(borrowerGohmBalPre.sub(borrowerGohmBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(maxLoanPerColl)
      expect(Math.abs(Number(vaultGohmBalPost.sub(vaultGohmBalPre).sub(collSendAmount).toString()))).to.equal(0)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(maxLoanPerColl)).to.equal(0)
    })

    it('Should process onChain quote with olympus gohm oracle (non-weth, gohm is loan)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, gohm, weth, team, lenderVault, addressRegistry } =
        await setupTest()

      // deploy chainlinkOracleContract
      const ohmEthChainlinkAddr = '0x9a72298ae3886221820B1c878d12D872087D3a23'
      const OlympusOracleImplementation = await ethers.getContractFactory('OlympusOracle')
      const olympusOracleImplementation = await OlympusOracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr]
      )
      await olympusOracleImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([olympusOracleImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)
      const ohmOracleInstance = new ethers.Contract(ohmEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)
      const gohmInstance = new ethers.Contract(gohm.address, gohmAbi, borrower.provider)

      // lenderVault owner deposits gohm
      await gohm.connect(team).transfer(lenderVault.address, ONE_GOHM.mul(10))

      await usdc.connect(lender).transfer(borrower.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.mul(75).div(100),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: usdc.address,
          loanToken: gohm.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).setWhitelistState([gohm.address, usdc.address, weth.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerGohmBalPre = await gohm.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultGohmBalPre = await gohm.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerGohmBalPost = await gohm.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultGohmBalPost = await gohm.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const collTokenRoundData = await usdcOracleInstance.latestRoundData()
      const loanTokenRoundDataPreIndex = await ohmOracleInstance.latestRoundData()
      const collTokenPriceRaw = collTokenRoundData.answer
      const loanTokenPriceRawPreIndex = loanTokenRoundDataPreIndex.answer
      const index = await gohmInstance.index()

      const collTokenPriceInLoanToken = collTokenPriceRaw
        .mul(ONE_GOHM)
        .mul(10 ** 9)
        .div(loanTokenPriceRawPreIndex)
        .div(index)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      expect(borrowerGohmBalPost.sub(borrowerGohmBalPre)).to.equal(maxLoanPerColl.mul(10000))
      expect(borrowerUsdcBalPre.sub(borrowerUsdcBalPost)).to.equal(collSendAmount)
      expect(Math.abs(Number(vaultGohmBalPre.sub(vaultGohmBalPost).sub(maxLoanPerColl.mul(10000)).toString()))).to.equal(0)
      expect(vaultUsdcBalPost.sub(vaultUsdcBalPre).sub(collSendAmount)).to.equal(0)
    })

    it('Should process onChain quote with uni v2 oracle (usdc-weth, lp is coll)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, gohm, team, lenderVault, addressRegistry } =
        await setupTest()

      // prepare UniV2 Weth/Usdc balances
      const UNIV2_WETH_USDC_ADDRESS = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
      const UNIV2_WETH_USDC_HOLDER = '0xeC08867a12546ccf53b32efB8C23bb26bE0C04f1'
      const uniV2WethUsdc = await ethers.getContractAt('IWETH', UNIV2_WETH_USDC_ADDRESS)
      await ethers.provider.send('hardhat_setBalance', [UNIV2_WETH_USDC_HOLDER, '0x56BC75E2D63100000'])
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [UNIV2_WETH_USDC_HOLDER]
      })

      const univ2WethUsdcHolder = await ethers.getSigner(UNIV2_WETH_USDC_HOLDER)

      await uniV2WethUsdc.connect(univ2WethUsdcHolder).transfer(team.address, '3000000000000000')

      // deploy chainlinkOracleContract
      const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')
      // deploy error uni oracle
      await expect(
        UniV2OracleImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
          [usdcEthChainlinkAddr],
          [ZERO_ADDR],
          500
        )
      ).to.be.revertedWithCustomError(UniV2OracleImplementation, 'InvalidAddress')
      await expect(
        UniV2OracleImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
          [usdcEthChainlinkAddr],
          [],
          500
        )
      ).to.be.revertedWithCustomError(UniV2OracleImplementation, 'InvalidArrayLength')
      // deploy correctly
      const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        [uniV2WethUsdc.address],
        500
      )
      await uniV2OracleImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

      await uniV2WethUsdc.connect(team).transfer(borrower.address, ONE_WETH.div(1000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.mul(75).div(100),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: uniV2WethUsdc.address,
          loanToken: usdc.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithNoLpTokens = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithLoanTokenNoOracle = {
        generalQuoteInfo: {
          collToken: uniV2WethUsdc.address,
          loanToken: gohm.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry
        .connect(team)
        .setWhitelistState([uniV2WethUsdc.address, usdc.address, weth.address, gohm.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuoteWithNoLpTokens)
      await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuoteWithLoanTokenNoOracle)

      // check balance pre borrow
      const borrowerUniV2WethUsdcBalPre = await uniV2WethUsdc.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUniV2WethUsdcBalPre = await uniV2WethUsdc.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await uniV2WethUsdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_WETH.div(1000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuoteWithNoLpTokens, quoteTupleIdx)
      ).to.be.revertedWithCustomError(uniV2OracleImplementation, 'NoLpTokens')

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuoteWithLoanTokenNoOracle, quoteTupleIdx)
      ).to.be.revertedWithCustomError(uniV2OracleImplementation, 'NoOracle')

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerUniV2WethUsdcBalPost = await uniV2WethUsdc.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUniV2WethUsdcBalPost = await uniV2WethUsdc.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()

      const FairReservesPriceAndEthValue = await getFairReservesPriceAndEthValue(
        uniV2WethUsdc.address,
        borrower,
        usdcEthChainlinkAddr,
        weth.address,
        weth.address
      )

      const loanTokenPriceRaw = loanTokenRoundData.answer
      const collTokenPriceRaw = FairReservesPriceAndEthValue.fairPriceOfLpToken

      const collTokenPriceInLoanToken = collTokenPriceRaw.mul(ONE_USDC).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      const borrowerUsdcDelta = Number(borrowerUsdcBalPost.sub(borrowerUsdcBalPre).toString())
      const vaultUsdcDelta = Number(vaultUsdcBalPost.sub(vaultUsdcBalPre).toString())
      const estimatedBorrowerUsdcDelta = Number(maxLoanPerColl.div(1000).toString())
      const estimatedVaultUsdcDelta = Number(maxLoanPerColl.div(1000).toString())

      expect(borrowerUniV2WethUsdcBalPre.sub(borrowerUniV2WethUsdcBalPost)).to.equal(collSendAmount)
      // expect JS and solidity math to be off by less than 0.0001%
      expect(Math.abs(borrowerUsdcDelta - estimatedBorrowerUsdcDelta) / borrowerUsdcDelta).to.be.lessThan(0.000001)
      expect(
        Math.abs(Number(vaultUniV2WethUsdcBalPost.sub(vaultUniV2WethUsdcBalPre).sub(collSendAmount).toString()))
      ).to.equal(0)
      // expect JS and solidity math to be off by less than 0.0001%
      expect(Math.abs(vaultUsdcDelta - estimatedVaultUsdcDelta) / vaultUsdcDelta).to.be.lessThan(0.000001)
    })

    it('Should process onChain quote with uni v2 oracle (usdc-weth, lp is loan)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, team, lenderVault, addressRegistry } =
        await setupTest()

      // prepare UniV2 Weth/Usdc balances
      const UNIV2_WETH_USDC_ADDRESS = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
      const UNIV2_WETH_USDC_HOLDER = '0xeC08867a12546ccf53b32efB8C23bb26bE0C04f1'
      const uniV2WethUsdc = await ethers.getContractAt('IWETH', UNIV2_WETH_USDC_ADDRESS)
      await ethers.provider.send('hardhat_setBalance', [UNIV2_WETH_USDC_HOLDER, '0x56BC75E2D63100000'])
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [UNIV2_WETH_USDC_HOLDER]
      })

      const univ2WethUsdcHolder = await ethers.getSigner(UNIV2_WETH_USDC_HOLDER)

      await uniV2WethUsdc.connect(univ2WethUsdcHolder).transfer(team.address, '3000000000000000')

      // deploy chainlinkOracleContract
      const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')
      const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        [uniV2WethUsdc.address],
        500
      )
      await uniV2OracleImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(borrower.address, ONE_USDC.mul(10000000))

      await uniV2WethUsdc.connect(team).transfer(lenderVault.address, ONE_WETH.div(1000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE.mul(75).div(100),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(365)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: usdc.address,
          loanToken: uniV2WethUsdc.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDR,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).setWhitelistState([uniV2WethUsdc.address, usdc.address], 1)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerUniV2WethUsdcBalPre = await uniV2WethUsdc.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUniV2WethUsdcBalPre = await uniV2WethUsdc.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerUniV2WethUsdcBalPost = await uniV2WethUsdc.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUniV2WethUsdcBalPost = await uniV2WethUsdc.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const collTokenRoundData = await usdcOracleInstance.latestRoundData()

      const FairReservesPriceAndEthValue = await getFairReservesPriceAndEthValue(
        uniV2WethUsdc.address,
        borrower,
        usdcEthChainlinkAddr,
        weth.address,
        weth.address
      )

      const collTokenPriceRaw = collTokenRoundData.answer
      const loanTokenPriceRaw = FairReservesPriceAndEthValue.fairPriceOfLpToken

      const collTokenPriceInLoanToken = collTokenPriceRaw.mul(ONE_WETH).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      const borrowerLpDelta = Number(borrowerUniV2WethUsdcBalPost.sub(borrowerUniV2WethUsdcBalPre).toString())
      const vaultLpDelta = Number(vaultUniV2WethUsdcBalPre.sub(vaultUniV2WethUsdcBalPost).toString())
      const estimatedBorrowerLpDelta = Number(maxLoanPerColl.mul(10000).toString())
      const estimatedVaultLpDelta = Number(maxLoanPerColl.mul(10000).toString())

      // expect JS and solidity math to be off by less than 0.0001%
      expect(Math.abs(estimatedBorrowerLpDelta - borrowerLpDelta) / borrowerLpDelta).to.be.lessThan(0.000001)
      expect(borrowerUsdcBalPre.sub(borrowerUsdcBalPost)).to.equal(collSendAmount)
      // expect JS and solidity math to be off by less than 0.0001%
      expect(Math.abs(estimatedVaultLpDelta - vaultLpDelta) / vaultLpDelta).to.be.lessThan(0.000001)
      expect(vaultUsdcBalPost.sub(vaultUsdcBalPre).sub(collSendAmount)).to.equal(0)
    })

    describe('Should handle getPrice correctly', async function () {
      it('Should process chainlink oracle prices correctly', async function () {
        const { addressRegistry, usdc, paxg, weth, wbtc, ldo, team } = await setupTest()

        // deploy chainlinkOracleContract
        const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')

        const aaveAddr = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
        const crvAddr = '0xD533a949740bb3306d119CC777fa900bA034cd52'
        const linkAddr = '0x514910771AF9Ca656af840dff83E8264EcF986CA'
        // correct deploy
        const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
          [usdc.address, paxg.address, ldo.address, aaveAddr, crvAddr, linkAddr],
          [
            usdcEthChainlinkAddr,
            paxgEthChainlinkAddr,
            ldoEthChainlinkAddr,
            aaveEthChainlinkAddr,
            crvEthChainlinkAddr,
            linkEthChainlinkAddr
          ],
          weth.address,
          BASE
        )
        await chainlinkBasicImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

        // prices on 2-16-2023
        const aaveCollUSDCLoanPrice = await chainlinkBasicImplementation.getPrice(aaveAddr, usdc.address) // aave was 85-90$ that day
        const crvCollUSDCLoanPrice = await chainlinkBasicImplementation.getPrice(crvAddr, usdc.address) // crv was 1.10-1.20$ that day
        const linkCollUSDCLoanPrice = await chainlinkBasicImplementation.getPrice(linkAddr, usdc.address) // link was 7-7.50$ that day
        const ldoCollUSDCLoanPrice = await chainlinkBasicImplementation.getPrice(ldo.address, usdc.address) // ldo was 2.50-3$ that day
        const paxgCollUSDCLoanPrice = await chainlinkBasicImplementation.getPrice(paxg.address, usdc.address) // paxg was 1800-1830$ that day
        const wethCollUSDCLoanPrice = await chainlinkBasicImplementation.getPrice(weth.address, usdc.address) // weth was 1650-1700$ that day

        const wethCollPaxgLoanPrice = await chainlinkBasicImplementation.getPrice(weth.address, paxg.address) // weth was 1650-1700$ and paxg was 1800-1830$ that day
        const aaveCollPaxgLoanPrice = await chainlinkBasicImplementation.getPrice(aaveAddr, paxg.address) // aave was 85-90$ and paxg was 1800-1830$ that day

        const wethCollLdoLoanPrice = await chainlinkBasicImplementation.getPrice(weth.address, ldo.address) // weth was 1650-1700$ and ldo was 2.50-3$ that day

        const paxgCollWethLoanPrice = await chainlinkBasicImplementation.getPrice(paxg.address, weth.address) // paxg was 1800-1830$ and weth was 1650-1700$ that day
        const aaveCollWethLoanPrice = await chainlinkBasicImplementation.getPrice(aaveAddr, weth.address) // aave was 85-90$ and weth was 1650-1700$ that day
        const ldoCollWethLoanPrice = await chainlinkBasicImplementation.getPrice(ldo.address, weth.address) // ldo was 2.50-3$ and weth was 1650-1700$ that day

        expect(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollUSDCLoanPrice, 6))) / 100).to.be.within(85, 90)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(crvCollUSDCLoanPrice, 6))) / 100).to.be.within(1.1, 1.2)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(linkCollUSDCLoanPrice, 6))) / 100).to.be.within(7, 7.5)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(ldoCollUSDCLoanPrice, 6))) / 100).to.be.within(2.5, 3)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(paxgCollUSDCLoanPrice, 6))) / 100).to.be.within(1800, 1830)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollUSDCLoanPrice, 6))) / 100).to.be.within(1650, 1700)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollPaxgLoanPrice, 18))) / 100).to.be.within(0.9, 1)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollPaxgLoanPrice, 18))) / 100).to.be.within(0.04, 0.06)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollLdoLoanPrice, 18))) / 100).to.be.within(600, 605)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(paxgCollWethLoanPrice, 18))) / 100).to.be.within(1, 1.1)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollWethLoanPrice, 18))) / 100).to.be.within(0.04, 0.06)
        expect(Math.round(10000 * Number(ethers.utils.formatUnits(ldoCollWethLoanPrice, 18))) / 10000).to.be.within(
          0.001,
          0.002
        )

        // toggle to show logs
        const showLogs = false
        if (showLogs) {
          // in terms of USDC
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollUSDCLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(crvCollUSDCLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(linkCollUSDCLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(ldoCollUSDCLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(paxgCollUSDCLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollUSDCLoanPrice, 6))) / 100)

          // in terms of PAXG
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollPaxgLoanPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollPaxgLoanPrice, 18))) / 100)

          // in terms of LDO
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollLdoLoanPrice, 18))) / 100)

          // in terms of WETH
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(paxgCollWethLoanPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollWethLoanPrice, 18))) / 100)
          console.log(Math.round(10000 * Number(ethers.utils.formatUnits(ldoCollWethLoanPrice, 18))) / 10000)
        }

        // deploy chainlinkOracleContract
        const ChainlinkBasicWbtcUSDImplementation = await ethers.getContractFactory('ChainlinkBasicWithWbtc')
        const chainlinkBasicWbtcUSDImplementation = await ChainlinkBasicWbtcUSDImplementation.connect(team).deploy(
          [usdc.address, aaveAddr, crvAddr, linkAddr, weth.address],
          [usdcUsdChainlinkAddr, aaveUsdChainlinkAddr, crvUsdChainlinkAddr, linkUsdChainlinkAddr, ethUsdChainlinkAddr]
        )
        await chainlinkBasicWbtcUSDImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([chainlinkBasicWbtcUSDImplementation.address], 2)

        // prices on 2-16-2023
        const aaveCollUSDCLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(aaveAddr, usdc.address) // aave was 85-90$ that day
        const crvCollUSDCLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(crvAddr, usdc.address) // crv was 1.10-1.20$ that day
        const linkCollUSDCLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(linkAddr, usdc.address) // link was 7-7.50$ that day
        const wethCollUSDCLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(weth.address, usdc.address) // weth was 1650-1700$ that day

        const aaveCollLinkLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(aaveAddr, linkAddr) // aave was 85-90$ and link was 7-7.50$ that day
        const wethCollLinkLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(weth.address, linkAddr) // weth was 1650-1700$ and link was 7-7.50$ that day
        const crvCollLinkLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(crvAddr, linkAddr) // crv was 1.10-1.20$ and link was 7-7.50$ that day
        const usdcCollLinkLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(usdc.address, linkAddr) // usdc was 1$ and link was 7-7.50$ that day

        const aaveCollWethLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(aaveAddr, weth.address) // aave was 85-90$ and weth was 1650-1700$ that day
        const crvCollWethLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(crvAddr, weth.address) // crv was 1.10-1.20$ and weth was 1650-1700$ that day
        const usdcCollWethLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(usdc.address, weth.address) // usdc was 1$ and weth was 1650-1700$ that day

        expect(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollUSDCLoanPriceUSD, 6))) / 100).to.be.within(85, 90)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(crvCollUSDCLoanPriceUSD, 6))) / 100).to.be.within(1.1, 1.2)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(linkCollUSDCLoanPriceUSD, 6))) / 100).to.be.within(7, 7.5)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollUSDCLoanPriceUSD, 6))) / 100).to.be.within(
          1650,
          1700
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollLinkLoanPriceUSD, 18))) / 100).to.be.within(12, 13)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollLinkLoanPriceUSD, 18))) / 100).to.be.within(230, 235)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(crvCollLinkLoanPriceUSD, 18))) / 100).to.be.within(
          0.13,
          0.16
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(usdcCollLinkLoanPriceUSD, 18))) / 100).to.be.within(
          0.13,
          0.16
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollWethLoanPriceUSD, 18))) / 100).to.be.within(
          0.04,
          0.06
        )
        expect(Math.round(10000 * Number(ethers.utils.formatUnits(crvCollWethLoanPriceUSD, 18))) / 10000).to.be.within(
          0.0006,
          0.0008
        )
        expect(Math.round(10000 * Number(ethers.utils.formatUnits(usdcCollWethLoanPriceUSD, 18))) / 10000).to.be.within(
          0.0005,
          0.0007
        )

        if (showLogs) {
          // in terms of USDC
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollUSDCLoanPriceUSD, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(crvCollUSDCLoanPriceUSD, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(linkCollUSDCLoanPriceUSD, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollUSDCLoanPriceUSD, 6))) / 100)

          // in terms of LINK
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollLinkLoanPriceUSD, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollLinkLoanPriceUSD, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(crvCollLinkLoanPriceUSD, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(usdcCollLinkLoanPriceUSD, 18))) / 100)

          // in terms of WETH
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(aaveCollWethLoanPriceUSD, 18))) / 100)
          console.log(Math.round(10000 * Number(ethers.utils.formatUnits(crvCollWethLoanPriceUSD, 18))) / 10000)
          console.log(Math.round(10000 * Number(ethers.utils.formatUnits(usdcCollWethLoanPriceUSD, 18))) / 10000)
        }

        // btc testing
        const wbtcCollUSDCLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(wbtc, usdc.address) // btc was 23600-24900$ that day
        const wbtcCollLinkLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(wbtc, linkAddr) // btc was 23600-24900$ and link was 7-7.50$ that day
        const wbtcCollWethLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(wbtc, weth.address) // btc was 23600-24900$ and weth was 1650-1700$ that day

        const aaveCollWbtcLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(aaveAddr, wbtc) // aave was 85-90$ and btc was 23600-24900$ that day
        const wethCollWbtcLoanPriceUSD = await chainlinkBasicWbtcUSDImplementation.getPrice(weth.address, wbtc) // weth was 1650-1700$ and btc was 23600-24900$ that day

        expect(Math.round(100 * Number(ethers.utils.formatUnits(wbtcCollUSDCLoanPriceUSD, 6))) / 100).to.be.within(
          23600,
          24900
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wbtcCollLinkLoanPriceUSD, 18))) / 100).to.be.within(
          3390,
          4000
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wbtcCollWethLoanPriceUSD, 18))) / 100).to.be.within(14, 15)
        expect(Math.round(10000 * Number(ethers.utils.formatUnits(aaveCollWbtcLoanPriceUSD, 8))) / 10000).to.be.within(
          0.003,
          0.004
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollWbtcLoanPriceUSD, 8))) / 100).to.be.within(
          0.06,
          0.08
        )

        if (showLogs) {
          // in terms of USDC
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wbtcCollUSDCLoanPriceUSD, 6))) / 100)

          // in terms of LINK
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wbtcCollLinkLoanPriceUSD, 18))) / 100)

          // in terms of WETH
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wbtcCollWethLoanPriceUSD, 18))) / 100)

          // in terms of WBTC
          console.log(Math.round(10000 * Number(ethers.utils.formatUnits(aaveCollWbtcLoanPriceUSD, 8))) / 10000)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollWbtcLoanPriceUSD, 8))) / 100)
        }
      })

      it('Should process olympus oracle prices correctly', async function () {
        const { addressRegistry, usdc, weth, gohm, team } = await setupTest()

        const aaveAddr = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
        const crvAddr = '0xD533a949740bb3306d119CC777fa900bA034cd52'
        const linkAddr = '0x514910771AF9Ca656af840dff83E8264EcF986CA'

        const OlympusOracleImplementation = await ethers.getContractFactory('OlympusOracle')
        const olympusOracleImplementation = await OlympusOracleImplementation.connect(team).deploy(
          [usdc.address, linkAddr, aaveAddr, crvAddr],
          [usdcEthChainlinkAddr, linkEthChainlinkAddr, aaveEthChainlinkAddr, crvEthChainlinkAddr]
        )
        await olympusOracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([olympusOracleImplementation.address], 2)

        const gOhmCollUSDCLoanPrice = await olympusOracleImplementation.getPrice(gohm.address, usdc.address)
        const gOhmCollLinkLoanPrice = await olympusOracleImplementation.getPrice(gohm.address, linkAddr)
        const gOhmCollAaveLoanPrice = await olympusOracleImplementation.getPrice(gohm.address, aaveAddr)
        const gOhmCollCrvLoanPrice = await olympusOracleImplementation.getPrice(gohm.address, crvAddr)
        const gOhmCollWethLoanPrice = await olympusOracleImplementation.getPrice(gohm.address, weth.address)

        expect(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollUSDCLoanPrice, 6))) / 100).to.be.within(2840, 2930)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollLinkLoanPrice, 18))) / 100).to.be.within(390, 400)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollAaveLoanPrice, 18))) / 100).to.be.within(30, 35)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollCrvLoanPrice, 18))) / 100).to.be.within(2550, 2575)
        expect(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollWethLoanPrice, 18))) / 100).to.be.within(1.7, 1.8)

        // toggle to show logs
        const showLogs = false
        if (showLogs) {
          // in terms of USDC
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollUSDCLoanPrice, 6))) / 100) // gohm was 2840-2930$ that day
          // in terms of LINK
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollLinkLoanPrice, 18))) / 100) // gohm was 2840-2930$ and link was 7-7.50$ that day
          // in terms of AAVE
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollAaveLoanPrice, 18))) / 100) // gohm was 2840-2930$ and aave was 85-90$ that day
          // in terms of CRV
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollCrvLoanPrice, 18))) / 100) // gohm was 2840-2930$ and crv was 1.10-1.20$ that day
          // in terms of WETH
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(gOhmCollWethLoanPrice, 18))) / 100) // gohm was 2840-2930$ and weth was 1650-1700$ that day
        }

        const usdcCollGOhmLoanPrice = await olympusOracleImplementation.getPrice(usdc.address, gohm.address)
        const linkCollGOhmLoanPrice = await olympusOracleImplementation.getPrice(linkAddr, gohm.address)
        const aaveCollGOhmLoanPrice = await olympusOracleImplementation.getPrice(aaveAddr, gohm.address)
        const crvCollGOhmLoanPrice = await olympusOracleImplementation.getPrice(crvAddr, gohm.address)
        const wethCollGOhmLoanPrice = await olympusOracleImplementation.getPrice(weth.address, gohm.address)

        expect(Math.round(100000 * Number(ethers.utils.formatUnits(usdcCollGOhmLoanPrice, 18))) / 100000).to.be.within(
          0.0003,
          0.0004
        )
        expect(Math.round(100000 * Number(ethers.utils.formatUnits(linkCollGOhmLoanPrice, 18))) / 100000).to.be.within(
          0.0025,
          0.003
        )
        expect(Math.round(1000 * Number(ethers.utils.formatUnits(aaveCollGOhmLoanPrice, 18))) / 1000).to.be.within(
          0.03,
          0.04
        )
        expect(Math.round(100000 * Number(ethers.utils.formatUnits(crvCollGOhmLoanPrice, 18))) / 100000).to.be.within(
          0.0003,
          0.0004
        )
        expect(Math.round(100 * Number(ethers.utils.formatUnits(wethCollGOhmLoanPrice, 18))) / 100).to.be.within(0.55, 0.6)

        if (showLogs) {
          // in terms of USDC
          console.log(Math.round(100000 * Number(ethers.utils.formatUnits(usdcCollGOhmLoanPrice, 18))) / 100000) // gohm was 2840-2930$ and usdc was 1$ that day
          // in terms of LINK
          console.log(Math.round(100000 * Number(ethers.utils.formatUnits(linkCollGOhmLoanPrice, 18))) / 100000) // gohm was 2840-2930$ and link was 7-7.50$ that day
          // in terms of AAVE
          console.log(Math.round(1000 * Number(ethers.utils.formatUnits(aaveCollGOhmLoanPrice, 18))) / 1000) // gohm was 2840-2930$ and aave was 85-90$ that day
          // in terms of CRV
          console.log(Math.round(100000 * Number(ethers.utils.formatUnits(crvCollGOhmLoanPrice, 18))) / 100000) // gohm was 2840-2930$ and crv was 1.10-1.20$ that day
          // in terms of WETH
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(wethCollGOhmLoanPrice, 18))) / 100) // gohm was 2840-2930$ and weth was 1650-1700$ that day
        }
      })

      it('Should process uni v2 oracle prices correctly', async function () {
        const { addressRegistry, usdc, weth, gohm, paxg, team } = await setupTest()

        const usdtAddr = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

        const tokenAddrToEthOracleAddrObj = {
          [usdtAddr]: usdtEthChainlinkAddr,
          [usdc.address]: usdcEthChainlinkAddr,
          [paxg.address]: paxgEthChainlinkAddr
        }

        // uni v2 Addrs
        const uniV2WethWiseAddr = '0x21b8065d10f73EE2e260e5B47D3344d3Ced7596E'
        const uniV2WethUsdtAddr = '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852'
        const uniV2PaxgUsdcAddr = '0x6D74443bb2d50785989a7212eBfd3a8dbABD1F60'
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')
        const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')

        // deploy uni v2 oracle contract with tolerance of 0% should revert
        await expect(
          UniV2OracleImplementation.connect(team).deploy(
            [usdc.address, paxg.address, usdtAddr],
            [usdcEthChainlinkAddr, paxgEthChainlinkAddr, usdtEthChainlinkAddr],
            [uniV2WethUsdcAddr, uniV2WethWiseAddr, uniV2WethUsdtAddr, uniV2PaxgUsdcAddr],
            0
          )
        ).to.be.revertedWithCustomError(UniV2OracleImplementation, 'InvalidOracleTolerance')

        // deploy uni v2 oracle contract with tolerance of 100% should revert
        await expect(
          UniV2OracleImplementation.connect(team).deploy(
            [usdc.address, paxg.address, usdtAddr],
            [usdcEthChainlinkAddr, paxgEthChainlinkAddr, usdtEthChainlinkAddr],
            [uniV2WethUsdcAddr, uniV2WethWiseAddr, uniV2WethUsdtAddr, uniV2PaxgUsdcAddr],
            10000
          )
        ).to.be.revertedWithCustomError(UniV2OracleImplementation, 'InvalidOracleTolerance')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address, paxg.address, usdtAddr],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr, usdtEthChainlinkAddr],
          [uniV2WethUsdcAddr, uniV2WethWiseAddr, uniV2WethUsdtAddr, uniV2PaxgUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
          [usdc.address, paxg.address, usdtAddr],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr, usdtEthChainlinkAddr],
          weth.address,
          BASE
        )
        await chainlinkBasicImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)
        await addressRegistry.connect(team).setWhitelistState([chainlinkBasicImplementation.address], 2)

        await expect(uniV2OracleImplementation.getPrice(uniV2WethWiseAddr, usdc.address)).to.be.revertedWithCustomError(
          uniV2OracleImplementation,
          'NoOracle'
        )
        await expect(uniV2OracleImplementation.getPrice(usdc.address, uniV2WethWiseAddr)).to.be.revertedWithCustomError(
          uniV2OracleImplementation,
          'NoOracle'
        )
        await expect(uniV2OracleImplementation.getPrice(gohm.address, uniV2WethUsdtAddr)).to.be.revertedWithCustomError(
          uniV2OracleImplementation,
          'NoOracle'
        )

        // get LP token prices in ETH
        const uniV2WethUsdcLpToken = await ethers.getContractAt('IUniV2', uniV2WethUsdcAddr)
        const uniV2WethUsdcPricePerWholeLpToken = await uniV2OracleImplementation.getLpTokenPrice(uniV2WethUsdcAddr)
        let lpTokenDecimals = await uniV2WethUsdcLpToken.decimals()
        let totalSupply = await uniV2WethUsdcLpToken.totalSupply()
        const uniV2WethUsdcTvlInEth = uniV2WethUsdcPricePerWholeLpToken
          .mul(totalSupply)
          .div(ethers.BigNumber.from(10).pow(lpTokenDecimals))
        expect(uniV2WethUsdcPricePerWholeLpToken).to.be.equal('103568572804675177895042')
        expect(uniV2WethUsdcTvlInEth).to.be.equal('54297603417419099250160')

        const uniV2WethUsdtLpToken = await ethers.getContractAt('IUniV2', uniV2WethUsdtAddr)
        const uniV2WethUsdtPricePerWholeLpToken = await uniV2OracleImplementation.getLpTokenPrice(uniV2WethUsdtAddr)
        lpTokenDecimals = await uniV2WethUsdtLpToken.decimals()
        totalSupply = await uniV2WethUsdtLpToken.totalSupply()
        const uniV2WethUsdtTvlInEth = uniV2WethUsdtPricePerWholeLpToken
          .mul(totalSupply)
          .div(ethers.BigNumber.from(10).pow(lpTokenDecimals))
        expect(uniV2WethUsdtPricePerWholeLpToken).to.be.equal('109666401959531641440388')
        expect(uniV2WethUsdtTvlInEth).to.be.equal('25440517313320386896587')

        const uniV2PaxgUsdcLpToken = await ethers.getContractAt('IUniV2', uniV2PaxgUsdcAddr)
        const uniV2PaxgUsdcPricePerWholeLpToken = await uniV2OracleImplementation.getLpTokenPrice(uniV2PaxgUsdcAddr)
        lpTokenDecimals = await uniV2PaxgUsdcLpToken.decimals()
        totalSupply = await uniV2PaxgUsdcLpToken.totalSupply()
        const uniV2PaxgUsdcTvlInEth = uniV2PaxgUsdcPricePerWholeLpToken
          .mul(totalSupply)
          .div(ethers.BigNumber.from(10).pow(lpTokenDecimals))
        expect(uniV2PaxgUsdcPricePerWholeLpToken).to.be.equal('28288853749660933246555984908')
        expect(uniV2PaxgUsdcTvlInEth).to.be.equal('2240408018702745547529')

        // get prices from uni v2 oracles with Lp token as collateral token
        const uniV2WethUsdtCollUsdcLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdtAddr, usdc.address)
        const uniV2PaxgUsdcCollUsdcLoanPrice = await uniV2OracleImplementation.getPrice(uniV2PaxgUsdcAddr, usdc.address)
        const uniV2WethUsdcCollUsdcLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)
        const uniV2WethUsdtCollUsdtLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdtAddr, usdtAddr)
        const uniV2WethUsdcCollUsdtLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdtAddr)
        const uniV2PaxgUsdcCollUsdtLoanPrice = await uniV2OracleImplementation.getPrice(uniV2PaxgUsdcAddr, usdtAddr)
        const uniV2WethUsdtCollPaxgLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdtAddr, paxg.address)
        const uniV2WethUsdcCollPaxgLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, paxg.address)
        const uniV2PaxgUsdcCollPaxgLoanPrice = await uniV2OracleImplementation.getPrice(uniV2PaxgUsdcAddr, paxg.address)
        const uniV2WethUsdtCollWethLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdtAddr, weth.address)
        const uniV2WethUsdcCollWethLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, weth.address)
        const uniV2PaxgUsdcCollWethLoanPrice = await uniV2OracleImplementation.getPrice(uniV2PaxgUsdcAddr, weth.address)

        // get prices from uni v2 oracles with Lp token as loan token
        const usdcColluniV2WethUsdtLoanPrice = await uniV2OracleImplementation.getPrice(usdc.address, uniV2WethUsdtAddr)
        const usdcColluniV2PaxgUsdcLoanPrice = await uniV2OracleImplementation.getPrice(usdc.address, uniV2PaxgUsdcAddr)
        const usdcColluniV2WethUsdcLoanPrice = await uniV2OracleImplementation.getPrice(usdc.address, uniV2WethUsdcAddr)
        const usdtColluniV2WethUsdtLoanPrice = await uniV2OracleImplementation.getPrice(usdtAddr, uniV2WethUsdtAddr)
        const usdtColluniV2WethUsdcLoanPrice = await uniV2OracleImplementation.getPrice(usdtAddr, uniV2WethUsdcAddr)
        const usdtColluniV2PaxgUsdcLoanPrice = await uniV2OracleImplementation.getPrice(usdtAddr, uniV2PaxgUsdcAddr)
        const paxgColluniV2WethUsdtLoanPrice = await uniV2OracleImplementation.getPrice(paxg.address, uniV2WethUsdtAddr)
        const paxgColluniV2WethUsdcLoanPrice = await uniV2OracleImplementation.getPrice(paxg.address, uniV2WethUsdcAddr)
        const paxgColluniV2PaxgUsdcLoanPrice = await uniV2OracleImplementation.getPrice(paxg.address, uniV2PaxgUsdcAddr)
        const wethColluniV2WethUsdtLoanPrice = await uniV2OracleImplementation.getPrice(weth.address, uniV2WethUsdtAddr)
        const wethColluniV2WethUsdcLoanPrice = await uniV2OracleImplementation.getPrice(weth.address, uniV2WethUsdcAddr)
        const wethColluniV2PaxgUsdcLoanPrice = await uniV2OracleImplementation.getPrice(weth.address, uniV2PaxgUsdcAddr)

        // get prices from uni v2 oracles with Lp token as collateral token and loan token
        const uniV2WethUsdtCollUniV2WethUsdcLoanPrice = await uniV2OracleImplementation.getPrice(
          uniV2WethUsdtAddr,
          uniV2WethUsdcAddr
        )
        const uniV2WethUsdtCollUniV2PaxgUsdcLoanPrice = await uniV2OracleImplementation.getPrice(
          uniV2WethUsdtAddr,
          uniV2PaxgUsdcAddr
        )
        const uniV2WethUsdcCollUniV2WethUsdtLoanPrice = await uniV2OracleImplementation.getPrice(
          uniV2WethUsdcAddr,
          uniV2WethUsdtAddr
        )
        const uniV2WethUsdcCollUniV2PaxgUsdcLoanPrice = await uniV2OracleImplementation.getPrice(
          uniV2WethUsdcAddr,
          uniV2PaxgUsdcAddr
        )
        const uniV2PaxgUsdcCollUniV2WethUsdtLoanPrice = await uniV2OracleImplementation.getPrice(
          uniV2PaxgUsdcAddr,
          uniV2WethUsdtAddr
        )
        const uniV2PaxgUsdcCollUniV2WethUsdcLoanPrice = await uniV2OracleImplementation.getPrice(
          uniV2PaxgUsdcAddr,
          uniV2WethUsdcAddr
        )

        // get exact prices for all tokens in eth
        const uniV2WethUsdtExactEthPrice = await getExactLpTokenPriceInEth(
          uniV2WethUsdtAddr,
          team,
          tokenAddrToEthOracleAddrObj,
          weth.address
        )
        const uniV2PaxgUsdcExactEthPrice = await getExactLpTokenPriceInEth(
          uniV2PaxgUsdcAddr,
          team,
          tokenAddrToEthOracleAddrObj,
          weth.address
        )
        const uniV2WethUsdcExactEthPrice = await getExactLpTokenPriceInEth(
          uniV2WethUsdcAddr,
          team,
          tokenAddrToEthOracleAddrObj,
          weth.address
        )
        const usdcExactEthPrice = await chainlinkBasicImplementation.getPrice(usdc.address, weth.address)
        const usdtExactEthPrice = await chainlinkBasicImplementation.getPrice(usdtAddr, weth.address)
        const paxgExactEthPrice = await chainlinkBasicImplementation.getPrice(paxg.address, weth.address)
        const wethExactEthPrice = BASE

        // get exact prices Lp token as coll and non-lp token as loan
        const uniV2WethUsdtCollUsdcLoanExactPrice = uniV2WethUsdtExactEthPrice.mul(10 ** 6).div(usdcExactEthPrice)
        const uniV2PaxgUsdcCollUsdcLoanExactPrice = uniV2PaxgUsdcExactEthPrice.mul(10 ** 6).div(usdcExactEthPrice)
        const uniV2WethUsdcCollUsdcLoanExactPrice = uniV2WethUsdcExactEthPrice.mul(10 ** 6).div(usdcExactEthPrice)
        const uniV2WethUsdtCollUsdtLoanExactPrice = uniV2WethUsdtExactEthPrice.mul(10 ** 6).div(usdtExactEthPrice)
        const uniV2WethUsdcCollUsdtLoanExactPrice = uniV2WethUsdcExactEthPrice.mul(10 ** 6).div(usdtExactEthPrice)
        const uniV2PaxgUsdcCollUsdtLoanExactPrice = uniV2PaxgUsdcExactEthPrice.mul(10 ** 6).div(usdtExactEthPrice)
        const uniV2WethUsdtCollPaxgLoanExactPrice = uniV2WethUsdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(paxgExactEthPrice)
        const uniV2WethUsdcCollPaxgLoanExactPrice = uniV2WethUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(paxgExactEthPrice)
        const uniV2PaxgUsdcCollPaxgLoanExactPrice = uniV2PaxgUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(paxgExactEthPrice)
        const uniV2WethUsdtCollWethLoanExactPrice = uniV2WethUsdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(wethExactEthPrice)
        const uniV2WethUsdcCollWethLoanExactPrice = uniV2WethUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(wethExactEthPrice)
        const uniV2PaxgUsdcCollWethLoanExactPrice = uniV2PaxgUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(wethExactEthPrice)
        // get exact prices non-lp token as coll and Lp token as loan
        const usdcColluniV2WethUsdtLoanExactPrice = usdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdtExactEthPrice)
        const usdcColluniV2PaxgUsdcLoanExactPrice = usdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2PaxgUsdcExactEthPrice)
        const usdcColluniV2WethUsdcLoanExactPrice = usdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdcExactEthPrice)
        const usdtColluniV2WethUsdtLoanExactPrice = usdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdtExactEthPrice)
        const usdtColluniV2WethUsdcLoanExactPrice = usdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdcExactEthPrice)
        const usdtColluniV2PaxgUsdcLoanExactPrice = usdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2PaxgUsdcExactEthPrice)
        const paxgColluniV2WethUsdtLoanExactPrice = paxgExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdtExactEthPrice)
        const paxgColluniV2WethUsdcLoanExactPrice = paxgExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdcExactEthPrice)
        const paxgColluniV2PaxgUsdcLoanExactPrice = paxgExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2PaxgUsdcExactEthPrice)
        const wethColluniV2WethUsdtLoanExactPrice = wethExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdtExactEthPrice)
        const wethColluniV2WethUsdcLoanExactPrice = wethExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdcExactEthPrice)
        const wethColluniV2PaxgUsdcLoanExactPrice = wethExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2PaxgUsdcExactEthPrice)
        // get exact prices Lp token as coll and Lp token as loan
        const uniV2WethUsdtCollUniV2WethUsdcLoanExactPrice = uniV2WethUsdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdcExactEthPrice)
        const uniV2WethUsdtCollUniV2PaxgUsdcLoanExactPrice = uniV2WethUsdtExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2PaxgUsdcExactEthPrice)
        const uniV2PaxgUsdcCollUniV2WethUsdtLoanExactPrice = uniV2PaxgUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdtExactEthPrice)
        const uniV2PaxgUsdcCollUniV2WethUsdcLoanExactPrice = uniV2PaxgUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdcExactEthPrice)
        const uniV2WethUsdcCollUniV2WethUsdtLoanExactPrice = uniV2WethUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2WethUsdtExactEthPrice)
        const uniV2WethUsdcCollUniV2PaxgUsdcLoanExactPrice = uniV2WethUsdcExactEthPrice
          .mul(BigNumber.from(10).pow(18))
          .div(uniV2PaxgUsdcExactEthPrice)

        // Lp tokens are collateral, non-Lp tokens are loan
        // console.log(uniV2WethUsdtCollUsdtLoanExactPrice.toString())
        // console.log(uniV2WethUsdtCollUsdtLoanPrice.toString())
        expect(getDeltaBNComparison(uniV2WethUsdtCollUsdcLoanExactPrice, uniV2WethUsdtCollUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2PaxgUsdcCollUsdcLoanExactPrice, uniV2PaxgUsdcCollUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdcCollUsdcLoanExactPrice, uniV2WethUsdcCollUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdtCollUsdtLoanExactPrice, uniV2WethUsdtCollUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdcCollUsdtLoanExactPrice, uniV2WethUsdcCollUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2PaxgUsdcCollUsdtLoanExactPrice, uniV2PaxgUsdcCollUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdtCollPaxgLoanExactPrice, uniV2WethUsdtCollPaxgLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdcCollPaxgLoanExactPrice, uniV2WethUsdcCollPaxgLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2PaxgUsdcCollPaxgLoanExactPrice, uniV2PaxgUsdcCollPaxgLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdtCollWethLoanExactPrice, uniV2WethUsdtCollWethLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2WethUsdcCollWethLoanExactPrice, uniV2WethUsdcCollWethLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(uniV2PaxgUsdcCollWethLoanExactPrice, uniV2PaxgUsdcCollWethLoanPrice, 5)).to.be.equal(
          true
        )
        // non-Lp tokens are collateral, Lp tokens are loan
        expect(getDeltaBNComparison(usdcColluniV2WethUsdtLoanExactPrice, usdcColluniV2WethUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(usdcColluniV2PaxgUsdcLoanExactPrice, usdcColluniV2PaxgUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(usdcColluniV2WethUsdcLoanExactPrice, usdcColluniV2WethUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(usdtColluniV2WethUsdtLoanExactPrice, usdtColluniV2WethUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(usdtColluniV2WethUsdcLoanExactPrice, usdtColluniV2WethUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(usdtColluniV2PaxgUsdcLoanExactPrice, usdtColluniV2PaxgUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(paxgColluniV2WethUsdtLoanExactPrice, paxgColluniV2WethUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(paxgColluniV2WethUsdcLoanExactPrice, paxgColluniV2WethUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(paxgColluniV2PaxgUsdcLoanExactPrice, paxgColluniV2PaxgUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(wethColluniV2WethUsdtLoanExactPrice, wethColluniV2WethUsdtLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(wethColluniV2WethUsdcLoanExactPrice, wethColluniV2WethUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        expect(getDeltaBNComparison(wethColluniV2PaxgUsdcLoanExactPrice, wethColluniV2PaxgUsdcLoanPrice, 5)).to.be.equal(
          true
        )
        // Lp tokens are collateral, Lp tokens are loan
        expect(
          getDeltaBNComparison(uniV2WethUsdtCollUniV2WethUsdcLoanExactPrice, uniV2WethUsdtCollUniV2WethUsdcLoanPrice, 5)
        ).to.be.equal(true)
        expect(
          getDeltaBNComparison(uniV2WethUsdtCollUniV2PaxgUsdcLoanExactPrice, uniV2WethUsdtCollUniV2PaxgUsdcLoanPrice, 5)
        ).to.be.equal(true)
        expect(
          getDeltaBNComparison(uniV2PaxgUsdcCollUniV2WethUsdtLoanExactPrice, uniV2PaxgUsdcCollUniV2WethUsdtLoanPrice, 5)
        ).to.be.equal(true)
        expect(
          getDeltaBNComparison(uniV2PaxgUsdcCollUniV2WethUsdcLoanExactPrice, uniV2PaxgUsdcCollUniV2WethUsdcLoanPrice, 5)
        ).to.be.equal(true)
        expect(
          getDeltaBNComparison(uniV2WethUsdcCollUniV2WethUsdtLoanExactPrice, uniV2WethUsdcCollUniV2WethUsdtLoanPrice, 5)
        ).to.be.equal(true)
        expect(
          getDeltaBNComparison(uniV2WethUsdcCollUniV2PaxgUsdcLoanExactPrice, uniV2WethUsdcCollUniV2PaxgUsdcLoanPrice, 5)
        ).to.be.equal(true)

        // toggle to show logs
        const showLogs = false
        if (showLogs) {
          console.log('Lp tokens as loan')
          // in terms of USDC
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUsdcLoanExactPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUsdcLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollUsdcLoanExactPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollUsdcLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollUsdcLoanExactPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollUsdcLoanPrice, 6))) / 100)
          // in terms of USDT
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUsdtLoanExactPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUsdtLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollUsdtLoanExactPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollUsdtLoanPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollUsdtLoanExactPrice, 6))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollUsdtLoanPrice, 6))) / 100)
          // in terms of PAXG
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollPaxgLoanExactPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollPaxgLoanPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollPaxgLoanExactPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollPaxgLoanPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollPaxgLoanExactPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollPaxgLoanPrice, 18))) / 100)
          // in terms of WETH
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollWethLoanExactPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollWethLoanPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollWethLoanExactPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollWethLoanPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollWethLoanExactPrice, 18))) / 100)
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollWethLoanPrice, 18))) / 100)
          console.log('Lp tokens as collateral')
          // in terms of Lp tokens with collateral as USDC
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdcColluniV2WethUsdtLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdcColluniV2WethUsdtLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdcColluniV2PaxgUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdcColluniV2PaxgUsdcLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdcColluniV2WethUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdcColluniV2WethUsdcLoanPrice, 18))) / 10 ** 14)
          // in terms of Lp tokens with collateral as USDT
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdtColluniV2WethUsdtLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdtColluniV2WethUsdtLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdtColluniV2WethUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdtColluniV2WethUsdcLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdtColluniV2PaxgUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(usdtColluniV2PaxgUsdcLoanPrice, 18))) / 10 ** 14)
          // in terms of Lp tokens with collateral as PAXG
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(paxgColluniV2WethUsdtLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(paxgColluniV2WethUsdtLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(paxgColluniV2WethUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(paxgColluniV2WethUsdcLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(paxgColluniV2PaxgUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(paxgColluniV2PaxgUsdcLoanPrice, 18))) / 10 ** 14)
          // in terms of Lp Tokens with collateral as WETH
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(wethColluniV2WethUsdtLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(wethColluniV2WethUsdtLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(wethColluniV2WethUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(wethColluniV2WethUsdcLoanPrice, 18))) / 10 ** 14)
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(wethColluniV2PaxgUsdcLoanExactPrice, 18))) / 10 ** 14
          )
          console.log(Math.round(10 ** 14 * Number(ethers.utils.formatUnits(wethColluniV2PaxgUsdcLoanPrice, 18))) / 10 ** 14)
          console.log('Lp tokens as loan and collateral')
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUniV2WethUsdcLoanExactPrice, 18))) /
              10 ** 14
          )
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUniV2WethUsdcLoanPrice, 18))) / 10 ** 14
          )
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollUniV2WethUsdtLoanExactPrice, 18))) /
              10 ** 14
          )
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(uniV2WethUsdcCollUniV2WethUsdtLoanPrice, 18))) / 10 ** 14
          )
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollUniV2WethUsdtLoanExactPrice, 18))) /
              10 ** 14
          )
          console.log(
            Math.round(10 ** 14 * Number(ethers.utils.formatUnits(uniV2PaxgUsdcCollUniV2WethUsdtLoanPrice, 18))) / 10 ** 14
          )
        }
      })

      it('Should process uni v2 oracle price with skew correctly lp token as coll (1/2 token0 reserve inflated)', async () => {
        const { addressRegistry, usdc, weth, team, lender } = await setupTest()

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await usdc.connect(lender).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // skew price by swapping for large weth amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, weth.address],
            lender.address,
            MAX_UINT256
          )

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(BigNumber.from(10).pow(20)))

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew correctly lp token as coll (2/2 token1 reserve inflated)', async () => {
        const { addressRegistry, usdc, weth, team, lender } = await setupTest()

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await weth.connect(team).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        await ethers.provider.send('hardhat_setBalance', [team.address, '0x4ee2d6d415b85acef8100000000000000'])
        await weth.connect(team).deposit({ value: ONE_WETH.mul(10 ** 14) })

        // lender usdc bal pre-skew
        const teamWethBalPreSkew = await weth.balanceOf(team.address)

        // skew price by swapping for large usdc amount
        await uniV2RouterInstance
          .connect(team)
          .swapExactTokensForTokens(ONE_WETH.mul(10 ** 14), 0, [weth.address, usdc.address], lender.address, MAX_UINT256)

        const teamWethBalPostSkew = await weth.balanceOf(team.address)

        expect(teamWethBalPreSkew.sub(teamWethBalPostSkew)).to.be.equal(ONE_WETH.mul(10 ** 14))

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew correctly lp token as loan (1/2 token0 reserve inflated)', async () => {
        const { addressRegistry, usdc, weth, team, lender } = await setupTest()

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await usdc.connect(lender).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // skew price by swapping for large weth amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, weth.address],
            lender.address,
            MAX_UINT256
          )

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(BigNumber.from(10).pow(20)))

        // oracle price post skew should revert
        await expect(uniV2OracleImplementation.getPrice(usdc.address, uniV2WethUsdcAddr)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew correctly lp token as loan (2/2 token1 reserve inflated)', async () => {
        const { addressRegistry, usdc, weth, team, lender } = await setupTest()

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await weth.connect(team).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        await ethers.provider.send('hardhat_setBalance', [team.address, '0x4ee2d6d415b85acef81000000000000'])
        await weth.connect(team).deposit({ value: ONE_WETH.mul(10 ** 14) })

        // lender usdc bal pre-skew
        const teamWethBalPreSkew = await weth.balanceOf(team.address)

        // skew price by swapping for large usdc amount
        await uniV2RouterInstance
          .connect(team)
          .swapExactTokensForTokens(ONE_WETH.mul(10 ** 14), 0, [weth.address, usdc.address], lender.address, MAX_UINT256)

        const teamWethBalPostSkew = await weth.balanceOf(team.address)

        expect(teamWethBalPreSkew.sub(teamWethBalPostSkew)).to.be.equal(ONE_WETH.mul(10 ** 14))

        // oracle price post skew should revert
        await expect(uniV2OracleImplementation.getPrice(usdc.address, uniV2WethUsdcAddr)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew correctly lp token as coll and loan (1/3 token0 reserve coll token inflated)', async () => {
        const { addressRegistry, usdc, weth, paxg, team, lender } = await setupTest()

        // uni v2 Addrs
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
        const uniV2PaxgUsdcAddr = '0x6D74443bb2d50785989a7212eBfd3a8dbABD1F60' // token0 is paxg, token1 is usdc

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address, paxg.address],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
          [uniV2WethUsdcAddr, uniV2PaxgUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await usdc.connect(lender).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // skew price by swapping for large weth amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, weth.address],
            lender.address,
            MAX_UINT256
          )

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(BigNumber.from(10).pow(20)))

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, uniV2PaxgUsdcAddr)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew correctly lp token as coll and loan (2/3 token1 reserve loan token inflated)', async () => {
        const { addressRegistry, usdc, paxg, team, lender } = await setupTest()

        // uni v2 Addrs
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
        const uniV2PaxgUsdcAddr = '0x6D74443bb2d50785989a7212eBfd3a8dbABD1F60' // token0 is paxg, token1 is usdc

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address, paxg.address],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
          [uniV2WethUsdcAddr, uniV2PaxgUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await usdc.connect(lender).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // skew price by swapping for large paxg amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, paxg.address],
            lender.address,
            MAX_UINT256
          )

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(BigNumber.from(10).pow(20)))

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, uniV2PaxgUsdcAddr)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew correctly lp token as coll and loan (3/3 both pools skewed token0 reserve coll token and token1 reserve loan token inflated)', async () => {
        const { addressRegistry, usdc, weth, paxg, team, lender } = await setupTest()

        // uni v2 Addrs
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'
        const uniV2PaxgUsdcAddr = '0x6D74443bb2d50785989a7212eBfd3a8dbABD1F60' // token0 is paxg, token1 is usdc

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address, paxg.address],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
          [uniV2WethUsdcAddr, uniV2PaxgUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await usdc.connect(lender).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // skew price by swapping for large weth amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, weth.address],
            lender.address,
            MAX_UINT256
          )

        // skew price by swapping for large paxg amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, paxg.address],
            lender.address,
            MAX_UINT256
          )

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(2).mul(BigNumber.from(10).pow(20)))

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, uniV2PaxgUsdcAddr)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should process uni v2 oracle price with skew and changing k value correctly', async () => {
        const { addressRegistry, usdc, weth, team, lender } = await setupTest()

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // prepare UniV2 Weth/Usdc balances
        const UNIV2_WETH_USDC_HOLDER = '0xeC08867a12546ccf53b32efB8C23bb26bE0C04f1'
        const uniV2WethUsdc = await ethers.getContractAt('IWETH', uniV2WethUsdcAddr)
        await ethers.provider.send('hardhat_setBalance', [UNIV2_WETH_USDC_HOLDER, '0x56BC75E2D63100000'])
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [UNIV2_WETH_USDC_HOLDER]
        })

        const uniV2WethUsdcHolder = await ethers.getSigner(UNIV2_WETH_USDC_HOLDER)

        const uniV2WethUsdcBal = await uniV2WethUsdc.balanceOf(UNIV2_WETH_USDC_HOLDER)

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        const uniV2RouterInstance = new ethers.Contract(UNI_V2_ROUTER_CONTRACT_ADDR, uniV2RouterAbi, team.provider)

        await usdc.connect(lender).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)
        await uniV2WethUsdc.connect(uniV2WethUsdcHolder).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // skew price by swapping for large weth amount
        await uniV2RouterInstance
          .connect(lender)
          .swapExactTokensForTokens(
            ONE_USDC.mul(BigNumber.from(10).pow(20)),
            0,
            [usdc.address, weth.address],
            lender.address,
            MAX_UINT256
          )

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(BigNumber.from(10).pow(20)))

        // oracle price post skew should revert
        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )

        await uniV2RouterInstance
          .connect(uniV2WethUsdcHolder)
          .removeLiquidity(usdc.address, weth.address, uniV2WethUsdcBal, 0, 0, UNIV2_WETH_USDC_HOLDER, MAX_UINT256)

        // oracle price post remove liquidity should revert
        await expect(uniV2OracleImplementation.getPrice(usdc.address, uniV2WethUsdcAddr)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should revert uni v2 oracle price with donate and one sided skew, lp token as coll (1/2 token0 reserve donated then sync)', async () => {
        const { addressRegistry, usdc, team, lender } = await setupTest()

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const uniV2WethUsdcInstance = new ethers.Contract(uniV2WethUsdcAddr, uniV2Abi, team.provider)

        // lender usdc bal pre-skew
        const lenderUsdcBalPreSkew = await usdc.balanceOf(lender.address)

        // donate usdc to uni v2 pool
        await usdc.connect(lender).transfer(uniV2WethUsdcAddr, ONE_USDC.mul(BigNumber.from(10).pow(20)))

        // sync uni v2 pool
        await uniV2WethUsdcInstance.connect(lender).sync()

        const lenderUsdcBalPostSkew = await usdc.balanceOf(lender.address)

        expect(lenderUsdcBalPreSkew.sub(lenderUsdcBalPostSkew)).to.be.equal(ONE_USDC.mul(BigNumber.from(10).pow(20)))

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })

      it('Should revert uni v2 oracle price with donate and one sided skew, lp token as coll (2/2 token1 reserve inflated)', async () => {
        const { addressRegistry, usdc, weth, team } = await setupTest()

        const tokenAddrToEthOracleAddrObj = {
          [usdc.address]: usdcEthChainlinkAddr
        }

        // uni v2 Addr
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address],
          [usdcEthChainlinkAddr],
          [uniV2WethUsdcAddr],
          500
        )
        await uniV2OracleImplementation.deployed()

        await addressRegistry.connect(team).setWhitelistState([uniV2OracleImplementation.address], 2)

        const UNI_V2_ROUTER_CONTRACT_ADDR = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

        await weth.connect(team).approve(UNI_V2_ROUTER_CONTRACT_ADDR, MAX_UINT256)

        const uniV2WethUsdcInstance = new ethers.Contract(uniV2WethUsdcAddr, uniV2Abi, team.provider)

        const uniV2WethUsdcExactEthPricePreSkew = await getExactLpTokenPriceInEth(
          uniV2WethUsdcAddr,
          team,
          tokenAddrToEthOracleAddrObj,
          weth.address
        )

        await ethers.provider.send('hardhat_setBalance', [team.address, '0x4ee2d6d415b85acef8100000000000000'])
        await weth.connect(team).deposit({ value: ONE_WETH.mul(10 ** 14) })

        // lender usdc bal pre-skew
        const teamWethBalPreSkew = await weth.balanceOf(team.address)

        // donate weth to uni v2 pool
        await weth.connect(team).transfer(uniV2WethUsdcAddr, ONE_WETH.mul(10 ** 10))

        // sync uni v2 pool
        await uniV2WethUsdcInstance.connect(team).sync()

        const teamWethBalPostSkew = await weth.balanceOf(team.address)

        expect(teamWethBalPreSkew.sub(teamWethBalPostSkew)).to.be.equal(ONE_WETH.mul(10 ** 10))

        const uniV2WethUsdcExactEthPricePostSkew = await getExactLpTokenPriceInEth(
          uniV2WethUsdcAddr,
          team,
          tokenAddrToEthOracleAddrObj,
          weth.address
        )

        const exactEthPriceDiff = uniV2WethUsdcExactEthPricePostSkew.sub(uniV2WethUsdcExactEthPricePreSkew)
        const exactEthPriceExpected = uniV2WethUsdcExactEthPricePreSkew.add(ONE_WETH.mul(10 ** 10))

        expect(exactEthPriceDiff).to.be.greaterThan(exactEthPriceExpected)

        await expect(uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)).to.be.revertedWithCustomError(
          UniV2OracleImplementation,
          'ReserveRatiosSkewedFromOraclePrice'
        )
      })
    })
  })
})
