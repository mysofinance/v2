import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  getLoanTermsTemplate,
  getRepaymentScheduleEntry,
  createLoanProposal,
  getDummyLoanTerms,
  addSubscriptionsToLoanProposal
} from './helpers/misc'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'

// test config vars
let snapshotId: String // use snapshot id to reset state before each test

// general constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)

// deployment parameterization constants
const MIN_ARRANGER_FEE = BASE.mul(5).div(10000) // 5bps
const MAX_ARRANGER_FEE = BASE.mul(5).div(10) // 50%
const MIN_UNSUBSCRIBE_GRACE_PERIOD = ONE_DAY
const LOAN_TERMS_UPDATE_COOL_OFF_PERIOD = 60 * 60
const MIN_TIME_BETWEEN_DUE_DATES = ONE_DAY.mul(7)
const MIN_CONVERSION_GRACE_PERIOD = ONE_DAY
const MIN_REPAYMENT_GRACE_PERIOD = ONE_DAY
const MIN_LOAN_EXECUTION_GRACE_PERIOD = ONE_DAY
const MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD = ONE_DAY.mul(5)
const MIN_TIME_UNTIL_FIRST_DUE_DATE = ONE_DAY
const LOAN_EXECUTION_GRACE_PERIOD = ONE_DAY

// test loan proposal constants
const UNSUBSCRIBE_GRACE_PERIOD = MIN_UNSUBSCRIBE_GRACE_PERIOD
const CONVERSION_GRACE_PERIOD = MIN_CONVERSION_GRACE_PERIOD
const REPAYMENT_GRACE_PERIOD = MIN_REPAYMENT_GRACE_PERIOD
const REL_ARRANGER_FEE = BASE.mul(50).div(10000)

