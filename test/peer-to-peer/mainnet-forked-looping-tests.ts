import { expect } from 'chai'
import { ethers } from 'hardhat'
import { fromReadableAmount, toReadableAmount, getOptimCollSendAndFlashBorrowAmount } from './helpers/uniV3'
import { SupportedChainId, Token } from '@uniswap/sdk-core'
import { INFURA_API_KEY, MAINNET_BLOCK_NUMBER } from '../../hardhat.config'

// test config constants & vars
const BLOCK_NUMBER = MAINNET_BLOCK_NUMBER
let snapshotId: String // use snapshot id to reset state before each test

// constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')

describe('Peer-to-Peer: Forked Mainnet Tests re Looping', function () {
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
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(10) })

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

    // deploy uni v3 callback
    const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
    await UniV3Looping.connect(lender)
    const uniV3Looping = await UniV3Looping.deploy()
    await uniV3Looping.deployed()

    // whitelist addrs
    await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)
    await expect(addressRegistry.connect(lender).setWhitelistState([uniV3Looping.address], 4)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidSender'
    )
    await addressRegistry.connect(team).setWhitelistState([uniV3Looping.address], 4)

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
      uniV2WethUsdc,
      lenderVault,
      lenderVaultFactory,
      uniV3Looping
    }
  }

  describe('On-Chain Quote Testing', function () {
    before(async function () {
      await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [
          {
            forking: {
              jsonRpcUrl: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
              blockNumber: BLOCK_NUMBER
            }
          }
        ]
      })
    })

    beforeEach(async () => {
      snapshotId = await hre.network.provider.send('evm_snapshot')
    })

    afterEach(async () => {
      await hre.network.provider.send('evm_revert', [snapshotId])
    })

    it('Uni V3 Looping Test', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault, uniV3Looping } = await setupTest()

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
          whitelistAuthority: ZERO_ADDR,
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
      const expectedTransferFee = 0
      const deadline = MAX_UINT128
      const callbackAddr = uniV3Looping.address

      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint24'],
        [minSwapReceiveBn, deadline, poolFee]
      )
      const borrowInstructions = {
        collSendAmount: collSendAmountBn,
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

      // check repay
      const loan = await lenderVault.loan(0)
      const minSwapReceiveLoanToken = 0
      const callbackDataRepay = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint24'],
        [minSwapReceiveLoanToken, deadline, poolFee]
      )
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: 0,
            targetRepayAmount: loan.initRepayAmount,
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackDataRepay
        )
      )
    })
  })
})
