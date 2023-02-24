import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { LenderVault, QuoteHandler } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  balancerV2VaultAbi,
  balancerV2PoolAbi,
  collTokenAbi,
  aavePoolAbi,
  crvRewardsDistributorAbi
} from "./abi"

const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const ONE_PAXG = ethers.BigNumber.from(10).pow(18)
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

const createOnChainRequest = async ({
  lender,
  collToken,
  loanToken,
  borrowerCompartmentImplementation,
  lenderVault,
  quoteHandler,
  loanPerCollUnit
}: {
  lender: SignerWithAddress
  collToken: string
  loanToken: string
  borrowerCompartmentImplementation: string
  lenderVault: LenderVault
  quoteHandler: QuoteHandler
  loanPerCollUnit: BigNumber
}) => {
  const blocknum = await ethers.provider.getBlockNumber()
  const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
  let quoteTuples = [
    {
      loanPerCollUnitOrLtv: loanPerCollUnit,
      interestRatePctInBase: BASE.mul(10).div(100),
      upfrontFeePctInBase: BASE.mul(1).div(100),
      tenor: ONE_DAY.mul(90)
    }
  ]
  let onChainQuote = {
    generalQuoteInfo: {
      borrower: ZERO_ADDR,
      collToken: collToken,
      loanToken: loanToken,
      oracleAddr: ZERO_ADDR,
      minLoan: 0,
      maxLoan: MAX_UINT256,
      validUntil: timestamp + 60,
      earliestRepayTenor: 0,
      borrowerCompartmentImplementation: borrowerCompartmentImplementation,
      isSingleUse: false,
    },
    quoteTuples: quoteTuples,
    salt: ZERO_BYTES32
  }
  await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
  .to.emit(quoteHandler, 'OnChainQuoteAdded')

  return onChainQuote
}

