import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { ALCHEMY_API_KEY, ARBITRUM_BLOCK_NUMBER, ARBITRUM_CHAIN_ID } from '../../hardhat.config'
import { collTokenAbi, gmxRewardRouterAbi } from './helpers/abi'
import { createOnChainRequest } from './helpers/misc'
import { fromReadableAmount, getOptimCollSendAndFlashBorrowAmount, toReadableAmount } from './helpers/uniV3'
import { SupportedChainId, Token } from '@uniswap/sdk-core'

// test config constants & vars
const BLOCK_NUMBER = ARBITRUM_BLOCK_NUMBER
const CHAIN_ID = ARBITRUM_CHAIN_ID
let snapshotId: String // use snapshot id to reset state before each test

// constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)

describe('Peer-to-Peer: Arbitrum Tests', function () {
  before(async function () {
    // reset/overwrite arbitrum endpoint from hardhat.config to allow running eth and arbitrum tests in one go
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          chainId: CHAIN_ID,
          forking: {
            jsonRpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
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

  async function setupTest() {
    const [lender, borrower, team] = await ethers.getSigners()
    /* ************************************ */
    /* DEPLOYMENT OF SYSTEM CONTRACTS START */
    /* ************************************ */
    // deploy address registry
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

    // deploy balancer v2 callbacks
    const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
    await BalancerV2Looping.connect(lender)
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // deploy uni v3 callback
    const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
    await UniV3Looping.connect(lender)
    const uniV3Looping = await UniV3Looping.deploy()
    await uniV3Looping.deployed()

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault()
    const lenderVaultAddrs = await addressRegistry.registeredVaults()
    const lenderVaultAddr = lenderVaultAddrs[0]
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // prepare USDC balances
    const USDC_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
    const USDC_MASTER_MINTER = '0x096760f208390250649e3e8763348e783aef5562'
    const usdc = await ethers.getContractAt('IUSDC', USDC_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [USDC_MASTER_MINTER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_MASTER_MINTER]
    })
    const masterMinter = await ethers.getSigner(USDC_MASTER_MINTER)
    await usdc.connect(masterMinter).bridgeMint(lender.address, MAX_UINT128)

    // prepare WETH balance
    const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    const weth = await ethers.getContractAt('IWETH', WETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [borrower.address, '0x204FCE5E3E25026110000000'])
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(100000) })

    // whitelist addrs
    await expect(
      addressRegistry.connect(lender).setWhitelistState([balancerV2Looping.address], 4)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSender')
    await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 4)
    await addressRegistry.connect(team).setWhitelistState([uniV3Looping.address], 4)

    return {
      addressRegistry,
      borrowerGateway,
      lenderVaultImplementation,
      lender,
      borrower,
      team,
      usdc,
      weth,
      lenderVault,
      lenderVaultFactory,
      quoteHandler,
      balancerV2Looping,
      uniV3Looping
    }
  }

  it('Should process GLP borrow/repay correctly with rewards', async function () {
    const { borrowerGateway, lender, borrower, quoteHandler, team, usdc, weth, lenderVault, addressRegistry } =
      await setupTest()

    // create glp staking implementation
    const GlpStakingCompartmentImplementation = await ethers.getContractFactory('GLPStakingCompartment')
    await GlpStakingCompartmentImplementation.connect(team)
    const glpStakingCompartmentImplementation = await GlpStakingCompartmentImplementation.deploy()
    await glpStakingCompartmentImplementation.deployed()

    await addressRegistry.connect(team).setWhitelistState([glpStakingCompartmentImplementation.address], 3)

    // increase borrower GLP balance
    const collTokenAddress = '0x5402B5F40310bDED796c7D0F3FF6683f5C0cFfdf' // GLP
    const rewardRouterAddress = '0xB95DB5B167D75e6d04227CfFFA61069348d271F5' // GMX: Reward Router V2
    const glpManagerAddress = '0x3963FfC9dff443c2A94f21b129D429891E32ec18' // GLP Manager
    const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

    const rewardRouterInstance = new ethers.Contract(rewardRouterAddress, gmxRewardRouterAbi, borrower.provider)

    // mint GLP token
    await weth.connect(borrower).approve(glpManagerAddress, MAX_UINT256)
    await rewardRouterInstance
      .connect(borrower)
      .mintAndStakeGlp(weth.address, ONE_WETH, BigNumber.from(0), BigNumber.from(0))

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

    // get pre balances
    const borrowerWethBalPre = await weth.balanceOf(borrower.address)
    const borrowerCollBalPre = await collInstance.balanceOf(borrower.address)
    const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

    expect(borrowerCollBalPre).to.be.above(BigNumber.from(0))
    expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(10000000))

    // whitelist token pair
    await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address], 1)

    // borrower approves borrower gateway
    await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    const onChainQuote = await createOnChainRequest({
      lender,
      collToken: collTokenAddress,
      loanToken: usdc.address,
      borrowerCompartmentImplementation: glpStakingCompartmentImplementation.address,
      lenderVault,
      quoteHandler,
      loanPerCollUnit: ONE_USDC.mul(1000)
    })

    // borrow with on chain quote
    const collSendAmount = borrowerCollBalPre
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

    // Since there is a 15 min cooldown duration after minting GLP, needs to pass for the user before transfer
    // mine 200 blocks with an interval of 60 seconds, ~3 hours
    await hre.network.provider.send('hardhat_mine', [BigNumber.from(200).toHexString(), BigNumber.from(60).toHexString()])

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

    const coeffRepay = 2
    const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

    // check balance post borrow
    const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

    expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

    // borrower approves borrower gateway
    await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // mine 50000 blocks with an interval of 60 seconds, ~1 month
    await hre.network.provider.send('hardhat_mine', [BigNumber.from(50000).toHexString(), BigNumber.from(60).toHexString()])

    // increase borrower usdc balance to repay
    await usdc.connect(lender).transfer(borrower.address, ONE_USDC.mul(10000000))

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
      .to.emit(borrowerGateway, 'Repaid')
      .withArgs(lenderVault.address, loanId, partialRepayAmount)

    // check balance post repay
    const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)
    const borrowerWethRepayBalPost = await weth.balanceOf(borrower.address)

    expect(borrowerCollRepayBalPost).to.be.equal(borrowerCollBalPre.div(coeffRepay))
    expect(borrowerWethRepayBalPost).to.be.above(borrowerWethBalPre)

    await ethers.provider.send('evm_mine', [loanExpiry + 12])

    // unlock collateral
    const lenderVaultWethBalPre = await weth.balanceOf(lenderVault.address)
    const lenderCollBalPre = await collInstance.balanceOf(lender.address)

    expect(lenderCollBalPre).to.equal(BigNumber.from(0))

    await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId], true)

    const lenderVaultWethBalPost = await weth.balanceOf(lenderVault.address)
    const lenderCollBalPost = await collInstance.balanceOf(lender.address)

    expect(lenderVaultWethBalPost).to.be.above(lenderVaultWethBalPre)
    expect(lenderCollBalPost).to.equal(borrowerCollBalPre.div(coeffRepay))
  })

  it('Uni V3 Looping Test', async function () {
    const { quoteHandler, lender, borrower, usdc, weth, lenderVault, addressRegistry, team, uniV3Looping, borrowerGateway } =
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

    // whitelist token pair
    await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)

    await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
      quoteHandler,
      'OnChainQuoteAdded'
    )

    // prepare looping
    const dexSwapTokenIn = new Token(SupportedChainId.ARBITRUM_ONE, usdc.address, 6, 'USDC', 'USD//C')
    const dexSwapTokenOut = new Token(SupportedChainId.ARBITRUM_ONE, weth.address, 18, 'WETH', 'Wrapped Ether')
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

    // borrower approves and executes quote
    const collSendAmountBn = fromReadableAmount(initCollUnits + minSwapReceive, dexSwapTokenOut.decimals)
    const slippage = 0.01
    const minSwapReceiveBn = fromReadableAmount(minSwapReceive * (1 - slippage), dexSwapTokenOut.decimals)
    const quoteTupleIdx = 0
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
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

  it('Should revert GLP borrow with compartment and univ3 looping because of missing pool', async function () {
    const { borrowerGateway, lender, borrower, quoteHandler, team, usdc, weth, lenderVault, addressRegistry, uniV3Looping } =
      await setupTest()

    // create curve staking implementation
    const GlpStakingCompartmentImplementation = await ethers.getContractFactory('GLPStakingCompartment')
    await GlpStakingCompartmentImplementation.connect(team)
    const glpStakingCompartmentImplementation = await GlpStakingCompartmentImplementation.deploy()
    await glpStakingCompartmentImplementation.deployed()

    // increase borrower GLP balance
    const collTokenAddress = '0x5402B5F40310bDED796c7D0F3FF6683f5C0cFfdf' // GLP
    const rewardRouterAddress = '0xB95DB5B167D75e6d04227CfFFA61069348d271F5' // GMX: Reward Router V2
    const glpManagerAddress = '0x3963FfC9dff443c2A94f21b129D429891E32ec18' // GLP Manager
    const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

    const rewardRouterInstance = new ethers.Contract(rewardRouterAddress, gmxRewardRouterAbi, borrower.provider)

    // mint GLP token
    await weth.connect(borrower).approve(glpManagerAddress, MAX_UINT256)
    await rewardRouterInstance
      .connect(borrower)
      .mintAndStakeGlp(weth.address, ONE_WETH, BigNumber.from(0), BigNumber.from(0))

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

    // get pre balances
    const borrowerWethBalPre = await weth.balanceOf(borrower.address)
    const borrowerCollBalPre = await collInstance.balanceOf(borrower.address)
    const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

    expect(borrowerCollBalPre).to.be.above(BigNumber.from(0))
    expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(10000000))

    // whitelist token pair
    await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address], 1)

    // borrower approves borrower gateway
    await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // lenderVault owner gives quote
    const onChainQuote = await createOnChainRequest({
      lender,
      collToken: collTokenAddress,
      loanToken: usdc.address,
      borrowerCompartmentImplementation: glpStakingCompartmentImplementation.address,
      lenderVault,
      quoteHandler,
      loanPerCollUnit: ONE_USDC.mul(1000)
    })

    // prepare looping
    const dexSwapTokenIn = new Token(SupportedChainId.ARBITRUM_ONE, usdc.address, 6, 'USDC', 'USD//C')
    const dexSwapTokenOut = new Token(SupportedChainId.ARBITRUM_ONE, weth.address, 18, 'WETH', 'Wrapped Ether')
    const initCollUnits = 10
    const transferFee = 0
    const poolFee = 3000 // assume "medium" uni v3 swap fee
    const { finalTotalPledgeAmount, minSwapReceive, finalFlashBorrowAmount } = await getOptimCollSendAndFlashBorrowAmount(
      initCollUnits,
      transferFee,
      toReadableAmount(onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.toString(), dexSwapTokenIn.decimals),
      dexSwapTokenIn,
      dexSwapTokenOut,
      poolFee
    )
    // borrower approves and executes quote
    const collSendAmountBn = fromReadableAmount(initCollUnits + minSwapReceive, dexSwapTokenOut.decimals)
    const slippage = 0.01
    const minSwapReceiveBn = fromReadableAmount(minSwapReceive * (1 - slippage), dexSwapTokenOut.decimals)
    const quoteTupleIdx = 0
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
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

    await expect(
      borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
    ).to.be.reverted
  })
})
