import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG, getRecentMainnetForkingConfig } from '../../hardhat.config'
import { collTokenAbi, chainlinkAggregatorAbi, payloadScheme } from './helpers/abi'
import { fromReadableAmount, toReadableAmount, getOptimCollSendAndFlashBorrowAmount } from './helpers/uniV3'
import { SupportedChainId, Token } from '@uniswap/sdk-core'
import { calcLoanBalanceDelta, getExactLpTokenPriceInEth, getFairReservesPriceAndEthValue } from './helpers/misc'

// test config constants & vars
let snapshotId: String // use snapshot id to reset state before each test

// constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const ONE_WBTC = ethers.BigNumber.from(10).pow(8)
const ONE_DSETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const YEAR_IN_SECONDS = 31_536_000
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const UNI_V3_SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'

describe('Peer-to-Peer: Recent Forked Mainnet Tests', function () {
  before(async () => {
    console.log('Note: Running mainnet tests with the following forking config:')
    console.log(HARDHAT_CHAIN_ID_AND_FORKING_CONFIG)
    if (HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId !== 1) {
      console.warn('Invalid hardhat forking config! Expected `HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId` to be 1!')

      console.warn('Assuming that current test run is using `npx hardhat coverage`!')

      console.warn('Re-importing mainnet forking config from `hardhat.config.ts`...')
      const mainnetForkingConfig = getRecentMainnetForkingConfig()

      console.warn('Overwriting chainId to hardhat default `31337` to make off-chain signing consistent...')
      HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId = 31337

      console.log('block number: ', mainnetForkingConfig.url)

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

    //prepare dsEth balances
    const DSETH_ADDRESS = '0x341c05c0E9b33C0E38d64de76516b2Ce970bB3BE'
    const DSETH_HOLDER = '0x70044278D556B0C962224e095397A52287C99cB5'
    const dseth = await ethers.getContractAt('IWETH', DSETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [DSETH_HOLDER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DSETH_HOLDER]
    })

    const dsEthHolder = await ethers.getSigner(DSETH_HOLDER)

    await dseth.connect(dsEthHolder).transfer(team.address, '10000000000000000000')

    const wbtc = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    const btcToUSDChainlinkAddr = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
    const wBTCToBTCChainlinkAddr = '0xfdfd9c85ad200c506cf9e21f1fd8dd01932fbb23'

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
      wbtc,
      dseth,
      btcToUSDChainlinkAddr,
      wBTCToBTCChainlinkAddr,
      lenderVault,
      lenderVaultFactory
    }
  }

  describe('TWAP Testing', function () {
    it('Should validate correctly the TWAP', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, dseth, lenderVault } =
        await setupTest()

      const wbtc = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
      const reth = '0xae78736Cd615f374D3085123A210448E74Fc6393'
      const steth = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'

      const usdcEthChainlinkAddr = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
      const rethEthChainlinkAddr = '0x536218f9e9eb48863970252233c8f271f554c2d0'
      const stethEthChainlinkAddr = '0x86392dc19c0b719886221c78ab11eb8cf5c52812'

      const stakewiseEthEthUniV3PoolAddr = '0x7379e81228514a1D2a6Cf7559203998E20598346'
      const usdcWethUniV3PoolAddr = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
      const stethCbethUniV3PoolAddr = '0x01aF87861dc406DB2a870e88B566ac6B5136b0cf'
      const wbtcUsdcUniV3PoolAddr = '0x9a772018FbD77fcD2d25657e5C547BAfF3Fd7D16'

      // deploy uni v3 twap
      const IndexCoopOracle = await ethers.getContractFactory('IndexCoopOracle')
      // revert if tolerance is not between 0 and 10000 exclusive
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [stakewiseEthEthUniV3PoolAddr],
          3600,
          0
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'InvalidOracleTolerance')
      // revert if tolerance is not between 0 and 10000 exclusive
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [stakewiseEthEthUniV3PoolAddr],
          3600,
          10000
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'InvalidOracleTolerance')
      // revert if twap interval is less than 30 minutes (1800 seconds)
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [stakewiseEthEthUniV3PoolAddr],
          300,
          500
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'TooShortTwapInterval')

      // revert if zero address in uni v3 array
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [ZERO_ADDR],
          3600,
          500
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'InvalidAddress')

      // revert if address without weth as one of tokens is in uni v3 array
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [stethCbethUniV3PoolAddr],
          3600,
          500
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'InvalidAddress')

      // revert if address without a component token as one of tokens is in uni v3 array
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [usdcWethUniV3PoolAddr],
          3600,
          500
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'InvalidAddress')

      // revert if address without a component token and without weth as one of tokens is in uni v3 array
      await expect(
        IndexCoopOracle.connect(team).deploy(
          [usdc.address, reth, steth],
          [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
          [wbtcUsdcUniV3PoolAddr],
          3600,
          500
        )
      ).to.be.revertedWithCustomError(IndexCoopOracle, 'InvalidAddress')

      await IndexCoopOracle.connect(team)
      const indexCoopOracle = await IndexCoopOracle.deploy(
        [usdc.address, reth, steth],
        [usdcEthChainlinkAddr, rethEthChainlinkAddr, stethEthChainlinkAddr],
        [stakewiseEthEthUniV3PoolAddr],
        3600,
        500
      )
      await indexCoopOracle.deployed()

      const dsEthCollUsdcLoanPrice = await indexCoopOracle.getPrice(dseth.address, usdc.address)
      const dsEthCollWethLoanPrice = await indexCoopOracle.getPrice(dseth.address, weth.address)

      const usdcColldsEthLoanPrice = await indexCoopOracle.getPrice(usdc.address, dseth.address)
      const wethColldsEthLoanPrice = await indexCoopOracle.getPrice(weth.address, dseth.address)

      await expect(indexCoopOracle.getPrice(usdc.address, weth.address)).to.be.revertedWithCustomError(
        IndexCoopOracle,
        'NO_DSETH'
      )

      // toggle to show logs
      const showLogs = false
      if (showLogs) {
        console.log(
          'dsEthCollUsdcLoanPrice',
          Math.round(100 * Number(ethers.utils.formatUnits(dsEthCollUsdcLoanPrice, 6))) / 100
        )
        console.log(
          'dsEthCollWethLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(dsEthCollWethLoanPrice, 18).slice(0, 8))) / 1000000
        )

        console.log(
          'usdcColldsEthLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(usdcColldsEthLoanPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'wethColldsEthLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(wethColldsEthLoanPrice, 18).slice(0, 8))) / 1000000
        )
      }

      await addressRegistry.connect(team).setWhitelistState([indexCoopOracle.address], 2)

      await addressRegistry.connect(team).setWhitelistState([usdc.address, dseth.address, weth.address], 1)

      const usdcOracleInstance = new ethers.Contract(usdcEthChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

      // lender vault owner deposits USDC
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

      await dseth.connect(team).transfer(borrower.address, ONE_DSETH.mul(10))

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
          collToken: dseth.address,
          loanToken: usdc.address,
          oracleAddr: indexCoopOracle.address,
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
      const borrowerDsEthBalPre = await dseth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultDsEthBalPre = await dseth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await dseth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const collSendAmount = ONE_DSETH
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
      const borrowerDsEthBalPost = await dseth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultDsEthBalPost = await dseth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()

      const loanTokenPriceRaw = loanTokenRoundData.answer

      const collTokenPriceInEth = await indexCoopOracle.getPrice(dseth.address, weth.address)

      const collTokenPriceInLoanToken = collTokenPriceInEth.mul(ONE_USDC).div(loanTokenPriceRaw)
      const maxLoanPerColl = collTokenPriceInLoanToken.mul(75).div(100)

      const borrowerUsdcDelta = Number(borrowerUsdcBalPost.sub(borrowerUsdcBalPre).toString())
      const vaultUsdcDelta = Number(vaultUsdcBalPre.sub(vaultUsdcBalPost).toString())
      const expectedBorrowerUsdcDelta = Number(maxLoanPerColl.toString())
      const expectedVaultUsdcDelta = Number(maxLoanPerColl.toString())

      expect(borrowerDsEthBalPre.sub(borrowerDsEthBalPost)).to.equal(collSendAmount)
      expect(vaultDsEthBalPost.sub(vaultDsEthBalPre)).to.equal(collSendAmount)
      expect(borrowerUsdcDelta).to.equal(expectedBorrowerUsdcDelta)
      expect(vaultUsdcDelta).to.equal(expectedVaultUsdcDelta)
    })
  })
})