describe('Basic Forked Mainnet Tests', function () {
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
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVault')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(team).deploy()
    await lenderVaultImplementation.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // set lender vault factory, borrower gateway and borrower compartment on address registry (immutable)
    await addressRegistry.setLenderVaultFactory(lenderVaultFactory.address)
    await addressRegistry.setBorrowerGateway(borrowerGateway.address)
    await addressRegistry.setQuoteHandler(quoteHandler.address)

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault()
    const lenderVaultAddr = await addressRegistry.registeredVaults(0)
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

    // deploy balancer v2 callbacks
    const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
    await BalancerV2Looping.connect(lender)
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // whitelist addrs
    await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address, paxg.address])
    await expect(addressRegistry.connect(lender).toggleCallbackAddr(balancerV2Looping.address)).to.be.reverted
    await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address)

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
      lenderVault,
      lenderVaultFactory,
      balancerV2Looping
    }
  }

  describe('On-Chain Quote Testing', function () {
    it('Should process atomic balancer swap correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping } = await setupTest()

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
          isSingleUse: false,
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuoteAdded')

      // Balancer V2 integration: calculate which send amount would be needed to max. lever up in 1-click
      const poolAddr = '0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8'
      const poolId = '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019' // look up via getPoolId() on bal pool
      const balancerV2Pool = await new ethers.Contract(poolAddr, balancerV2PoolAbi, team) // could be any signer, here used team

      const PRECISION = 10000
      const collBuffer = BASE.mul(990).div(1000)
      const initCollFromBorrower = ONE_WETH.mul(collBuffer).div(BASE)
      const initCollFromBorrowerNumber = Number(initCollFromBorrower.mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanPerColl = Number(onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
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
      console.log('sendAmountNumber to max. lever up: ', collSendAmountNumber)
      console.log('sendAmount to max. lever up: ', collSendAmount)

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
      console.log('minSwapReceive: ', minSwapReceive)
      const deadline = MAX_UINT128
      const callbackAddr = balancerV2Looping.address
      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [poolId, minSwapReceive, deadline]
      )
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          onChainQuote,
          quoteTupleIdx,
          callbackAddr,
          callbackData
        )

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
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmount).div(ONE_WETH))
    })
  })

  /*
  it('Should handle auto-quotes correctly', async function () {
    const { addressRegistry, borrowerGateway, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping } =
      await setupTest()
    // deploy an autoquote strategy
    const AaveAutoQuoteStrategy1 = await ethers.getContractFactory('AaveAutoQuoteStrategy1')
    const aaveAutoQuoteStrategy1 = await AaveAutoQuoteStrategy1.connect(team).deploy()
    await aaveAutoQuoteStrategy1.deployed()

    // whitelist autoquote strategy
    await expect(addressRegistry.connect(lender).toggleAutoQuoteStrategy(aaveAutoQuoteStrategy1.address)).to.be.reverted
    await addressRegistry.connect(team).toggleAutoQuoteStrategy(aaveAutoQuoteStrategy1.address)

    // lender subscribes to strategy
    await lenderVault.connect(lender).setAutoQuoteStrategy(weth.address, usdc.address, aaveAutoQuoteStrategy1.address)

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

    // borrower approves borrower gateway
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // test retrieiving autoquote
    const onChainQuote = await aaveAutoQuoteStrategy1.getOnChainQuote()
    console.log('onChainQuote from Aave strategy:', onChainQuote)

    // borrower uses quote to borrow
    const collSendAmount = ONE_WETH
    const isAutoQuote = true
    const callbackAddr = ZERO_ADDR
    const callbackData = ZERO_BYTES32
    await borrowerGateway
      .connect(borrower)
      .borrowWithOnChainQuote(lenderVault.address, collSendAmount, onChainQuote, isAutoQuote, callbackAddr, callbackData)
    const loan = await lenderVault.loans(0)
    const expectedLoanAmount = collSendAmount.mul(onChainQuote.loanPerCollUnit).div(ONE_WETH)
    const expectedRepayAmount = expectedLoanAmount.mul(BASE.add(onChainQuote.interestRatePctInBase)).div(BASE)

    expect(loan.initCollAmount).to.equal(collSendAmount)
    expect(loan.initLoanAmount).to.equal(expectedLoanAmount)
    expect(loan.initRepayAmount).to.equal(expectedRepayAmount)
  })*/

  /*
  it('Should handle unlockCollateral without compartment correctly', async () => {
    const { addressRegistry, borrowerGateway, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()
    // deploy an autoquote strategy
    const AaveAutoQuoteStrategy1 = await ethers.getContractFactory('AaveAutoQuoteStrategy1')
    const aaveAutoQuoteStrategy1 = await AaveAutoQuoteStrategy1.connect(team).deploy()
    await aaveAutoQuoteStrategy1.deployed()

    // whitelist autoquote strategy
    await addressRegistry.connect(team).toggleAutoQuoteStrategy(aaveAutoQuoteStrategy1.address)

    // lender subscribes to strategy
    await lenderVault.connect(lender).setAutoQuoteStrategy(weth.address, usdc.address, aaveAutoQuoteStrategy1.address)

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

    // borrower approves borrower gateway
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // test retrieiving autoquote
    const onChainQuote = await aaveAutoQuoteStrategy1.getOnChainQuote()

    // borrower uses quote to borrow
    const collSendAmount = ONE_WETH
    const isAutoQuote = true
    const callbackAddr = ZERO_ADDR
    const callbackData = ZERO_BYTES32
    await borrowerGateway
      .connect(borrower)
      .borrowWithOnChainQuote(lenderVault.address, collSendAmount, onChainQuote, isAutoQuote, callbackAddr, callbackData)

    const loan = await lenderVault.loans(0)

    await ethers.provider.send('evm_mine', [loan.expiry + 12])

    const lenderWethBalPre = await weth.balanceOf(lender.address)

    expect(lenderWethBalPre).to.equal(BigNumber.from(0))

    await lenderVault.connect(lender).unlockCollateral(weth.address, [0], true)

    const lenderWethBalPost = await weth.balanceOf(lender.address)

    expect(lenderWethBalPost).to.equal(collSendAmount)
  })*/

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
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, ldo, lenderVault, addressRegistry } = await setupTest()

      // create curve staking implementation
      const CurveLPStakingCompartmentImplementation = await ethers.getContractFactory('CurveLPStakingCompartment')
      await CurveLPStakingCompartmentImplementation.connect(team)
      const curveLPStakingCompartmentImplementation = await CurveLPStakingCompartmentImplementation.deploy()
      await curveLPStakingCompartmentImplementation.deployed()

      // increase borrower CRV balance
      const crvTokenAddress = '0xD533a949740bb3306d119CC777fa900bA034cd52'
      const gaugeControllerAddress = '0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB'
      

      const locallyCollBalance = ethers.BigNumber.from(10).pow(18)
      const crvInstance = new ethers.Contract(crvTokenAddress, collTokenAbi, borrower.provider)
      const crvLPInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)
      const crvGaugeInstance = new ethers.Contract(crvGaugeAddress, collTokenAbi, borrower.provider)
      //const rewardContractInstance = new ethers.Contract(rewardContractAddress || '0', collTokenAbi, borrower.provider)
      const rewardDistributionInstance = new ethers.Contract(rewardsDistributionAddress || '0', crvRewardsDistributorAbi, borrower.provider)
      const rewardTokenInstance = new ethers.Contract(rewardTokenAddress || '0', collTokenAbi, borrower.provider)
      //const stableSwapInstance = new ethers.Contract(stableSwapAddress || '0', stableSwapAbi, borrower.provider)

      const gaugeControllerInstance = new ethers.Contract(gaugeControllerAddress, collTokenAbi, borrower.provider)

      // check support gauge in gauge controller
      await expect(gaugeControllerInstance.connect(borrower).gauge_types(crvGaugeAddress)).to.be.not.reverted

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

      // whitelist token pair
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address])

      // whitelist gauge contract
      await expect(addressRegistry.connect(lender).toggleCollTokenHandler(crvGaugeAddress)).to.be.reverted
      await addressRegistry.connect(team).toggleCollTokenHandler(crvGaugeAddress)

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

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          onChainQuote,
          quoteTupleIdx,
          callbackAddr,
          callbackData
        )

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.['collTokenCompartmentAddr']
      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.['initRepayAmount']
      const loanExpiry = borrowEvent?.args?.['expiry']

      const crvCompInstance = await curveLPStakingCompartmentImplementation.attach(collTokenCompartmentAddr)

      await crvCompInstance.connect(borrower).stake(compartmentData)

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
        if(rewardsDistributionAddress){
          await ldo.connect(team).transfer(rewardDistributionInstance.address, '100000000000000000000')
          await rewardDistributionInstance.connect(team).start_next_rewards_period()
        }
      }

      // check balance pre repay
      const borrowerUsdcBalancePre = await usdc.balanceOf(borrower.address)
      console.log('check if borrower has enough balance to repay...')
      console.log('borrowerUsdcBalancePre: ', borrowerUsdcBalancePre)
      console.log('repayAmount: ', repayAmount)
      if (repayAmount.gt(borrowerUsdcBalancePre)) {
        console.log('transfer some funds to borrower...')
        await usdc.connect(lender).transfer(borrower.address, repayAmount.sub(borrowerUsdcBalancePre))
      }
      const borrowerCRVBalancePre = await crvInstance.balanceOf(borrower.address)

      expect(totalGaugeRewardCRV).to.not.equal(BigNumber.from(0))
      expect(borrowerCRVBalancePre).to.equal(BigNumber.from(0))

      const repay = async () => {
        const borrowerRewardTokenBalancePre = rewardTokenAddress ? await rewardTokenInstance.balanceOf(borrower.address): BigNumber.from(0)
        // repay
        await expect(
          borrowerGateway
            .connect(borrower)
            .repay(
              { collToken: collTokenAddress, loanToken: usdc.address, loanId, repayAmount, repaySendAmount: repayAmount },
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

        const borrowerRewardTokenBalancePre = rewardTokenAddress ? await rewardTokenInstance.balanceOf(borrower.address): BigNumber.from(0)
        const compartmentRewardTokenBalancePre = rewardTokenAddress ? await rewardTokenInstance.balanceOf(collTokenCompartmentAddr): BigNumber.from(0)
        // partial repay
        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              collToken: collTokenAddress,
              loanToken: usdc.address,
              loanId,
              repayAmount: partialRepayAmount,
              repaySendAmount: partialRepayAmount
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

        await ethers.provider.send('evm_mine', [loanExpiry + 12])

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
          if(borrowerRewardTokenBalancePost.gt(borrowerRewardTokenBalancePre)){
            expect(borrowerRewardTokenBalancePost.sub(borrowerRewardTokenBalancePre).sub(compartmentRewardTokenBalancePost)).to.be.equal(0)
          
          }
        }

        // unlock collateral
        const lenderVaultRewardTokenBalancePreUnlock = rewardTokenAddress ? await rewardTokenInstance.balanceOf(lenderVault.address) : BigNumber.from(0)
        await lenderVault.connect(lender).unlockCollateral(collTokenAddress, [loanId], false)
        const compartmentRewardTokenBalancePostUnlock = rewardTokenAddress ? await rewardTokenInstance.balanceOf(collTokenCompartmentAddr) : BigNumber.from(0)

        // check vault balance
        const lenderVaultCollBalPost = await crvLPInstance.balanceOf(lenderVault.address)
        const lenderVaultCRVBalancePost = await crvInstance.balanceOf(lenderVault.address)
        const lenderVaultRewardTokenBalancePostUnlock = rewardTokenAddress ? await rewardTokenInstance.balanceOf(lenderVault.address) : BigNumber.from(0)

        expect(lenderVaultCollBalPost).to.equal(locallyCollBalance.div(coeffRepay))
        expect(lenderVaultCRVBalancePost.toString().substring(0, 3)).to.equal(approxPartialCRVPostReward)
        if(compartmentRewardTokenBalancePost.gt(0) && lenderVaultRewardTokenBalancePostUnlock.gt(0)){
          expect(compartmentRewardTokenBalancePostUnlock).to.be.equal(0)
          /**todo: write check on partial repay reward to vault */
        }
      }

      isPartialRepay ? await partialRepay() : await repay()

      // drop crv borrower balance to 0
      const crvSlotIndex = 3
      const crvIndex = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [crvSlotIndex, borrower.address])
      await ethers.provider.send('hardhat_setStorageAt', [
        crvTokenAddress,
        crvIndex.toString(),
        ethers.utils.hexZeroPad(BigNumber.from(0).toHexString(), 32)
      ])

      const emptyCrvBalance = await crvInstance.balanceOf(borrower.address)

      expect(emptyCrvBalance).to.equal(BigNumber.from(0))
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

    it('Should process aToken borrow/repay correctly with rewards', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault, addressRegistry } = await setupTest()

      // create curve staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      await AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

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
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address])

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

      // borrow with on chain quote
      const collSendAmount = BigNumber.from(10).pow(18)
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDR
      const callbackData = ZERO_BYTES32

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, collSendAmount, expectedTransferFee, onChainQuote, quoteTupleIdx, callbackAddr, callbackData)
      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.['initRepayAmount']

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // repay
      await expect(
        borrowerGateway
          .connect(borrower)
          .repay(
            { collToken: collTokenAddress, loanToken: usdc.address, loanId, repayAmount, repaySendAmount: repayAmount },
            lenderVault.address,
            callbackAddr,
            callbackData
          )
      )
        .to.emit(borrowerGateway, 'Repay')
        .withArgs(lenderVault.address, loanId, repayAmount)

      // check balance post repay
      const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)

      expect(borrowerCollRepayBalPost).to.be.above(borrowerCollBalPre)
    })

    it('Should delegate voting correctly', async () => {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, lenderVault, addressRegistry } = await setupTest()

      // create uni staking implementation
      const VotingCompartmentImplementation = await ethers.getContractFactory('VoteCompartment')
      await VotingCompartmentImplementation.connect(team)
      const votingCompartmentImplementation = await VotingCompartmentImplementation.deploy()
      await votingCompartmentImplementation.deployed()

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
      await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address])

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

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          onChainQuote,
          quoteTupleIdx,
          callbackAddr,
          callbackData
        )

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const collTokenCompartmentAddr = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })?.args?.['collTokenCompartmentAddr']

      const uniCompInstance = await votingCompartmentImplementation.attach(collTokenCompartmentAddr)

      const borrowerVotesPreDelegation = await collInstance.getCurrentVotes(borrower.address)

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
    })
  })

  describe('Testing with token transfer fees', function () {
    it('Should process onChain quote with fees', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, paxg, lenderVault } = await setupTest()

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
          isSingleUse: false,
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuoteAdded')

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
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          onChainQuote,
          quoteTupleIdx,
          callbackAddr,
          callbackData
        )

      // check balance post borrow
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerPaxgBalPre.sub(borrowerPaxgBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(ONE_USDC.mul(1000))
      expect(Math.abs(Number(vaultPaxgBalPost.sub(vaultPaxgBalPre).sub(collSendAmount.mul(9998).div(10000).toString())))).to.lessThanOrEqual(1)
      expect(Math.abs(Number(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(onChainQuote.quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmount.mul(9998)).div(10000).div(ONE_PAXG)).toString()))).to.lessThanOrEqual(1)
    })

    it('Should process onChain quote with fees including protocol fee', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, paxg, lenderVault } = await setupTest()

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
        },
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
          isSingleUse: false,
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuoteAdded')
      
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
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          totalExpectedFees,
          onChainQuote,
          quoteTupleIdx,
          callbackAddr,
          callbackData
        )

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
  })
})
