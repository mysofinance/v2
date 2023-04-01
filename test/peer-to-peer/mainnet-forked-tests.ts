import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { INFURA_API_KEY, MAINNET_BLOCK_NUMBER } from '../../hardhat.config'
import {
  balancerV2VaultAbi,
  balancerV2PoolAbi,
  collTokenAbi,
  aavePoolAbi,
  crvRewardsDistributorAbi,
  chainlinkAggregatorAbi,
  gohmAbi
} from './helpers/abi'
import { createOnChainRequest, transferFeeHelper, calcLoanBalanceDelta, getTotalEthValue } from './helpers/misc'

// test config constants & vars
const BLOCK_NUMBER = MAINNET_BLOCK_NUMBER // todo: replace with env before resubmitting
let snapshotId : String // use snapshot id to reset state before each test

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

describe('Peer-to-Peer: Forked Mainnet Tests', function () {
  async function setupTest() {
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
    await lenderVaultFactory.connect(lender).createVault()
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
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // whitelist addrs
    //await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address, paxg.address, gohm.address, uniV2WethUsdc])
    await expect(addressRegistry.connect(lender).toggleCallbackAddr(balancerV2Looping.address, true)).to.be.reverted
    await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address, true)

    return {
      addressRegistry,
      borrowerGateway,
      quoteHandler,
      lenderVaultImplementation,
      lender,
      borrower,
      team,
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
  
  before(async function () {
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
            blockNumber: BLOCK_NUMBER,
          },
        },
      ],
    })
  })

  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot');
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId]);
  })

  let snapshotId: any
  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })
  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  describe('On-Chain Quote Testing', function () {
    it('Should validate correctly the wrong quote loanPerCollUnitOrLtv ', async function () {
      const {
        addressRegistry,
        quoteHandler,
        lender,
        borrower,
        team,
        usdc,
        weth,
        lenderVault,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

      // deploy chainlinkOracleContract
      const usdcEthChainlinkAddr = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
      const paxgEthChainlinkAddr = '0x9b97304ea12efed0fad976fbecaad46016bf269e'
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
        [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await chainlinkBasicImplementation.deployed()

      await expect(addressRegistry.connect(borrower).toggleOracle(chainlinkBasicImplementation.address, true)).to.be.reverted

      await addressRegistry.connect(team).toggleOracle(chainlinkBasicImplementation.address, true)

      // lender vault getter fails if no loans
      await expect(lenderVault.loan(0)).to.be.revertedWithCustomError(lenderVault, 'InvalidArrayIndex')

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: BASE,
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
    })

    it('Should validate correctly the wrong quote interestRatePctInBase', async function () {
      const { addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
    })

    it('Should validate correctly the wrong quote tenor', async function () {
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY.mul(366),
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
    })

    it('Should validate correctly the wrong quote validUntil', async function () {
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp - 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: 0,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted

      onChainQuote.generalQuoteInfo.maxLoan = ONE_USDC.mul(100).toNumber()

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
    })

    it('Should validate correctly the wrong upfrontFeePctInBase', async function () {
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
    })

    it('Should validate correctly the wrong quoteTuples length', async function () {
      const { addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

      let onChainQuote = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: [],
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate correctly the wrong quote collToken, loanToken', async function () {
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: weth.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
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

      await addressRegistry.connect(team).toggleTokens([usdc.address], true)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).toggleTokens([weth.address], true)
      await addressRegistry.connect(team).toggleTokens([usdc.address], false)

      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).toggleTokens([usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.reverted
    })

    it('Should validate correctly the wrong updateOnChainQuote', async function () {
      const { borrowerGateway, addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      let newOnChainQuote = {
        ...onChainQuote,
        generalQuoteInfo: {
          ...onChainQuote.generalQuoteInfo,
          collToken: compAddress,
          loanToken: compAddress,
          isSingleUse: true
        }
      }

      await addressRegistry.connect(team).toggleTokens([usdc.address], false)

      await expect(
        quoteHandler.connect(lender).updateOnChainQuote(borrower.address, onChainQuote, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler.connect(borrower).updateOnChainQuote(lenderVault.address, onChainQuote, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')
      await expect(
        quoteHandler.connect(lender).updateOnChainQuote(lenderVault.address, onChainQuote, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

      newOnChainQuote.generalQuoteInfo.loanToken = usdc.address

      await expect(
        quoteHandler.connect(lender).updateOnChainQuote(lenderVault.address, onChainQuote, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).toggleTokens([compAddress], true)

      await expect(
        quoteHandler.connect(lender).updateOnChainQuote(lenderVault.address, onChainQuote, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).toggleTokens([usdc.address], true)

      onChainQuote.generalQuoteInfo.loanToken = compAddress

      await expect(
        quoteHandler.connect(lender).updateOnChainQuote(lenderVault.address, onChainQuote, newOnChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnknownOnChainQuote')

      onChainQuote.generalQuoteInfo.loanToken = usdc.address

      const updateOnChainQuoteTransaction = await quoteHandler
        .connect(lender)
        .updateOnChainQuote(lenderVault.address, onChainQuote, newOnChainQuote)

      const updateOnChainQuoteReceipt = await updateOnChainQuoteTransaction.wait()

      const borrowQuoteDeletedEvent = updateOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'OnChainQuoteDeleted'
      })

      expect(borrowQuoteDeletedEvent).to.be.not.undefined

      const borrowQuoteAddedEvent = updateOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'OnChainQuoteAdded'
      })

      expect(borrowQuoteAddedEvent).to.be.not.undefined

      await quoteHandler.connect(lender).updateOnChainQuote(lenderVault.address, newOnChainQuote, onChainQuote)

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      expect(borrowEvent).to.not.be.undefined
    })

    it('Should handle unlocking collateral correctly', async function () {
      const { borrowerGateway, addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } =
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // borrow with on chain quote
      const collSendAmount = ONE_WETH
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
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
          expectedTransferFee: 0
        },
        lenderVault.address,
        callbackAddr,
        callbackData
      )

      const collBalPostRepayVault = await weth.balanceOf(lenderVault.address)
      const lockedVaultCollPostRepay = await lenderVault.lockedAmounts(weth.address)

      expect(collBalPreRepayVault.sub(collBalPostRepayVault)).to.equal(initCollAmount.div(2))
      expect(lockedVaultCollPreRepay.sub(lockedVaultCollPostRepay)).to.equal(collBalPreRepayVault.sub(collBalPostRepayVault))

      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // valid unlock
      await lenderVault.connect(lender).unlockCollateral(weth.address, [loanId], false)

      // revert if trying to unlock twice
      await expect(
        lenderVault.connect(lender).unlockCollateral(weth.address, [loanId], false)
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidCollUnlock')

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
      await expect(
        lenderVault.connect(lender).getTokenBalancesAndLockedAmounts([borrower.address])
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')

      const tokenBalanceAndLockedAmountsPostRepay = await lenderVault
        .connect(lender)
        .getTokenBalancesAndLockedAmounts([weth.address])
      expect(tokenBalanceAndLockedAmountsPostRepay._lockedAmounts[0]).to.equal(0)

      // since did not autowithdraw, no change in collateral balance
      expect(collBalPostUnlock).to.equal(collBalPostRepayVault)
      // all coll has been unlocked
      expect(lockedVaultCollPreRepay.sub(lockedVaultCollPostUnlock)).to.equal(initCollAmount)
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await expect(
        quoteHandler.connect(lender).deleteOnChainQuote(borrower.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler.connect(borrower).deleteOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')
      onChainQuote.generalQuoteInfo.loanToken = weth.address
      await expect(quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, onChainQuote)).to.reverted

      onChainQuote.generalQuoteInfo.loanToken = usdc.address

      await expect(quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteDeleted'
      )
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await expect(
        quoteHandler.connect(lender).deleteOnChainQuote(borrower.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler.connect(borrower).deleteOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')
      onChainQuote.generalQuoteInfo.loanToken = weth.address
      await expect(quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, onChainQuote)).to.reverted

      onChainQuote.generalQuoteInfo.loanToken = usdc.address

      await expect(quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteDeleted'
      )
    })

    it('Should process atomic balancer swap correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        team,
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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)
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
      const balancerV2Vault = await new ethers.Contract(
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        balancerV2VaultAbi,
        team
      ) // could be any signer, here used team
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

      // borrower approves and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedTransferFee = 0
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
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address, false)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.revertedWithCustomError(borrowerGateway, 'NonWhitelistedCallback')

      await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address, true)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(
            lenderVault.address,
            { ...borrowInstructions, expectedTransferFee: BigNumber.from(0).add(1) },
            onChainQuote,
            quoteTupleIdx
          )
      ).to.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

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

      await addressRegistry.connect(team).toggleCompartmentImpl(curveLPStakingCompartmentImplementation.address, true)

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

      expect(borrowerCRVLpBalPre).to.equal(locallyCollBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist tokens
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address], true)

      // whitelist gauge contract
      await expect(addressRegistry.connect(lender).toggleCompartmentImpl(crvGaugeAddress, true)).to.be.reverted
      await addressRegistry.connect(team).toggleCompartmentImpl(crvGaugeAddress, true)

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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const compartmentData = crvGaugeIndex
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']
      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']

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
      await crvCompInstance.connect(borrower).stake(compartmentData)
      await expect(crvCompInstance.connect(borrower).stake(compartmentData)).to.be.revertedWithCustomError(
        crvCompInstance,
        'AlreadyStaked'
      )
      await expect(
        crvCompInstance.connect(team).transferCollFromCompartment(1, 1, borrower.address, collTokenAddress, ZERO_ADDR)
      ).to.be.revertedWithCustomError(crvCompInstance, 'InvalidSender')

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const compartmentGaugeBalPost = await crvGaugeInstance.balanceOf(collTokenCompartmentAddr)

      expect(compartmentGaugeBalPost).to.equal(borrowerCRVLpBalPre)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

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
          borrowerGateway
            .connect(borrower)
            .repay(
              { targetLoanId: loanId, targetRepayAmount: repayAmount, expectedTransferFee: 0 },
              lenderVault.address,
              callbackAddr,
              callbackData
            )
        )
          .to.emit(borrowerGateway, 'Repay')
          .withArgs(lenderVault.address, loanId, repayAmount)

        // check balance post repay
        const borrowerCRVBalancePost = await crvInstance.balanceOf(borrower.address)
        const borrowerCRVLpRepayBalPost = await crvLPInstance.balanceOf(borrower.address)

        expect(borrowerCRVBalancePost.toString().substring(0, 3)).to.equal(totalGaugeRewardCRV.toString().substring(0, 3))

        if (rewardTokenAddress) {
          const borrowerRewardTokenBalancePost = await rewardTokenInstance.balanceOf(borrower.address)
          expect(borrowerRewardTokenBalancePost).to.be.greaterThan(borrowerRewardTokenBalancePre)
        }
        expect(borrowerCRVLpRepayBalPost).to.equal(locallyCollBalance)
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
              expectedTransferFee: 0
            },
            lenderVault.address,
            callbackAddr,
            callbackData
          )
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidRepayAmount')

        await expect(
          lenderVault.connect(lender).transferTo(collTokenAddress, lender.address, repayAmount)
        ).to.be.revertedWithCustomError(lenderVault, 'UnregisteredGateway')

        // partial repay
        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: loanId,
              targetRepayAmount: partialRepayAmount,
              expectedTransferFee: 0
            },
            lenderVault.address,
            callbackAddr,
            callbackData
          )
        )
          .to.emit(borrowerGateway, 'Repay')
          .withArgs(lenderVault.address, loanId, partialRepayAmount)

        // check balance post repay
        const borrowerCRVBalancePost = await crvInstance.balanceOf(borrower.address)
        const borrowerCRVLpRepayBalPost = await crvLPInstance.balanceOf(borrower.address)
        const collTokenCompartmentCRVBalancePost = await crvInstance.balanceOf(collTokenCompartmentAddr)
        const approxPartialCRVReward = totalGaugeRewardCRV.div(coeffRepay).toString().substring(0, 3)

        expect(borrowerCRVBalancePost.toString().substring(0, 3)).to.equal(approxPartialCRVReward)
        expect(borrowerCRVLpRepayBalPost).to.equal(locallyCollBalance.div(coeffRepay))
        expect(collTokenCompartmentCRVBalancePost.toString().substring(0, 3)).to.equal(approxPartialCRVReward)

        // unlock before expiry should revert
        await expect(
          lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId], false)
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidCollUnlock')

        await ethers.provider.send('evm_mine', [loanExpiry + 12])

        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: loanId,
              targetRepayAmount: partialRepayAmount,
              expectedTransferFee: 0
            },
            lenderVault.address,
            callbackAddr,
            callbackData
          )
        ).to.be.revertedWithCustomError(lenderVault, 'OutsideValidRepayWindow')

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
        await expect(
          lenderVault.connect(lender).unlockCollateral(lender.address, [loanId], false)
        ).to.be.revertedWithCustomError(lenderVault, 'InconsistentUnlockTokenAddresses')
        await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId], false)
        const compartmentRewardTokenBalancePostUnlock = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(collTokenCompartmentAddr)
          : BigNumber.from(0)

        // check vault balance
        const lenderVaultCollBalPost = await crvLPInstance.balanceOf(lenderVault.address)
        const lenderVaultCRVBalancePost = await crvInstance.balanceOf(lenderVault.address)
        const lenderVaultRewardTokenBalancePostUnlock = rewardTokenAddress
          ? await rewardTokenInstance.balanceOf(lenderVault.address)
          : BigNumber.from(0)

        expect(lenderVaultCollBalPost).to.equal(locallyCollBalance.div(coeffRepay))
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

    it('Should process aToken borrow and partial repayment correctly with rewards', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault, addressRegistry } =
        await setupTest()

      // create curve staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).toggleCompartmentImpl(aaveStakingCompartmentImplementation.address, true)

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
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(borrowerCollBalPre).to.be.above(locallyCollBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address], true)

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

      const badCompartmentOnChainQuote = await createOnChainRequest({
        lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: team.address,
        lenderVault,
        quoteHandler,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // borrow with on chain quote
      const collSendAmount = BigNumber.from(10).pow(18)
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, badCompartmentOnChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(lenderVault, 'NonWhitelistedCompartment')

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanId = borrowEvent?.args?.['loanId']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']

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
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackData
        )
      )
        .to.emit(borrowerGateway, 'Repay')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

      // check balance post repay
      const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)

      expect(borrowerCollRepayBalPost).to.be.above(borrowerCollBalPre.div(coeffRepay))

      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // unlock collateral
      const lenderCollBalPre = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPre).to.equal(BigNumber.from(0))

      await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId], true)

      const lenderCollBalPost = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPost).to.be.above(borrowerCollBalPre.div(coeffRepay))
    })

    it('Should delegate voting correctly with borrow and partial repayment', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, lenderVault, addressRegistry } = await setupTest()

      // create uni staking implementation
      const VotingCompartmentImplementation = await ethers.getContractFactory('VoteCompartment')
      await VotingCompartmentImplementation.connect(team)
      const votingCompartmentImplementation = await VotingCompartmentImplementation.deploy()
      await votingCompartmentImplementation.deployed()

      await addressRegistry.connect(team).toggleCompartmentImpl(votingCompartmentImplementation.address, true)

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
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address], true)

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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanId = borrowEvent?.args?.['loanId']
      const loanExpiry = borrowEvent?.args?.loan?.['expiry']

      const coeffRepay = 2
      const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

      const uniCompInstance = await votingCompartmentImplementation.attach(collTokenCompartmentAddr)

      const borrowerVotesPreDelegation = await collInstance.getCurrentVotes(borrower.address)

      await expect(uniCompInstance.connect(team).delegate(borrower.address)).to.be.reverted
      await uniCompInstance.connect(borrower).delegate(borrower.address)

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const borroweUNIBalPost = await collInstance.balanceOf(borrower.address)
      const vaultUNIBalPost = await collInstance.balanceOf(collTokenCompartmentAddr)

      const borrowerVotesPost = await collInstance.getCurrentVotes(borrower.address)

      expect(borrowerVotesPost).to.equal(borrowerUNIBalPre)
      expect(borrowerVotesPreDelegation).to.equal(0)

      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      expect(borrowerUNIBalPre.sub(borroweUNIBalPost)).to.equal(vaultUNIBalPost.sub(vaultUNIBalPre))

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // partial repay
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackData
        )
      )
        .to.emit(borrowerGateway, 'Repay')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

      // check balance post repay
      const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)
      expect(borrowerCollRepayBalPost).to.be.equal(borrowerUNIBalPre.div(coeffRepay))

      await ethers.provider.send('evm_mine', [loanExpiry + 12])

      // unlock collateral
      const lenderCollBalPre = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPre).to.equal(BigNumber.from(0))

      await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId], true)

      const lenderCollBalPost = await collInstance.balanceOf(lender.address)

      expect(lenderCollBalPost).to.equal(borrowerUNIBalPre.div(coeffRepay))

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

      await addressRegistry.connect(team).toggleCompartmentImpl(votingCompartmentImplementation.address, true)

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
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, weth.address], true)

      expect(await addressRegistry.connect(team).isWhitelistedToken(collTokenAddress)).to.be.true
      expect(await addressRegistry.connect(team).isWhitelistedToken(weth.address)).to.be.true

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
      const expectedTransferFee = 0
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
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.loan?.['collTokenCompartmentAddr']
      const repayAmount = borrowEvent?.args?.loan?.['initRepayAmount']
      const loanId = borrowEvent?.args?.['loanId']

      const coeffRepay = 2
      const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

      const uniCompInstance = await votingCompartmentImplementation.attach(collTokenCompartmentAddr)

      await expect(uniCompInstance.connect(team).initialize(borrower.address, 1)).to.be.reverted

      await expect(
        uniCompInstance.connect(team).transferCollFromCompartment(1, 1, borrower.address, collTokenAddress, ZERO_ADDR)
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
      expect(compartmentCollBalPost).to.equal(collSendAmount)
      expect(borrowerVotesPreDelegation).to.equal(0)

      // borrower approves borrower gateway
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const minSwapReceiveRepay = partialRepayAmount.mul(BASE.sub(slippageTolerance)).div(BASE).div(1000)

      const callbackDataRepay = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [poolId, minSwapReceiveRepay, deadline]
      )

      await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address, false)

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackDataRepay
        )
      ).to.revertedWithCustomError(borrowerGateway, 'NonWhitelistedCallback')

      await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address, true)

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: BigNumber.from(0).add(1)
          },
          lenderVault.address,
          callbackAddr,
          callbackDataRepay
        )
      ).to.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')

      // partial repay
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: partialRepayAmount,
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackDataRepay
        )
      )
        .to.emit(borrowerGateway, 'Repay')
        .withArgs(lenderVault.address, loanId, partialRepayAmount)

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
      const myMaliciousERC20 = await MyMaliciousERC20.deploy('MalciousToken', 'MyMal', 18, ZERO_ADDR, lenderVault.address)
      await myMaliciousERC20.deployed()
      await lenderVault.connect(lender).withdraw(myMaliciousERC20.address, ONE_WETH)
      const wethBalPostAttack = await weth.balanceOf(lenderVault.address)
      expect(wethBalPostAttack).to.equal(wethBalPreAttack)
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
          borrower: borrower.address,
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([paxg.address, usdc.address], true)
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
      const expectedTransferFee = ONE_PAXG.mul(2).div(9998)
      const quoteTupleIdx = 0
      const collSendAmount = ONE_PAXG.mul(10000).div(9998)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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
      await borrowerGateway.connect(team).setNewProtocolFee(protocolFee) // 1% or 100 bp protocolFee

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
          borrower: borrower.address,
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDR,
          minLoan: 0,
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([paxg.address, usdc.address], true)
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
        expectedTransferFee: totalExpectedFees,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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
          borrower: borrower.address,
          collToken: usdc.address,
          loanToken: paxg.address,
          oracleAddr: ZERO_ADDR,
          minLoan: ONE_PAXG.div(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([paxg.address, usdc.address], true)
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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }
      const borrowTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      const borrowTransactionReceipt = await borrowTransaction.wait()

      const borrowEvent = borrowTransactionReceipt.events?.find(x => {
        return x.event === 'Borrow'
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
        expectedTransferFee: transferFeeHelper(ONE_PAXG.mul(10).mul(110).div(100), 2)
      }

      await expect(borrowerGateway.connect(borrower).repay(repayBody, team.address, callbackAddr, callbackData)).to.be
        .reverted

      await expect(
        borrowerGateway
          .connect(borrower)
          .repay({ ...repayBody, expectedTransferFee: BASE }, lenderVault.address, callbackAddr, callbackData)
      ).to.be.reverted

      await expect(
        borrowerGateway.connect(team).repay(repayBody, lenderVault.address, callbackAddr, callbackData)
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidBorrower')

      await expect(borrowerGateway.connect(borrower).repay(repayBody, lenderVault.address, callbackAddr, callbackData))
        .to.emit(borrowerGateway, 'Repay')
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
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        paxg,
        weth,
        wbtc,
        ldo,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr,
        team,
        lenderVault
      } = await setupTest()

      // deploy chainlinkOracleContract
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      /****deploy errors on base oracles****/
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          [],
          [usdcEthChainlinkAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidArrayLength')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcEthChainlinkAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidArrayLength')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [ZERO_ADDR, paxgEthChainlinkAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidAddress')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          [ZERO_ADDR, '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidAddress')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcUsdChainlinkAddr, paxgEthChainlinkAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidOracleDecimals')
      await expect(
        ChainlinkBasicImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
          [usdcUsdChainlinkAddr, paxgEthChainlinkAddr],
          ZERO_ADDR,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(ChainlinkBasicImplementation, 'InvalidOracleDecimals')

      /****correct deploy****/
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x45804880De22913dAFE09f4980848ECE6EcbAf78'],
        [usdcEthChainlinkAddr, paxgEthChainlinkAddr],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await chainlinkBasicImplementation.deployed()

      await expect(addressRegistry.connect(borrower).toggleOracle(chainlinkBasicImplementation.address, true)).to.be.reverted

      await addressRegistry.connect(team).toggleOracle(chainlinkBasicImplementation.address, true)

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
          borrower: borrower.address,
          collToken: paxg.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      let badOnChainQuoteAddrNotInOracle = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: ldo.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([paxg.address, usdc.address, ldo.address], true)
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
      const expectedTransferFee = ONE_PAXG.mul(2).div(9998)
      const quoteTupleIdx = 0
      const collSendAmount = ONE_PAXG.mul(10000).div(9998)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const badBorrowInstructionsTransferFee = {
        collSendAmount,
        expectedTransferFee: collSendAmount.mul(2),
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const badBorrowInstructionsBelowMinLoan = {
        collSendAmount: collSendAmount.div(1000),
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const badBorrowInstructionsTooSmallLoanAmount = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: MAX_UINT128,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, badOnChainQuoteAddrNotInOracle, quoteTupleIdx)
      ).to.be.revertedWithCustomError(chainlinkBasicImplementation, 'InvalidOraclePair')

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
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        weth,
        team,
        lenderVault,
        addressRegistry,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

      // deploy chainlinkOracleContract
      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await chainlinkBasicImplementation.deployed()

      await addressRegistry.connect(team).toggleOracle(chainlinkBasicImplementation.address, true)

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
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_WETH
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }
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
        lenderVault,
        addressRegistry,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

      // deploy chainlinkOracleContract

      const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')
      const chainlinkBasicImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await chainlinkBasicImplementation.deployed()

      await addressRegistry.connect(team).toggleOracle(chainlinkBasicImplementation.address, true)

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
          borrower: borrower.address,
          collToken: usdc.address,
          loanToken: weth.address,
          oracleAddr: chainlinkBasicImplementation.address,
          minLoan: ONE_WETH.div(100),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT128)
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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

    it('Should process onChain quote with olympus gohm oracle (non-weth, gohm is coll)', async function () {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        gohm,
        weth,
        ldo,
        team,
        lenderVault,
        addressRegistry,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

      // deploy chainlinkOracleContract
      const ohmEthChainlinkAddr = '0x9a72298ae3886221820B1c878d12D872087D3a23'
      const OlympusOracleImplementation = await ethers.getContractFactory('OlympusOracle')
      const olympusOracleImplementation = await OlympusOracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await olympusOracleImplementation.deployed()

      await addressRegistry.connect(team).toggleOracle(olympusOracleImplementation.address, true)

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
          borrower: borrower.address,
          collToken: gohm.address,
          loanToken: usdc.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithNeitherAddressGohm = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithNoOracle = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: gohm.address,
          loanToken: ldo.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).toggleTokens([gohm.address, usdc.address, ldo.address, weth.address], true)
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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_GOHM
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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
      ).to.be.revertedWithCustomError(olympusOracleImplementation, 'InvalidOraclePair')

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerGohmBalPost = await gohm.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultGohmBalPost = await gohm.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()
      const collTokenRoundDataPreIndex = await ohmOracleInstance.latestRoundData()
      const loanTokenPriceRaw = loanTokenRoundData.answer
      const collTokenPriceRawPreIndex = collTokenRoundDataPreIndex.answer
      const index = await gohmInstance.index()

      const collTokenPriceInLoanToken = collTokenPriceRawPreIndex
        .mul(ONE_USDC)
        .mul(index)
        .div(loanTokenPriceRaw)
        .div(10 ** 9)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      expect(borrowerGohmBalPre.sub(borrowerGohmBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(maxLoanPerColl)
      expect(Math.abs(Number(vaultGohmBalPost.sub(vaultGohmBalPre).sub(collSendAmount).toString()))).to.equal(0)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(maxLoanPerColl)).to.equal(0)
    })

    it('Should process onChain quote with olympus gohm oracle (non-weth, gohm is loan)', async function () {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        gohm,
        weth,
        team,
        lenderVault,
        addressRegistry,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

      // deploy chainlinkOracleContract
      const ohmEthChainlinkAddr = '0x9a72298ae3886221820B1c878d12D872087D3a23'
      const OlympusOracleImplementation = await ethers.getContractFactory('OlympusOracle')
      const olympusOracleImplementation = await OlympusOracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await olympusOracleImplementation.deployed()

      await addressRegistry.connect(team).toggleOracle(olympusOracleImplementation.address, true)

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
          borrower: borrower.address,
          collToken: usdc.address,
          loanToken: gohm.address,
          oracleAddr: olympusOracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await addressRegistry.connect(team).toggleTokens([gohm.address, usdc.address, weth.address], true)
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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        weth,
        gohm,
        team,
        lenderVault,
        addressRegistry,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

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
      /****deploy error uni oracle****/
      await expect(
        UniV2OracleImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
          [usdcEthChainlinkAddr],
          [ZERO_ADDR],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(UniV2OracleImplementation, 'InvalidAddress')
      await expect(
        UniV2OracleImplementation.connect(team).deploy(
          ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
          [usdcEthChainlinkAddr],
          [],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
      ).to.be.revertedWithCustomError(UniV2OracleImplementation, 'InvalidArrayLength')
      /****deploy correctly****/
      const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        [uniV2WethUsdc.address],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await uniV2OracleImplementation.deployed()

      await addressRegistry.connect(team).toggleOracle(uniV2OracleImplementation.address, true)

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
          borrower: borrower.address,
          collToken: uniV2WethUsdc.address,
          loanToken: usdc.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithNoLpTokens = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      let onChainQuoteWithLoanTokenNoOracle = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: uniV2WethUsdc.address,
          loanToken: gohm.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry
        .connect(team)
        .toggleTokens([uniV2WethUsdc.address, usdc.address, weth.address, gohm.address], true)
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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_WETH.div(1000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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
      ).to.be.revertedWithCustomError(uniV2OracleImplementation, 'InvalidOraclePair')

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerUniV2WethUsdcBalPost = await uniV2WethUsdc.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUniV2WethUsdcBalPost = await uniV2WethUsdc.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()
      const totalEthValueOfLpPool = await getTotalEthValue(
        uniV2WethUsdc.address,
        borrower,
        usdcEthChainlinkAddr,
        weth.address,
        weth.address,
        true
      )
      const totalSupply = await uniV2WethUsdc.totalSupply()
      const loanTokenPriceRaw = loanTokenRoundData.answer
      const collTokenPriceRaw = totalEthValueOfLpPool.mul(BigNumber.from(10).pow(18)).div(totalSupply)

      const collTokenPriceInLoanToken = collTokenPriceRaw.mul(ONE_USDC).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      expect(borrowerUniV2WethUsdcBalPre.sub(borrowerUniV2WethUsdcBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(maxLoanPerColl.div(1000))
      expect(
        Math.abs(Number(vaultUniV2WethUsdcBalPost.sub(vaultUniV2WethUsdcBalPre).sub(collSendAmount).toString()))
      ).to.equal(0)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(maxLoanPerColl.div(1000))).to.equal(0)
    })

    it('Should process onChain quote with uni v2 oracle (usdc-weth, lp is loan)', async function () {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        usdc,
        weth,
        team,
        lenderVault,
        addressRegistry,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      } = await setupTest()

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
      /****deploy correctly****/
      const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
        ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        [usdcEthChainlinkAddr],
        [uniV2WethUsdc.address],
        weth.address,
        wbtc,
        btcToUSDChainlinkAddr,
        wBTCToBTCChainlinkAddr
      )
      await uniV2OracleImplementation.deployed()

      await addressRegistry.connect(team).toggleOracle(uniV2OracleImplementation.address, true)

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
          borrower: borrower.address,
          collToken: usdc.address,
          loanToken: uniV2WethUsdc.address,
          oracleAddr: uniV2OracleImplementation.address,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDR,
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await addressRegistry.connect(team).toggleTokens([uniV2WethUsdc.address, usdc.address], true)
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
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_USDC.mul(10000)
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
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
      const totalEthValueOfLpPool = await getTotalEthValue(
        uniV2WethUsdc.address,
        borrower,
        usdcEthChainlinkAddr,
        weth.address,
        weth.address,
        false
      )
      const totalSupply = await uniV2WethUsdc.totalSupply()
      const collTokenPriceRaw = collTokenRoundData.answer
      const loanTokenPriceRaw = totalEthValueOfLpPool.mul(BigNumber.from(10).pow(18)).div(totalSupply)

      const collTokenPriceInLoanToken = collTokenPriceRaw.mul(ONE_WETH).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      expect(borrowerUniV2WethUsdcBalPost.sub(borrowerUniV2WethUsdcBalPre)).to.equal(maxLoanPerColl.mul(10000))
      expect(borrowerUsdcBalPre.sub(borrowerUsdcBalPost)).to.equal(collSendAmount)
      expect(
        Math.abs(Number(vaultUniV2WethUsdcBalPre.sub(vaultUniV2WethUsdcBalPost).sub(maxLoanPerColl.mul(10000)).toString()))
      ).to.equal(0)
      expect(vaultUsdcBalPost.sub(vaultUsdcBalPre).sub(collSendAmount)).to.equal(0)
    })

    describe('Should handle getPrice correctly', async function () {
      it('Should process chainlink oracle prices correctly', async function () {
        const { addressRegistry, usdc, paxg, weth, wbtc, ldo, btcToUSDChainlinkAddr, wBTCToBTCChainlinkAddr, team } =
          await setupTest()

        // deploy chainlinkOracleContract
        const ChainlinkBasicImplementation = await ethers.getContractFactory('ChainlinkBasic')

        const aaveAddr = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
        const crvAddr = '0xD533a949740bb3306d119CC777fa900bA034cd52'
        const linkAddr = '0x514910771AF9Ca656af840dff83E8264EcF986CA'
        /****correct deploy****/
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
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
        await chainlinkBasicImplementation.deployed()

        await addressRegistry.connect(team).toggleOracle(chainlinkBasicImplementation.address, true)

        await expect(chainlinkBasicImplementation.getPrice(wbtc, usdc.address)).to.be.revertedWithCustomError(
          chainlinkBasicImplementation,
          'InvalidBTCOracle'
        )

        await expect(chainlinkBasicImplementation.getPrice(usdc.address, wbtc)).to.be.revertedWithCustomError(
          chainlinkBasicImplementation,
          'InvalidBTCOracle'
        )

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

        const chainlinkBasicUSDImplementation = await ChainlinkBasicImplementation.connect(team).deploy(
          [usdc.address, aaveAddr, crvAddr, linkAddr, weth.address],
          [usdcUsdChainlinkAddr, aaveUsdChainlinkAddr, crvUsdChainlinkAddr, linkUsdChainlinkAddr, ethUsdChainlinkAddr],
          ZERO_ADDR,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
        await chainlinkBasicUSDImplementation.deployed()

        await addressRegistry.connect(team).toggleOracle(chainlinkBasicUSDImplementation.address, true)

        // prices on 2-16-2023
        const aaveCollUSDCLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(aaveAddr, usdc.address) // aave was 85-90$ that day
        const crvCollUSDCLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(crvAddr, usdc.address) // crv was 1.10-1.20$ that day
        const linkCollUSDCLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(linkAddr, usdc.address) // link was 7-7.50$ that day
        const wethCollUSDCLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(weth.address, usdc.address) // weth was 1650-1700$ that day

        const aaveCollLinkLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(aaveAddr, linkAddr) // aave was 85-90$ and link was 7-7.50$ that day
        const wethCollLinkLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(weth.address, linkAddr) // weth was 1650-1700$ and link was 7-7.50$ that day
        const crvCollLinkLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(crvAddr, linkAddr) // crv was 1.10-1.20$ and link was 7-7.50$ that day
        const usdcCollLinkLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(usdc.address, linkAddr) // usdc was 1$ and link was 7-7.50$ that day

        const aaveCollWethLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(aaveAddr, weth.address) // aave was 85-90$ and weth was 1650-1700$ that day
        const crvCollWethLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(crvAddr, weth.address) // crv was 1.10-1.20$ and weth was 1650-1700$ that day
        const usdcCollWethLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(usdc.address, weth.address) // usdc was 1$ and weth was 1650-1700$ that day

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
        const wbtcCollUSDCLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(wbtc, usdc.address) // btc was 23600-24900$ that day
        const wbtcCollLinkLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(wbtc, linkAddr) // btc was 23600-24900$ and link was 7-7.50$ that day
        const wbtcCollWethLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(wbtc, weth.address) // btc was 23600-24900$ and weth was 1650-1700$ that day

        const aaveCollWbtcLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(aaveAddr, wbtc) // aave was 85-90$ and btc was 23600-24900$ that day
        const wethCollWbtcLoanPriceUSD = await chainlinkBasicUSDImplementation.getPrice(weth.address, wbtc) // weth was 1650-1700$ and btc was 23600-24900$ that day

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
        const { addressRegistry, usdc, weth, wbtc, gohm, btcToUSDChainlinkAddr, wBTCToBTCChainlinkAddr, team } =
          await setupTest()

        const aaveAddr = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
        const crvAddr = '0xD533a949740bb3306d119CC777fa900bA034cd52'
        const linkAddr = '0x514910771AF9Ca656af840dff83E8264EcF986CA'

        const OlympusOracleImplementation = await ethers.getContractFactory('OlympusOracle')
        const olympusOracleImplementation = await OlympusOracleImplementation.connect(team).deploy(
          [usdc.address, linkAddr, aaveAddr, crvAddr],
          [usdcEthChainlinkAddr, linkEthChainlinkAddr, aaveEthChainlinkAddr, crvEthChainlinkAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
        await olympusOracleImplementation.deployed()

        await addressRegistry.connect(team).toggleOracle(olympusOracleImplementation.address, true)

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
        const { addressRegistry, usdc, weth, wbtc, gohm, paxg, btcToUSDChainlinkAddr, wBTCToBTCChainlinkAddr, team } =
          await setupTest()

        const linkAddr = '0x514910771AF9Ca656af840dff83E8264EcF986CA'
        const usdtAddr = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

        // uni v2 Addrs
        const uniV2WethWiseAddr = '0x21b8065d10f73EE2e260e5B47D3344d3Ced7596E'
        const uniV2WethUsdtAddr = '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852'
        const uniV2PaxgUsdcAddr = '0x6D74443bb2d50785989a7212eBfd3a8dbABD1F60'
        const uniV2WethUsdcAddr = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc'

        // uni v2 contracts
        const uniV2WethWiseInstance = await ethers.getContractAt('IUniV2', uniV2WethWiseAddr)
        const uniV2WethUsdtInstance = await ethers.getContractAt('IUniV2', uniV2WethUsdtAddr)
        const uniV2PaxgUsdcInstance = await ethers.getContractAt('IUniV2', uniV2PaxgUsdcAddr)
        const uniV2WethUsdcInstance = await ethers.getContractAt('IUniV2', uniV2WethUsdcAddr)

        // uni v2 reserves, token slots and supply
        const uniV2WethUsdtReservesInfo = await uniV2WethUsdtInstance.getReserves()
        const uniV2WethUsdtToken0 = await uniV2WethUsdtInstance.token0()
        const uniV2WethUsdtToken1 = await uniV2WethUsdtInstance.token1()
        const uniV2WethUsdtSupply = await uniV2WethUsdtInstance.totalSupply()
        const uniV2PaxgUsdcReservesInfo = await uniV2PaxgUsdcInstance.getReserves()
        const uniV2PaxgUsdcToken0 = await uniV2PaxgUsdcInstance.token0()
        const uniV2PaxgUsdcToken1 = await uniV2PaxgUsdcInstance.token1()
        const uniV2PaxgUsdcSupply = await uniV2PaxgUsdcInstance.totalSupply()
        const uniV2WethUsdcReservesInfo = await uniV2WethUsdcInstance.getReserves()
        const uniV2WethUsdcToken0 = await uniV2WethUsdcInstance.token0()
        const uniV2WethUsdcToken1 = await uniV2WethUsdcInstance.token1()
        const uniV2WethUsdcSupply = await uniV2WethUsdcInstance.totalSupply()

        // deploy oracle contract for uni v2 oracles
        const UniV2OracleImplementation = await ethers.getContractFactory('UniV2Chainlink')

        const uniV2OracleImplementation = await UniV2OracleImplementation.connect(team).deploy(
          [usdc.address, paxg.address, usdtAddr],
          [usdcEthChainlinkAddr, paxgEthChainlinkAddr, usdtEthChainlinkAddr],
          [uniV2WethUsdcAddr, uniV2WethWiseAddr, uniV2WethUsdtAddr, uniV2PaxgUsdcAddr],
          weth.address,
          wbtc,
          btcToUSDChainlinkAddr,
          wBTCToBTCChainlinkAddr
        )
        await uniV2OracleImplementation.deployed()
  
        await addressRegistry.connect(team).toggleOracle(uniV2OracleImplementation.address, true)

        const uniV2WethWiseCollUSDCLoanPrice = await expect(uniV2OracleImplementation.getPrice(uniV2WethWiseAddr, usdc.address)).to.be.revertedWithCustomError(uniV2OracleImplementation, 'InvalidOraclePair')
        const usdcColluniV2WethWiseLoanPrice = await expect(uniV2OracleImplementation.getPrice(usdc.address, uniV2WethWiseAddr)).to.be.revertedWithCustomError(uniV2OracleImplementation, 'InvalidOraclePair')
        const gohmColluniV2WethUsdtLoanPrice = await expect(uniV2OracleImplementation.getPrice(gohm.address, uniV2WethUsdtAddr)).to.be.revertedWithCustomError(uniV2OracleImplementation, 'InvalidOraclePair')
        
        const uniV2WethUsdtCollUSDCLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdtAddr, usdc.address)
        const uniV2PaxgUsdcCollUSDCLoanPrice = await uniV2OracleImplementation.getPrice(uniV2PaxgUsdcAddr, usdc.address)
        const uniV2WethUsdcCollUSDCLoanPrice = await uniV2OracleImplementation.getPrice(uniV2WethUsdcAddr, usdc.address)


        // toggle to show logs
        const showLogs = true
        if (showLogs) {
          // in terms of USDC
          console.log(Math.round(100 * Number(ethers.utils.formatUnits(uniV2WethUsdtCollUSDCLoanPrice, 6))) / 100) // gohm was 2840-2930$ that day
        }
      })
    })
  })
})
