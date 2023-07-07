import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG, getArbitrumForkingConfig } from '../../hardhat.config'
import { collTokenAbi, gmxRewardRouterAbi, chainlinkAggregatorAbi } from './helpers/abi'
import { createOnChainRequest, setupBorrowerWhitelist } from './helpers/misc'
import { fromReadableAmount, getOptimCollSendAndFlashBorrowAmount, toReadableAmount } from './helpers/uniV3'
import { SupportedChainId, Token } from '@uniswap/sdk-core'

// test config constants & vars
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
  before(async () => {
    console.log('Note: Running arbitrum tests with the following forking config:')
    console.log(HARDHAT_CHAIN_ID_AND_FORKING_CONFIG)
    if (HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId !== 42161) {
      console.warn('Invalid hardhat forking config! Expected `HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId` to be 42161!')

      console.warn('Assuming that current test run is using `npx hardhat coverage`!')

      console.warn('Re-importing arbitrum forking config from `hardhat.config.ts`...')
      const arbitrumForkingConfig = getArbitrumForkingConfig()

      console.warn('Overwriting chainId to hardhat default `31337` to make off-chain signing consistent...')
      HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId = 31337

      console.warn('Trying to manually switch network to forked arbitrum for this test file...')
      await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [
          {
            forking: {
              jsonRpcUrl: arbitrumForkingConfig.url,
              blockNumber: arbitrumForkingConfig.blockNumber
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
    const [lender, borrower, team, whitelistAuthority] = await ethers.getSigners()
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
    const balancerV2Looping = await BalancerV2Looping.deploy(borrowerGateway.address)
    await balancerV2Looping.deployed()

    // deploy uni v3 callback
    const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
    await UniV3Looping.connect(lender)
    const uniV3Looping = await UniV3Looping.deploy(borrowerGateway.address)
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
    await expect(addressRegistry.connect(lender).setWhitelistState([balancerV2Looping.address], 4)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
    await addressRegistry.connect(team).setWhitelistState([balancerV2Looping.address], 4)
    await addressRegistry.connect(team).setWhitelistState([uniV3Looping.address], 4)

    return {
      addressRegistry,
      borrowerGateway,
      lenderVaultImplementation,
      lender,
      borrower,
      team,
      whitelistAuthority,
      usdc,
      weth,
      lenderVault,
      lenderVaultFactory,
      quoteHandler,
      balancerV2Looping,
      uniV3Looping
    }
  }

  it('Should process GLP borrow/repay correctly when collateral weth was mistakenly whitelisted', async function () {
    const { borrowerGateway, lender, borrower, quoteHandler, team, usdc, weth, lenderVault, addressRegistry } =
      await setupTest()

    // create glp staking implementation
    const GlpStakingCompartmentImplementation = await ethers.getContractFactory('GLPStakingCompartment')
    await GlpStakingCompartmentImplementation.connect(team)
    const glpStakingCompartmentImplementation = await GlpStakingCompartmentImplementation.deploy()
    await glpStakingCompartmentImplementation.deployed()

    // whitelist tokens
    await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)
    // whitelist compartment
    await addressRegistry.connect(team).setWhitelistState([glpStakingCompartmentImplementation.address], 3)
    // whitelist tokens for compartment
    await addressRegistry
      .connect(team)
      .setAllowedTokensForCompartment(glpStakingCompartmentImplementation.address, [weth.address], true)

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

    // get pre balances
    const borrowerWethBalPre = await weth.balanceOf(borrower.address)
    const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)
    const vaultWethBalPre = await weth.balanceOf(lenderVault.address)

    expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(10000000))

    // borrower approves borrower gateway
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    const onChainQuote = await createOnChainRequest({
      lender,
      collToken: weth.address,
      loanToken: usdc.address,
      borrowerCompartmentImplementation: glpStakingCompartmentImplementation.address,
      lenderVault,
      quoteHandler,
      loanPerCollUnit: ONE_USDC.mul(1000),
      validUntil: MAX_UINT256
    })

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
    const borrowerCollBalPost = await weth.balanceOf(borrower.address)
    expect(borrowerWethBalPre.sub(borrowerCollBalPost)).to.be.equal(ONE_WETH)
    const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
    expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    const expUpfrontFee = collSendAmount.mul(onChainQuote.quoteTuples[0].upfrontFeePctInBase).div(BASE)
    const vaultCollBalPost = await weth.balanceOf(lenderVault.address)
    expect(vaultCollBalPost.sub(vaultWethBalPre)).to.equal(expUpfrontFee)

    // borrower approves borrower gateway
    await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // mine 50000 blocks with an interval of 60 seconds, ~1 month
    await hre.network.provider.send('hardhat_mine', [BigNumber.from(50000).toHexString(), BigNumber.from(60).toHexString()])

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
    const borrowerCollRepayBalPost = await weth.balanceOf(borrower.address)
    const expReclaimedColl = initCollAmount.mul(partialRepayAmount).div(repayAmount)
    expect(borrowerUsdcBalPost).to.be.equal(borrowerUsdcBalPostRepay)
    expect(vaultUsdcBalPostRepay.sub(vaultUsdcBalPost)).to.be.equal(partialRepayAmount)
    expect(borrowerCollRepayBalPost.sub(borrowerCollBalPost)).to.be.equal(expReclaimedColl)

    // move forward past loan expiry
    await ethers.provider.send('evm_mine', [loanExpiry + 12])

    // unlock unclaimed collateral
    const lenderVaultWethBalPre = await weth.balanceOf(lenderVault.address)
    const lenderCollBalPre = await weth.balanceOf(lender.address)

    expect(lenderCollBalPre).to.equal(BigNumber.from(0))

    await lenderVault.connect(lender).unlockCollateral(weth.address, [loanId])

    const lenderCollBalPost = await weth.balanceOf(lender.address)
    const lenderVaultCollBalPost = await weth.balanceOf(lenderVault.address)

    // unlock collateral
    expect(lenderCollBalPost).to.equal(lenderCollBalPre)
    expect(lenderVaultCollBalPost).to.equal(initCollAmount.sub(expReclaimedColl).add(expUpfrontFee))
  })

  it('Should process GLP borrow/repay correctly with rewards', async function () {
    const { borrowerGateway, lender, borrower, quoteHandler, team, usdc, weth, lenderVault, addressRegistry } =
      await setupTest()

    // create glp staking implementation
    const GlpStakingCompartmentImplementation = await ethers.getContractFactory('GLPStakingCompartment')
    await GlpStakingCompartmentImplementation.connect(team)
    const glpStakingCompartmentImplementation = await GlpStakingCompartmentImplementation.deploy()
    await glpStakingCompartmentImplementation.deployed()

    // increase borrower GLP balance
    const collTokenAddress = '0x5402B5F40310bDED796c7D0F3FF6683f5C0cFfdf' // GLP
    const rewardRouterAddress = '0xB95DB5B167D75e6d04227CfFFA61069348d271F5' // GMX: Reward Router V2
    const glpManagerAddress = '0x3963FfC9dff443c2A94f21b129D429891E32ec18' // GLP Manager
    const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

    // whitelist tokens
    await addressRegistry.connect(team).setWhitelistState([collTokenAddress, usdc.address], 1)
    // whitelist compartment
    await addressRegistry.connect(team).setWhitelistState([glpStakingCompartmentImplementation.address], 3)
    // whitelist tokens for compartment
    await addressRegistry
      .connect(team)
      .setAllowedTokensForCompartment(glpStakingCompartmentImplementation.address, [collTokenAddress], true)

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
    const vaultCollBalPre = await collInstance.balanceOf(lenderVault.address)

    expect(borrowerCollBalPre).to.be.above(BigNumber.from(0))
    expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(10000000))

    // borrower approves borrower gateway
    await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    const onChainQuote = await createOnChainRequest({
      lender,
      collToken: collTokenAddress,
      loanToken: usdc.address,
      borrowerCompartmentImplementation: glpStakingCompartmentImplementation.address,
      lenderVault,
      quoteHandler,
      loanPerCollUnit: ONE_USDC.mul(1000),
      validUntil: MAX_UINT256
    })

    // borrow with on chain quote
    const collSendAmount = borrowerCollBalPre
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
    const initCollAmount = borrowEvent?.args?.loan?.['initCollAmount']

    const coeffRepay = 2
    const partialRepayAmount = BigNumber.from(repayAmount).div(coeffRepay)

    // check balance post borrow
    const borrowerCollBalPost = await collInstance.balanceOf(borrower.address)
    expect(borrowerCollBalPost).to.be.equal(0)
    const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
    expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    const expUpfrontFee = collSendAmount.mul(onChainQuote.quoteTuples[0].upfrontFeePctInBase).div(BASE)
    const vaultCollBalPost = await collInstance.balanceOf(lenderVault.address)
    expect(vaultCollBalPost.sub(vaultCollBalPre)).to.equal(expUpfrontFee)

    // borrower approves borrower gateway
    await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // mine 50000 blocks with an interval of 60 seconds, ~1 month
    await hre.network.provider.send('hardhat_mine', [BigNumber.from(50000).toHexString(), BigNumber.from(60).toHexString()])

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
    const borrowerWethRepayBalPost = await weth.balanceOf(borrower.address)
    const expReclaimedColl = initCollAmount.mul(partialRepayAmount).div(repayAmount)
    expect(borrowerUsdcBalPost).to.be.equal(borrowerUsdcBalPostRepay)
    expect(vaultUsdcBalPostRepay.sub(vaultUsdcBalPost)).to.be.equal(partialRepayAmount)
    expect(borrowerCollRepayBalPost).to.be.equal(expReclaimedColl)
    expect(borrowerWethRepayBalPost).to.be.above(borrowerWethBalPre)

    // move forward past loan expiry
    await ethers.provider.send('evm_mine', [loanExpiry + 12])

    // unlock unclaimed collateral
    const lenderVaultWethBalPre = await weth.balanceOf(lenderVault.address)
    const lenderCollBalPre = await collInstance.balanceOf(lender.address)

    expect(lenderCollBalPre).to.equal(BigNumber.from(0))

    const lenderVaultCollBalPre = await collInstance.balanceOf(lenderVault.address)

    await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId])

    const lenderVaultWethBalPost = await weth.balanceOf(lenderVault.address)
    const lenderCollBalPost = await collInstance.balanceOf(lender.address)
    const lenderVaultCollBalPost = await collInstance.balanceOf(lenderVault.address)

    expect(lenderVaultWethBalPost).to.be.above(lenderVaultWethBalPre)
    // unlock collateral
    expect(lenderCollBalPost).to.equal(lenderCollBalPre)
    expect(lenderVaultCollBalPost).to.equal(initCollAmount.sub(expReclaimedColl).add(expUpfrontFee))
  })

  it('Uni V3 Looping Test', async function () {
    const {
      quoteHandler,
      lender,
      borrower,
      whitelistAuthority,
      usdc,
      weth,
      lenderVault,
      addressRegistry,
      team,
      uniV3Looping,
      borrowerGateway
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

    // get borrower whitelisted
    const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
    await setupBorrowerWhitelist({
      addressRegistry,
      borrower,
      whitelistAuthority,
      chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
      whitelistedUntil
    })

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
    const loanId = 0
    const loan = await lenderVault.loan(loanId)
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
    // whitelist compartment
    await addressRegistry.connect(team).setWhitelistState([glpStakingCompartmentImplementation.address], 3)

    // whitelist tokens for compartment
    await addressRegistry
      .connect(team)
      .setAllowedTokensForCompartment(glpStakingCompartmentImplementation.address, [collTokenAddress], true)

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

    await expect(
      borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
    ).to.be.reverted
  })
  describe('Testing chainlink arbitrum oracles', function () {
    const usdcUsdChainlinkAddr = '0x50834f3163758fcc1df9973b6e91f0f0f0434ad3'
    const ethUsdChainlinkAddr = '0x639fe6ab55c921f74e7fac1ee960c0b6293ba612'

    it('Should process usd based oracles correctly', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, usdc, weth, team, lenderVault } =
        await setupTest()

      const ChainlinkBasicWithSequencerImplementation = await ethers.getContractFactory('ChainlinkArbitrumSequencerUSD')

      const chainlinkBasicWithSequencerImplementation = await ChainlinkBasicWithSequencerImplementation.connect(team).deploy(
        [usdc.address, weth.address],
        [usdcUsdChainlinkAddr, ethUsdChainlinkAddr]
      )

      await chainlinkBasicWithSequencerImplementation.deployed()

      await addressRegistry.connect(team).setWhitelistState([chainlinkBasicWithSequencerImplementation.address], 2)

      const usdcOracleInstance = new ethers.Contract(usdcUsdChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)
      const wethOracleInstance = new ethers.Contract(ethUsdChainlinkAddr, chainlinkAggregatorAbi, borrower.provider)

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
          oracleAddr: chainlinkBasicWithSequencerImplementation.address,
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

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      // retrieve prices directly from chainlink
      const loanTokenRoundData = await usdcOracleInstance.latestRoundData()
      const collTokenRoundData = await wethOracleInstance.latestRoundData()
      const loanTokenPriceRaw = loanTokenRoundData.answer
      const collTokenPriceRaw = collTokenRoundData.answer

      // retrieve prices from myso oracle
      const tokenPrices = await chainlinkBasicWithSequencerImplementation.getRawPrices(weth.address, usdc.address)

      // check that retrieved raw prices match
      expect(collTokenPriceRaw).to.be.equal(tokenPrices[0])
      expect(loanTokenPriceRaw).to.be.equal(tokenPrices[1])

      const loanPerCollUnit = BASE.mul(75).div(100)
      const maxLoanPerColl = loanPerCollUnit.mul(collTokenPriceRaw).mul(ONE_USDC).div(loanTokenPriceRaw).div(BASE)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(maxLoanPerColl)
      expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(collSendAmount)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(maxLoanPerColl)
    })
  })
})