describe('Peer-to-Pool: Local Tests', function () {
  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  async function setupTest() {
    const [lender0, lender1, lender2, lender3, arranger, daoTreasury, team, anyUser] = await ethers.getSigners()

    // deploy test tokens
    const MyERC20 = await ethers.getContractFactory('MyERC20')

    const USDC = await MyERC20
    const usdc = await USDC.deploy('USDC', 'USDC', 6)
    await usdc.deployed()

    const DAOToken = await MyERC20
    const daoToken = await DAOToken.deploy('DAO-Token', 'DAO-Token', 18)
    await daoToken.deployed()

    // transfer some test tokens
    await usdc.mint(lender0.address, ONE_USDC.mul(1000000))
    await usdc.mint(lender1.address, ONE_USDC.mul(1000000))
    await usdc.mint(lender2.address, ONE_USDC.mul(1000000))
    await usdc.mint(lender3.address, ONE_USDC.mul(1000000))
    await daoToken.mint(daoTreasury.address, ONE_WETH.mul(10000000))

    const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
    const loanProposalImpl = await LoanProposalImpl.deploy()
    await loanProposalImpl.deployed()

    const LoanProposalFactory = await ethers.getContractFactory('LoanProposalFactory')
    const loanProposalFactory = await LoanProposalFactory.connect(team).deploy(loanProposalImpl.address)
    await loanProposalFactory.deployed()
    await expect(
      loanProposalFactory.connect(lender1).setArrangerFeeSplit(BASE.mul(20).div(100))
    ).to.be.revertedWithCustomError(loanProposalFactory, 'InvalidSender')
    await expect(loanProposalFactory.connect(team).setArrangerFeeSplit(BASE.mul(80).div(100))).to.be.revertedWithCustomError(
      loanProposalFactory,
      'InvalidFee'
    )
    await loanProposalFactory.connect(team).setArrangerFeeSplit(BASE.mul(20).div(100))

    const FundingPool = await ethers.getContractFactory('FundingPool')
    const fundingPool = await FundingPool.deploy(loanProposalFactory.address, usdc.address)
    await fundingPool.deployed()

    // reverts if trying to initialize base contract
    await expect(
      loanProposalImpl.initialize(arranger.address, fundingPool.address, daoToken.address, 1, ONE_DAY, ONE_DAY, ONE_DAY)
    ).to.be.revertedWith('Initializable: contract is already initialized')

    return {
      fundingPool,
      loanProposalFactory,
      usdc,
      daoToken,
      lender0,
      lender1,
      lender2,
      lender3,
      arranger,
      daoTreasury,
      team,
      anyUser
    }
  }

  it('Should handle creating a new loan proposal contract correctly', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert on zero addresses
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          ADDRESS_ZERO,
          daoToken.address,
          BASE.mul(10).div(100),
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidAddress')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          ADDRESS_ZERO,
          BASE.mul(10).div(100),
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidAddress')
    // revert on too small arranger fee
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          0,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidFee')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE.sub(1),
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidFee')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MAX_ARRANGER_FEE.add(1),
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidFee')
    // revert on too short unsubscribe grace period
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE,
          0,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE,
          MIN_UNSUBSCRIBE_GRACE_PERIOD.sub(1),
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD.sub(1),
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD.sub(1)
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD.sub(MIN_CONVERSION_GRACE_PERIOD).add(1)
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      loanProposalFactory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          MIN_ARRANGER_FEE,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD.sub(MIN_REPAYMENT_GRACE_PERIOD).add(1),
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
  })

  it('Should handle loan proposals correctly', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger, team } = await setupTest()

    // arranger creates loan proposal
    await loanProposalFactory
      .connect(arranger)
      .createLoanProposal(
        fundingPool.address,
        daoToken.address,
        REL_ARRANGER_FEE,
        UNSUBSCRIBE_GRACE_PERIOD,
        CONVERSION_GRACE_PERIOD,
        REPAYMENT_GRACE_PERIOD
      )
    const loanProposalAddr = await loanProposalFactory.loanProposals(0)
    const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
    const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)

    // check initialization data is set correctly
    const staticData = await loanProposal.staticData()
    expect(staticData.fundingPool).to.equal(fundingPool.address)
    expect(staticData.collToken).to.equal(daoToken.address)
    expect(staticData.arranger).to.equal(arranger.address)
    expect(staticData.unsubscribeGracePeriod).to.equal(UNSUBSCRIBE_GRACE_PERIOD)
    expect(staticData.conversionGracePeriod).to.equal(CONVERSION_GRACE_PERIOD)
    expect(staticData.repaymentGracePeriod).to.equal(REPAYMENT_GRACE_PERIOD)
    const dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.arrangerFee).to.equal(REL_ARRANGER_FEE)

    // check various loan terms
    let loanTerms = getLoanTermsTemplate()
    loanTerms.repaymentSchedule = []
    // revert on unauthorized sender
    await expect(loanProposal.connect(team).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // revert on zero min/max loan amount
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidMinOrMaxLoanAmount'
    )
    // set valid min loan amount
    loanTerms.minLoanAmount = ONE_USDC.mul(1000000)
    // revert if max loan amount still zero
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidMinOrMaxLoanAmount'
    )
    loanTerms.maxLoanAmount = loanTerms.minLoanAmount
    // revert if same min and max loan amount
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidMinOrMaxLoanAmount'
    )
    loanTerms.minLoanAmount = loanTerms.maxLoanAmount.add(1)
    // revert if min loan amount less than max loan amount
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidMinOrMaxLoanAmount'
    )

    // set valid min and max loan amounts
    loanTerms.minLoanAmount = ONE_USDC.mul(1000000)
    loanTerms.maxLoanAmount = ONE_USDC.mul(10000000)

    // revert on empty repayment schedule
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'EmptyRepaymentSchedule'
    )

    // define example repayment and conversion amounts
    const relLoanTokenDue1 = BASE.mul(5).div(100) // e.g., 5% of loan amount to be repaid in 1st period
    const relLoanTokenDue2 = BASE.add(relLoanTokenDue1) // e.g., 105% of loan amount to be repaid in 2nd period
    const relCollTokenDueIfConverted1 = ONE_WETH.div(2000000000) // e.g., can convert owed repayment amount at 1 WETH per 2000 USDC in 1st period
    const relCollTokenDueIfConverted2 = ONE_WETH.div(3000000000) // e.g., can convert owed repayment amount at 1 WETH per 3000 USDC in 2nd period

    // set first due date too close
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    let firstRepaymentScheduleEntry = getRepaymentScheduleEntry(
      relLoanTokenDue1,
      relCollTokenDueIfConverted1,
      ethers.BigNumber.from(timestamp)
    )
    let nextDueDate = firstRepaymentScheduleEntry.dueTimestamp.add(MIN_TIME_BETWEEN_DUE_DATES)
    let secondRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue2, relCollTokenDueIfConverted2, nextDueDate)
    let repaymentSchedule = [firstRepaymentScheduleEntry, secondRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule
    // revert on too close first due date
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )

    // set next due date too close
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    let firstDueDate = ethers.BigNumber.from(timestamp).add(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD).add(LOAN_EXECUTION_GRACE_PERIOD).add(MIN_TIME_UNTIL_FIRST_DUE_DATE).add(60) // +60s
    firstRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue1, relCollTokenDueIfConverted1, firstDueDate)
    nextDueDate = firstDueDate.add(MIN_TIME_BETWEEN_DUE_DATES).sub(1)
    secondRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue2, relCollTokenDueIfConverted2, nextDueDate)
    repaymentSchedule = [firstRepaymentScheduleEntry, secondRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule
    // revert on too close due timestamps
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidDueDates'
    )

    // set non ascending repayment schedule entries
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    firstRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue1, relCollTokenDueIfConverted1, firstDueDate)
    nextDueDate = firstDueDate.add(MIN_TIME_BETWEEN_DUE_DATES)
    secondRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue2, relCollTokenDueIfConverted2, nextDueDate)
    repaymentSchedule = [secondRepaymentScheduleEntry, firstRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule
    // revert if non-ascending due time stamps
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidDueDates'
    )

    // set 1st repayment value to zero
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    firstRepaymentScheduleEntry = getRepaymentScheduleEntry(0, relCollTokenDueIfConverted1, firstDueDate)
    nextDueDate = firstDueDate.add(MIN_TIME_BETWEEN_DUE_DATES)
    secondRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue2, relCollTokenDueIfConverted2, nextDueDate)
    repaymentSchedule = [firstRepaymentScheduleEntry, secondRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule
    // revert if repayment amount is zero
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'LoanTokenDueIsZero'
    )

    // set 2nd repayment value to zero
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    firstRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue1, relCollTokenDueIfConverted1, firstDueDate)
    nextDueDate = firstDueDate.add(MIN_TIME_BETWEEN_DUE_DATES)
    secondRepaymentScheduleEntry = getRepaymentScheduleEntry(0, relCollTokenDueIfConverted2, nextDueDate)
    repaymentSchedule = [firstRepaymentScheduleEntry, secondRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule
    // revert if conversion amount is zero
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'LoanTokenDueIsZero'
    )

    // set valid repayment schedule
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    firstRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue1, relCollTokenDueIfConverted1, firstDueDate)
    nextDueDate = firstDueDate.add(MIN_TIME_BETWEEN_DUE_DATES)
    secondRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue2, relCollTokenDueIfConverted2, nextDueDate)
    repaymentSchedule = [firstRepaymentScheduleEntry, secondRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule
    // now should pass
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
  })

  it('Should handle loan term subscriptions and acceptance correctly', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger, daoTreasury, usdc, lender0, lender1, lender2 } =
      await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    // revert if converting relative loan terms to absolute values would cause overflow
    await expect(loanProposal.getAbsoluteLoanTerms(loanTerms, MAX_UINT256, 6)).to.be.reverted

    // reverts if lender tries to subscribe to proposal without loan terms
    await usdc.connect(lender0).approve(fundingPool.address, MAX_UINT256)
    let bal = await usdc.balanceOf(lender0.address)
    await fundingPool.connect(lender0).deposit(bal, 0)
    await expect(fundingPool.connect(lender0).subscribe(loanProposal.address, bal)).to.be.revertedWithCustomError(
      fundingPool,
      'NotInSubscriptionPhase'
    )
    await fundingPool.connect(lender0).withdraw(bal)

    // check initial status without any proposed loan terms
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(0)
    // propose 1st loan terms
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    // check that status was updated
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(1)

    // check values correctly set
    let staticData = await loanProposal.staticData()
    expect(staticData.fundingPool).to.equal(fundingPool.address)
    expect(staticData.collToken).to.equal(daoToken.address)
    expect(dynamicData.arrangerFee).to.equal(REL_ARRANGER_FEE)

    // check loan terms correctly set
    const unfinalizedLoanTerms = await loanProposal.loanTerms()
    for (var i = 0; i < unfinalizedLoanTerms.repaymentSchedule.length; i++) {
      expect(unfinalizedLoanTerms.repaymentSchedule[i].loanTokenDue).to.equal(loanTerms.repaymentSchedule[i].loanTokenDue)
      expect(unfinalizedLoanTerms.repaymentSchedule[i].collTokenDueIfConverted).to.equal(
        loanTerms.repaymentSchedule[i].collTokenDueIfConverted
      )
      expect(unfinalizedLoanTerms.repaymentSchedule[i].dueTimestamp).to.equal(loanTerms.repaymentSchedule[i].dueTimestamp)
    }
    // reverts if trying to accept while terms are in cool off period
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(
      loanProposal,
      'WaitForLoanTermsCoolOffPeriod'
    )

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // reverts if too few subscriptions
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(
      loanProposal,
      'TotalSubscribedTooLow'
    )

    // lender can deposit
    await usdc.connect(lender1).approve(fundingPool.address, MAX_UINT256)
    let preBalLender = await usdc.balanceOf(lender1.address)
    let addAmount = preBalLender
    await expect(fundingPool.connect(lender1).deposit(addAmount.add(1), 0)).to.be.reverted
    await expect(fundingPool.connect(lender1).deposit(addAmount, 10)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidSendAmount'
    )
    await fundingPool.connect(lender1).deposit(addAmount, 0)
    expect(await fundingPool.balanceOf(lender1.address)).to.be.equal(await usdc.balanceOf(fundingPool.address))
    expect(await fundingPool.balanceOf(lender1.address)).to.be.equal(addAmount)

    // lender can withdraw
    preBalLender = await usdc.balanceOf(lender1.address)
    let preBalPool = await usdc.balanceOf(fundingPool.address)
    await expect(fundingPool.connect(lender1).withdraw(addAmount.add(1))).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidWithdrawAmount'
    )
    let withdrawAmount = addAmount.div(10)
    await fundingPool.connect(lender1).withdraw(withdrawAmount)
    let postBalLender = await usdc.balanceOf(lender1.address)
    let postBalPool = await usdc.balanceOf(fundingPool.address)
    expect(withdrawAmount).to.be.equal(postBalLender.sub(preBalLender))
    expect(withdrawAmount).to.be.equal(preBalPool.sub(postBalPool))
    await fundingPool.connect(lender1).withdraw(await fundingPool.balanceOf(lender1.address))

    // other lender deposits
    expect(await usdc.balanceOf(fundingPool.address)).to.be.equal(0)
    await usdc.connect(lender2).approve(fundingPool.address, MAX_UINT256)
    let deposit1 = ONE_USDC.mul(500000)
    await fundingPool.connect(lender2).deposit(deposit1, 0)
    let deposit2 = ONE_USDC.mul(500000)
    await fundingPool.connect(lender2).deposit(deposit2, 0)
    let totalDeposited = deposit1.add(deposit2)
    let poolBal = await usdc.balanceOf(fundingPool.address)
    expect(poolBal).to.be.equal(totalDeposited)

    // lender subscribes
    await expect(fundingPool.connect(lender2).subscribe(lender2.address, ONE_USDC.mul(80000))).to.be.revertedWithCustomError(
      fundingPool,
      'UnregisteredLoanProposal'
    )
    // users without or too low balance can't subscribe
    let subscriptionAmount = ONE_USDC.mul(80000)
    await expect(
      fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionAmount)
    ).to.be.revertedWithCustomError(fundingPool, 'InsufficientBalance')
    let depositedBalance = await fundingPool.balanceOf(lender2.address)
    await expect(
      fundingPool.connect(lender1).subscribe(loanProposal.address, depositedBalance.add(1))
    ).to.be.revertedWithCustomError(fundingPool, 'InsufficientBalance')

    // check valid subscribe works
    await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionAmount)

    // revert when trying to propose new loan terms with max loan amount smaller than prospective loan amount based on current subscriptions
    const prevMaxLoanAmount = loanTerms.maxLoanAmount
    const currTotalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    const loanTokenDecimals = await usdc.decimals()
    let [, , prospectiveFinalLoanAmount, ,] = await loanProposal.getAbsoluteLoanTerms(
      loanTerms,
      currTotalSubscribed,
      loanTokenDecimals
    )
    loanTerms.maxLoanAmount = prospectiveFinalLoanAmount.sub(1)
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'NewMaxLoanAmountBelowCurrentSubscriptions'
    )
    loanTerms.maxLoanAmount = prevMaxLoanAmount

    // revert when unsubscribing during cool down period
    await expect(
      fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount)
    ).to.be.revertedWithCustomError(fundingPool, 'BeforeEarliestUnsubscribe')
    // move forward past subscription cool down period to check unsubscribe method
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + 60])
    let preBal = await fundingPool.balanceOf(lender2.address)
    let preSubscribedBal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
    await expect(
      fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount.add(1))
    ).to.be.revertedWithCustomError(fundingPool, 'UnsubscriptionAmountTooLarge')

    // reverts when trying unsubscribe from invalid / unknown loan proposal address
    await expect(fundingPool.connect(lender2).unsubscribe(ADDRESS_ZERO, subscriptionAmount)).to.be.revertedWithCustomError(
      fundingPool,
      'UnregisteredLoanProposal'
    )

    // check valid unsubscribe works
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount)
    let postBal = await fundingPool.balanceOf(lender2.address)
    let postSubscribedBal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
    expect(preSubscribedBal.sub(postSubscribedBal)).to.be.equal(postBal.sub(preBal))
    // subscribe again
    await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionAmount)

    // check subscriptions don't change pool balance, only shift regular balance and subscription balance
    let remainingDepositBalance = await fundingPool.balanceOf(lender2.address)
    expect(remainingDepositBalance).to.be.equal(totalDeposited.sub(subscriptionAmount))
    expect(await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)).to.be.equal(subscriptionAmount)
    expect(await usdc.balanceOf(fundingPool.address)).to.be.equal(poolBal)
    await expect(
      fundingPool.connect(lender2).subscribe(loanProposal.address, remainingDepositBalance)
    ).to.be.revertedWithCustomError(fundingPool, 'SubscriptionAmountTooHigh')

    // reverts if trying to finalize loan terms prior to acceptance
    await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // reverts if users tries to rollback prior to borrower acceptance
    await expect(loanProposal.connect(daoTreasury).rollback()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // reverts if unauthorized user tries to accept loan terms
    await expect(loanProposal.connect(lender1).acceptLoanTerms()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )
    // check status didn't change
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(1)

    // test that dao treasury can accept loan terms and move forward
    let tx = await loanProposal.connect(daoTreasury).acceptLoanTerms()
    let receipt = await tx.wait()
    timestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp
    // check loanTermsLockedTime and status were updated
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.loanTermsLockedTime).to.be.equal(timestamp)
    expect(dynamicData.status).to.be.equal(2)

    // revert if arranger tries to propose new loan terms if already accepted
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )
    // reverts if trying to 'double accept'
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // reverts if trying to finalize loan terms during lender unsubscribe grace period
    await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // move forward post lender unsubscribe grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    let lenderUnsubscribeGracePeriod = staticData.unsubscribeGracePeriod
    await ethers.provider.send('evm_mine', [timestamp + Number(lenderUnsubscribeGracePeriod.toString())])

    // unsubscribe when not in unsubscription phase
    await expect(
      fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount)
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')

    // reverts if unauthorized sender tries to finalize loan terms and convert relative to absolute terms
    await expect(loanProposal.connect(lender1).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let [, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)

    // reverts if non-borrower tries to rollback during unsubscribe grace period
    await expect(loanProposal.connect(lender1).rollback()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidRollBackRequest'
    )

    // dao treasury approves and finalizes and transfers coll amounts
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    let daoTreasuryBalPre = await daoToken.balanceOf(daoTreasury.address)
    let loanProposalBalPre = await daoToken.balanceOf(loanProposal.address)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)
    let daoTreasuryBalPost = await daoToken.balanceOf(daoTreasury.address)
    let loanProposalBalPost = await daoToken.balanceOf(loanProposal.address)
    expect(loanProposalBalPost.sub(loanProposalBalPre)).to.be.equal(daoTreasuryBalPre.sub(daoTreasuryBalPost))
    // check updated loan proposal status
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(3)
  })

  it('Should revert on invalid loan acceptance', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward in time but "too close" to first due date
    let firstDueDate = loanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [Number(firstDueDate.sub(MIN_TIME_UNTIL_FIRST_DUE_DATE).toString())])

    // reverts if trying to accept loan terms where first due date is "too close"
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )

    // move forward past first due date
    await ethers.provider.send('evm_mine', [Number(firstDueDate.toString()) + 1])

    // reverts if trying to accept loan terms where first due already passed
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )
  })

  it('Should handle rollbacks correctly (1/3)', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3 } =
      await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    // check status updated correctly
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(1)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()
    // check status updated correctly
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(2)

    // check that dao can rollback
    await loanProposal.connect(daoTreasury).rollback()
    // check status updated correctly
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(4)

    // move forward beyond minimum subscription holding period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + 60])

    // check users can unsubscribe any time
    // lender 1
    let subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address)
    await fundingPool.connect(lender1).unsubscribe(loanProposal.address, subscriptionBalOf)
    let balOf = await fundingPool.balanceOf(lender1.address)
    await fundingPool.connect(lender1).withdraw(balOf)
    // lender 2
    subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionBalOf)
    balOf = await fundingPool.balanceOf(lender2.address)
    await fundingPool.connect(lender2).withdraw(balOf)
    // lender 3
    subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender3.address)
    await fundingPool.connect(lender3).unsubscribe(loanProposal.address, subscriptionBalOf)
    balOf = await fundingPool.balanceOf(lender3.address)
    await fundingPool.connect(lender3).withdraw(balOf)
  })

  it('Should handle rollbacks correctly (2/3)', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(2)

    // move forward beyond minimum subscription holding period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + 60])

    // lenders unsubscribe such that subscription amount lower than minLoanAmount
    let subscriptionRemainder = 1
    let subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address)
    await fundingPool
      .connect(lender1)
      .unsubscribe(loanProposal.address, (await subscriptionBalOf).sub(subscriptionRemainder))
    // test scenario where lender1 also withdraws unsubscribed amount
    await fundingPool.connect(lender1).withdraw(subscriptionBalOf.sub(subscriptionRemainder))
    subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
    await fundingPool
      .connect(lender2)
      .unsubscribe(loanProposal.address, (await subscriptionBalOf).sub(subscriptionRemainder))
    subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender3.address)
    await fundingPool
      .connect(lender3)
      .unsubscribe(loanProposal.address, (await subscriptionBalOf).sub(subscriptionRemainder))

    // move forward past unsubscription grace period
    let staticData = await loanProposal.staticData()
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // check that anyone can rollback if target loan amount not reached
    await loanProposal.connect(anyUser).rollback()
    // check status updated correctly
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(4)

    // check that lenders can unsubscribe and withdraw remaining amounts
    await fundingPool.connect(lender1).unsubscribe(loanProposal.address, subscriptionRemainder)
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionRemainder)
    await fundingPool.connect(lender3).unsubscribe(loanProposal.address, subscriptionRemainder)
    let bal = await fundingPool.balanceOf(lender1.address)
    await fundingPool.connect(lender1).withdraw(bal)
    bal = await fundingPool.balanceOf(lender2.address)
    await fundingPool.connect(lender2).withdraw(bal)
    bal = await fundingPool.balanceOf(lender3.address)
    await fundingPool.connect(lender3).withdraw(bal)
  })

  it('Should handle rollbacks correctly (3/3)', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // borrower accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(2)

    // move forward past loan execution grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [
      timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString()) + Number(MIN_LOAN_EXECUTION_GRACE_PERIOD.toString())
    ])

    // if borrower doesn't execute the loan proposal then lenders can't unsubscribe
    await expect(
      fundingPool
        .connect(lender1)
        .unsubscribe(loanProposal.address, await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address))
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')
    await expect(
      fundingPool
        .connect(lender2)
        .unsubscribe(loanProposal.address, await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address))
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')
    await expect(
      fundingPool
        .connect(lender3)
        .unsubscribe(loanProposal.address, await fundingPool.subscribedBalanceOf(loanProposal.address, lender3.address))
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')

    // check that anyone can rollback if borrower didn't execute within loan execution grace period
    await loanProposal.connect(anyUser).rollback()
    // check status updated correctly
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(4)

    // check that borrowers can then unsubscribe again
    await fundingPool
      .connect(lender1)
      .unsubscribe(loanProposal.address, await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address))
    await fundingPool
      .connect(lender2)
      .unsubscribe(loanProposal.address, await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address))
    await fundingPool
      .connect(lender3)
      .unsubscribe(loanProposal.address, await fundingPool.subscribedBalanceOf(loanProposal.address, lender3.address))
    let bal = await fundingPool.balanceOf(lender1.address)
    await fundingPool.connect(lender1).withdraw(bal)
    bal = await fundingPool.balanceOf(lender2.address)
    await fundingPool.connect(lender2).withdraw(bal)
    bal = await fundingPool.balanceOf(lender3.address)
    await fundingPool.connect(lender3).withdraw(bal)
  })

  it('Should not allow unauthorized updating of status', async function () {
    const { fundingPool, loanProposalFactory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )
  })

  it('Should handle loan execution correctly (1/3)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + 60])
    let staticData = await loanProposal.staticData()
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // revert when trying to execute loan proposal with unregistered / unknown loan proposal address
    await expect(fundingPool.connect(daoTreasury).executeLoanProposal(team.address)).to.be.revertedWithCustomError(
      fundingPool,
      'UnregisteredLoanProposal'
    )
    
    // revert when trying to execute loan proposal before being ready to execute
    await expect(fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [
      finalLoanTerms,
      arrangerFee,
      finalLoanAmount,
      finalCollAmountReservedForDefault,
      finalCollAmountReservedForConversions
    ] = await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao treasury executes loan proposal
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    let preDaoTreasuryBal = await daoToken.balanceOf(daoTreasury.address)
    let preLoanProposalBal = await daoToken.balanceOf(loanProposal.address)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)
    let postDaoTreasuryBal = await daoToken.balanceOf(daoTreasury.address)
    let postLoanProposalBal = await daoToken.balanceOf(loanProposal.address)
    expect(preDaoTreasuryBal.sub(postDaoTreasuryBal)).to.be.equal(postLoanProposalBal.sub(preLoanProposalBal))
    expect(preDaoTreasuryBal.sub(postDaoTreasuryBal)).to.be.equal(finalCollTransferAmount)

    // check final loan terms stored on contract after execution match up expected value
    const finalLoanTermsCheck = await loanProposal.loanTerms()
    expect(finalLoanTermsCheck).to.deep.equal(finalLoanTerms)

    // revert when trying to execute invalid loan proposal
    await expect(fundingPool.connect(daoTreasury).executeLoanProposal(anyUser.address)).to.be.revertedWithCustomError(
      fundingPool,
      'UnregisteredLoanProposal'
    )

    // execute loan and check balance diffs
    // dao token balances
    let preDaoTokenLoanProposalBal = await daoToken.balanceOf(loanProposal.address)
    let preDaoTokenDaoBal = await daoToken.balanceOf(daoTreasury.address)
    // usdc balances
    let preUsdcLoanProposalBal = await usdc.balanceOf(loanProposal.address)
    let preUsdcFundingPoolBal = await usdc.balanceOf(fundingPool.address)
    let preUsdcDaoBal = await usdc.balanceOf(daoTreasury.address)
    let preUsdcArrangerBal = await usdc.balanceOf(arranger.address)
    let preUsdcTeamBal = await usdc.balanceOf(team.address)
    await fundingPool.connect(anyUser).executeLoanProposal(loanProposal.address)
    // dao token balances
    let postDaoTokenLoanProposalBal = await daoToken.balanceOf(loanProposal.address)
    let postDaoTokenDaoBal = await daoToken.balanceOf(daoTreasury.address)
    // usdc balances
    let postUsdcLoanProposalBal = await usdc.balanceOf(loanProposal.address)
    let postUsdcFundingPoolBal = await usdc.balanceOf(fundingPool.address)
    let postUsdcDaoBal = await usdc.balanceOf(daoTreasury.address)
    let postUsdcArrangerBal = await usdc.balanceOf(arranger.address)
    let postUsdcTeamBal = await usdc.balanceOf(team.address)
    // check dao token balances remain unchanged
    expect(postDaoTokenLoanProposalBal.sub(preDaoTokenLoanProposalBal)).to.be.equal(0)
    expect(postDaoTokenDaoBal.sub(preDaoTokenDaoBal)).to.be.equal(0)
    // check usdc balance changes
    expect(postUsdcLoanProposalBal.sub(preUsdcLoanProposalBal)).to.be.equal(0)
    expect(preUsdcFundingPoolBal.sub(postUsdcFundingPoolBal)).to.be.equal(finalLoanAmount.add(arrangerFee))
    expect(postUsdcDaoBal.sub(preUsdcDaoBal)).to.be.equal(finalLoanAmount)
    expect(postUsdcArrangerBal.sub(preUsdcArrangerBal).add(postUsdcTeamBal.sub(preUsdcTeamBal))).to.be.equal(arrangerFee)
  })

  it('Should handle loan execution correctly (2/3)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + 60])

    // have all lenders unsubscribe
    let bal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address)
    await fundingPool.connect(lender1).unsubscribe(loanProposal.address, bal)
    bal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, bal)
    bal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender3.address)
    await fundingPool.connect(lender3).unsubscribe(loanProposal.address, bal)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // reverts if trying to finalize and subscriptions below min loan
    await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'TotalSubscribedNotTargetInRange'
    )
  })

  it('Should handle loan execution correctly (3/3)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward in time but "too close" to first due date
    let firstDueDate = loanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [Number(firstDueDate.sub(MIN_TIME_UNTIL_FIRST_DUE_DATE).toString())])

    // reverts if trying to finalize if "too close" to first due date
    await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )

    // move forward past first due date
    await ethers.provider.send('evm_mine', [Number(firstDueDate.toString()) + 1])

    // reverts if trying to finalize loan terms where first due already passed
    await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )
  })

  it('Should handle conversions correctly (1/3)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // revert if lender tries to convert before loan is deployed
    await expect(loanProposal.connect(lender1).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // revert if non-lender tries to convert
    await expect(loanProposal.connect(anyUser).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // revert if lender tries to convert before due date
    await expect(loanProposal.connect(lender1).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'OutsideConversionTimeWindow'
    )

    // move forward to first due date
    let firstDueDate = finalLoanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [firstDueDate])

    // revert if non-lender tries to convert
    await expect(loanProposal.connect(anyUser).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // lender converts
    let subscribedBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address)
    totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let totalConvertible = finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted
    let expectedConversionAmount = totalConvertible.mul(subscribedBalOf).div(totalSubscribed)
    let preBalLender = await daoToken.balanceOf(lender1.address)
    let preBalLoanProp = await daoToken.balanceOf(loanProposal.address)
    await loanProposal.connect(lender1).exerciseConversion()
    let postBalLender = await daoToken.balanceOf(lender1.address)
    let postBalLoanProp = await daoToken.balanceOf(loanProposal.address)
    // check bal diffs
    expect(postBalLender.sub(preBalLender)).to.be.equal(preBalLoanProp.sub(postBalLoanProp))
    expect(postBalLender.sub(preBalLender)).to.be.equal(expectedConversionAmount)

    // revert if lender tries to convert for same period twice
    await expect(loanProposal.connect(lender1).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyConverted'
    )

    // move forward past conversion period
    let conversionCutoffTime = firstDueDate + Number(CONVERSION_GRACE_PERIOD.toString())
    await ethers.provider.send('evm_mine', [conversionCutoffTime])

    // revert if lender tries to convert after conversion time window has passed
    await expect(loanProposal.connect(lender2).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'OutsideConversionTimeWindow'
    )
  })

  it('Should handle conversions correctly (2/3)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to first due date
    let firstDueDate = finalLoanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [firstDueDate])

    // all lenders convert
    // check balances
    let totalConvertible = finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted
    let preBalLoanProp = await daoToken.balanceOf(loanProposal.address)
    await loanProposal.connect(lender1).exerciseConversion()
    await loanProposal.connect(lender2).exerciseConversion()
    await loanProposal.connect(lender3).exerciseConversion()
    let postBalLoanProp = await daoToken.balanceOf(loanProposal.address)
    expect(preBalLoanProp.sub(postBalLoanProp)).to.be.equal(totalConvertible)
  })

  it('Should handle conversions correctly (3/3)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // define subscription amounts
    const subscriptionLender1 = ONE_USDC.mul(1000000)
    const subscriptionLender2 = ethers.BigNumber.from("1")

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    loanTerms.maxLoanAmount = subscriptionLender1.add(subscriptionLender2)
    loanTerms.repaymentSchedule[0].collTokenDueIfConverted = 1
    loanTerms.repaymentSchedule[1].collTokenDueIfConverted = 1
    loanTerms.repaymentSchedule[2].collTokenDueIfConverted = 1
    loanTerms.repaymentSchedule[3].collTokenDueIfConverted = 1
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add large lender
    await usdc.mint(lender1.address, subscriptionLender1)
    await usdc.connect(lender1).approve(fundingPool.address, subscriptionLender1)
    await fundingPool.connect(lender1).deposit(subscriptionLender1, 0)
    await fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionLender1)
  
    // add smaller lender
    await usdc.connect(lender2).approve(fundingPool.address, subscriptionLender2)
    await fundingPool.connect(lender2).deposit(subscriptionLender2, 0)
    await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionLender2)
    
    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to first due date
    let firstDueDate = finalLoanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [firstDueDate])

    // check conversion reverts if it would lead to zero value
    let expConversionAmount = finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted.mul(subscriptionLender2).div(totalSubscribed)
    expect(expConversionAmount).to.be.equal(0)
    await expect(loanProposal.connect(lender2).exerciseConversion())
    .to.be.revertedWithCustomError(
      loanProposal,
      'ZeroConversionAmount'
    )
  })

  it('Should handle repayments correctly (1/4)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // check current repayment idx is zero
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.currentRepaymentIdx).to.be.equal(0)

    // reverts if borrower tries to repay before loan is deployed
    await expect(loanProposal.connect(daoTreasury).repay(0)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to first due date
    let firstDueDate = finalLoanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [firstDueDate])

    // reverts if borrower tries to repay during conversion period
    await expect(loanProposal.connect(daoTreasury).repay(0)).to.be.revertedWithCustomError(
      loanProposal,
      'OutsideRepaymentTimeWindow'
    )

    // lender converts
    await loanProposal.connect(lender1).exerciseConversion()

    // move forward to repayment window
    let earliestRepaymentTime = finalLoanTerms.repaymentSchedule[0].dueTimestamp + Number(CONVERSION_GRACE_PERIOD.toString())
    await ethers.provider.send('evm_mine', [earliestRepaymentTime])

    // reverts if non-borrower tries to repay
    await expect(loanProposal.connect(anyUser).repay(0)).to.be.revertedWithCustomError(loanProposal, 'InvalidSender')

    // revert if lender tries to claim repayment before actual repay
    await expect(loanProposal.connect(lender1).claimRepayment(0)).to.be.revertedWithCustomError(
      loanProposal,
      'RepaymentIdxTooLarge'
    )

    // check current repayment idx is still zero
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.currentRepaymentIdx).to.be.equal(0)

    // approve and repay
    let totalConvertedSubscriptionsOfPeriod = await loanProposal.totalConvertedSubscriptionsPerIdx(0)
    let originalRepaymentAmountDue = finalLoanTerms.repaymentSchedule[0].loanTokenDue
    let obsoleteRepaymentAmountDue = originalRepaymentAmountDue.mul(totalConvertedSubscriptionsOfPeriod).div(totalSubscribed)
    let leftRepaymentAmountDue = originalRepaymentAmountDue.sub(obsoleteRepaymentAmountDue)
    await usdc.connect(daoTreasury).approve(loanProposal.address, leftRepaymentAmountDue)
    // mint tokens
    await usdc.mint(daoTreasury.address, leftRepaymentAmountDue)
    // usdc bal checks
    let preUsdcDaoBal = await usdc.balanceOf(daoTreasury.address)
    let preUsdcLoanProposalBal = await usdc.balanceOf(loanProposal.address)
    // dao token bal checks
    let preDaoTokenDaoBal = await daoToken.balanceOf(daoTreasury.address)
    let preDaoTokenLoanProposalBal = await daoToken.balanceOf(loanProposal.address)
    // check curr repayment idx
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.currentRepaymentIdx).to.be.equal(0)
    // repay
    await loanProposal.connect(daoTreasury).repay(0)
    // check repayment idx was updated
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.currentRepaymentIdx).to.be.equal(1)
    let postUsdcDaoBal = await usdc.balanceOf(daoTreasury.address)
    let postUsdcLoanProposalBal = await usdc.balanceOf(loanProposal.address)
    let postDaoTokenDaoBal = await daoToken.balanceOf(daoTreasury.address)
    let postDaoTokenLoanProposalBal = await daoToken.balanceOf(loanProposal.address)
    // check usdc sent to loanproposal contract matches amount sent from borrower
    expect(postUsdcLoanProposalBal.sub(preUsdcLoanProposalBal)).to.be.equal(preUsdcDaoBal.sub(postUsdcDaoBal))
    // check amount matches expected left repayment amount
    expect(postUsdcLoanProposalBal.sub(preUsdcLoanProposalBal)).to.be.equal(leftRepaymentAmountDue)
    let collTokenReservedIfAllConverted = finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted
    let collTokenConverted = await loanProposal.collTokenConverted(0)
    let expectedReclaimedCollToken = collTokenReservedIfAllConverted.sub(collTokenConverted)
    expect(postDaoTokenDaoBal.sub(preDaoTokenDaoBal)).to.be.equal(expectedReclaimedCollToken)
    expect(postDaoTokenDaoBal.sub(preDaoTokenDaoBal)).to.be.equal(
      preDaoTokenLoanProposalBal.sub(postDaoTokenLoanProposalBal)
    )

    // check current repayment idx was updated
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.currentRepaymentIdx).to.be.equal(1)

    // revert if unentitled user tries to claim repayment
    await expect(loanProposal.connect(anyUser).claimRepayment(0)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // revert if lender that previously converted tries to also claim repayment
    await expect(loanProposal.connect(lender1).claimRepayment(0)).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyClaimed'
    )

    // valid claim
    let subscriptionBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
    let preBal = await usdc.balanceOf(lender2.address)
    await loanProposal.connect(lender2).claimRepayment(0)
    let postBal = await usdc.balanceOf(lender2.address)

    // check bal diff matches expected repayment claim
    let remainingEntitledSubscriptions = totalSubscribed.sub(totalConvertedSubscriptionsOfPeriod)
    let expectedRepaymentClaim = leftRepaymentAmountDue.mul(subscriptionBalOf).div(remainingEntitledSubscriptions)
    expect(postBal.sub(preBal)).to.be.equal(expectedRepaymentClaim)

    // revert if lender tries to claim twice
    await expect(loanProposal.connect(lender2).claimRepayment(0)).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyClaimed'
    )
  })

  it('Should handle repayments correctly (2/4)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to first due date
    let firstDueDate = finalLoanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [firstDueDate])

    // all lenders convert
    await loanProposal.connect(lender1).exerciseConversion()
    await loanProposal.connect(lender2).exerciseConversion()
    await loanProposal.connect(lender3).exerciseConversion()

    // move forward to repayment window
    let earliestRepaymentTime = finalLoanTerms.repaymentSchedule[0].dueTimestamp + Number(CONVERSION_GRACE_PERIOD.toString())
    await ethers.provider.send('evm_mine', [earliestRepaymentTime])

    // if all lenders converted, effective repayment amount due is 0, but borrower still needs to trigger call to not default
    // bal check
    let preUsdcDaoBal = await usdc.balanceOf(daoTreasury.address)
    let preDaoTokenDaoBal = await daoToken.balanceOf(daoTreasury.address)
    await loanProposal.connect(daoTreasury).repay(0)
    let postUsdDaoBal = await usdc.balanceOf(daoTreasury.address)
    let postDaoTokenDaoBal = await daoToken.balanceOf(daoTreasury.address)
    // check no usdc bal diff
    expect(preUsdcDaoBal).to.be.equal(postUsdDaoBal)
    // check no dao token bal diff as all what was reserved got converted
    expect(preDaoTokenDaoBal).to.be.equal(postDaoTokenDaoBal)
  })

  it('Should handle repayments correctly (3/4)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to first due date
    let firstDueDate = finalLoanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [firstDueDate])

    // reverts if borrower tries to repay during conversion period
    await expect(loanProposal.connect(daoTreasury).repay(0)).to.be.revertedWithCustomError(
      loanProposal,
      'OutsideRepaymentTimeWindow'
    )

    // lender converts
    await loanProposal.connect(lender1).exerciseConversion()

    // move forward past repayment window
    let repaymentCutoffTime =
      finalLoanTerms.repaymentSchedule[0].dueTimestamp +
      Number(CONVERSION_GRACE_PERIOD.toString()) +
      Number(REPAYMENT_GRACE_PERIOD.toString())
    await ethers.provider.send('evm_mine', [repaymentCutoffTime])

    // reverts if borrower tries to repay after repayment window
    await expect(loanProposal.connect(daoTreasury).repay(0)).to.be.revertedWithCustomError(
      loanProposal,
      'OutsideRepaymentTimeWindow'
    )
  })

  it('Should handle repayments correctly (4/4)', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // check pre balance
    let preLoanPropBal = await daoToken.balanceOf(loanProposal.address)
    let preDaoBal = await daoToken.balanceOf(daoTreasury.address)

    // consecutively make all repayments
    for (let i = 0; i < finalLoanTerms.repaymentSchedule.length; i++) {
      // revert if any user tries to mark loan as defaulted
      await expect(loanProposal.markAsDefaulted()).to.be.revertedWithCustomError(loanProposal, 'NoDefault')

      // move forward to next repayment date
      let repaymentDate = finalLoanTerms.repaymentSchedule[i].dueTimestamp + Number(CONVERSION_GRACE_PERIOD.toString())
      await ethers.provider.send('evm_mine', [repaymentDate])

      // determine due repayment amount
      let repaymentAmountDue = finalLoanTerms.repaymentSchedule[i].loanTokenDue
      // mint and approve
      await usdc.mint(daoTreasury.address, repaymentAmountDue)
      await usdc.connect(daoTreasury).approve(loanProposal.address, repaymentAmountDue)
      // repay
      await loanProposal.connect(daoTreasury).repay(0)
    }

    // revert if any user tries to mark loan as defaulted
    await expect(loanProposal.markAsDefaulted()).to.be.revertedWithCustomError(loanProposal, 'LoanIsFullyRepaid')

    // check post balance
    let postLoanPropBal = await daoToken.balanceOf(loanProposal.address)
    let postDaoBal = await daoToken.balanceOf(daoTreasury.address)

    // check that after final repayment all collateral was returned to borrower (assuming no conversions)
    expect(postLoanPropBal).to.be.equal(0)
    expect(postDaoBal.sub(preDaoBal)).to.be.equal(preLoanPropBal)
  })

  it('Should handle default claims correctly', async function () {
    const {
      fundingPool,
      loanProposalFactory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender1,
      lender2,
      lender3,
      anyUser,
      team
    } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      loanProposalFactory,
      arranger,
      fundingPool.address,
      daoToken.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndupdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // revert if any user tries to mark as defaulted before loan is deployed
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // revert if any user tries to mark as defaulted before loan is deployed
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms()

    // revert if any user tries to mark as defaulted before loan is deployed
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // revert if any user tries to mark as defaulted before loan is deployed
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // revert if user tries to claim default proceed and not marked as defaulted
    await expect(loanProposal.connect(lender1).claimDefaultProceeds()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // revert if any user tries to mark as defaulted before loan is deployed
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(loanProposal, 'NoDefault')

    // move forward to repayment cutoff time
    let repaymentCutoffTime =
      finalLoanTerms.repaymentSchedule[0].dueTimestamp +
      Number(CONVERSION_GRACE_PERIOD.toString()) +
      Number(REPAYMENT_GRACE_PERIOD.toString())
    await ethers.provider.send('evm_mine', [repaymentCutoffTime])

    // revert if user tries to claim default proceed and not marked as defaulted
    await expect(loanProposal.connect(lender1).claimDefaultProceeds()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // anyone can mark as defaulted
    await loanProposal.connect(anyUser).markAsDefaulted()

    // revert if trying to mark as defaulted again
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidActionForCurrentStatus'
    )

    // revert if unentiled user tries to claim default proceeds
    await expect(loanProposal.connect(anyUser).claimDefaultProceeds()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // claim default proceeds
    let totalBal = await daoToken.balanceOf(loanProposal.address)
    let subscribedBalOf = await fundingPool.subscribedBalanceOf(loanProposal.address, lender1.address)
    let expectedDefaultProceeds = totalBal.mul(subscribedBalOf).div(totalSubscribed)
    let preLenderBal = await daoToken.balanceOf(lender1.address)
    let preLoanPropBal = await daoToken.balanceOf(loanProposal.address)
    await loanProposal.connect(lender1).claimDefaultProceeds()
    let postLenderBal = await daoToken.balanceOf(lender1.address)
    let postLoanPropBal = await daoToken.balanceOf(loanProposal.address)
    expect(postLenderBal.sub(preLenderBal)).to.be.equal(expectedDefaultProceeds)
    expect(preLoanPropBal.sub(postLoanPropBal)).to.be.equal(postLenderBal.sub(preLenderBal))

    // revert if lenders tries to claim twice
    await expect(loanProposal.connect(lender1).claimDefaultProceeds()).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyClaimed'
    )
  })
})
