import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  getLoanTermsTemplate,
  getRepaymentScheduleEntry,
  createLoanProposal,
  getDummyLoanTerms,
  addSubscriptionsToLoanProposal,
  whitelistLender
} from './helpers/misc'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG } from '../../hardhat.config'

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
const MAX_ARRANGER_FEE = BASE.mul(5).div(10) // 50%
const MIN_UNSUBSCRIBE_GRACE_PERIOD = ONE_DAY
const MAX_UNSUBSCRIBE_GRACE_PERIOD = ONE_DAY.mul(14)
const LOAN_TERMS_UPDATE_COOL_OFF_PERIOD = 60 * 60 // 1h
const MIN_TIME_BETWEEN_DUE_DATES = ONE_DAY.mul(7)
const MIN_CONVERSION_GRACE_PERIOD = ONE_DAY
const MIN_REPAYMENT_GRACE_PERIOD = ONE_DAY
const MIN_LOAN_EXECUTION_GRACE_PERIOD = ONE_DAY
const MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD = ONE_DAY.mul(30)
const MIN_TIME_UNTIL_FIRST_DUE_DATE = ONE_DAY
const LOAN_EXECUTION_GRACE_PERIOD = ONE_DAY
const MIN_WAIT_UNTIL_EARLIEST_UNSUBSCRIBE = 60 // 60s

// test loan proposal constants
const UNSUBSCRIBE_GRACE_PERIOD = MIN_UNSUBSCRIBE_GRACE_PERIOD
const CONVERSION_GRACE_PERIOD = MIN_CONVERSION_GRACE_PERIOD
const REPAYMENT_GRACE_PERIOD = MIN_REPAYMENT_GRACE_PERIOD
const REL_ARRANGER_FEE = BASE.mul(50).div(10000)

describe('Peer-to-Pool: Local Tests', function () {
  before(async () => {
    console.log('Note: Running local tests with the following hardhat chain id config:')
    console.log(HARDHAT_CHAIN_ID_AND_FORKING_CONFIG)
    if (HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId !== 31337) {
      throw new Error(
        `Invalid hardhat forking config! Expected 'HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId' to be 31337 but it is '${HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId}'!`
      )
    }
  })

  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  async function setupTest() {
    const [lender0, lender1, lender2, lender3, arranger, daoTreasury, team, whitelistAuthority, anyUser] =
      await ethers.getSigners()

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

    const FundingPoolImpl = await ethers.getContractFactory('FundingPoolImpl')
    const fundingPoolImpl = await FundingPoolImpl.deploy()
    await fundingPoolImpl.deployed()

    const Factory = await ethers.getContractFactory('Factory')

    // reverts if trying to initialize base contract
    await expect(Factory.connect(team).deploy(ADDRESS_ZERO, fundingPoolImpl.address)).to.be.revertedWithCustomError(
      Factory,
      'InvalidAddress'
    )
    await expect(Factory.connect(team).deploy(loanProposalImpl.address, ADDRESS_ZERO)).to.be.revertedWithCustomError(
      Factory,
      'InvalidAddress'
    )
    const factory = await Factory.connect(team).deploy(loanProposalImpl.address, fundingPoolImpl.address)
    await factory.deployed()
    await expect(factory.connect(lender1).setProtocolFee(BASE.mul(20).div(100))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
    await expect(factory.connect(team).setProtocolFee(BASE.mul(80).div(100))).to.be.revertedWithCustomError(
      factory,
      'InvalidFee'
    )
    const newFee = BASE.mul(5).div(100)
    await factory.connect(team).setProtocolFee(newFee)
    await expect(factory.connect(team).setProtocolFee(newFee)).to.be.revertedWithCustomError(factory, 'InvalidFee')

    // create a deposit pool
    await factory.createFundingPool(usdc.address)
    const fundingPoolAddr = await factory.fundingPools(0)
    const fundingPool = await FundingPoolImpl.attach(fundingPoolAddr)

    // reverts if trying to create deposit pool for zero address
    await expect(factory.createFundingPool(ADDRESS_ZERO)).to.be.revertedWithCustomError(factory, 'InvalidAddress')

    // reverts if trying to create deposit pool for the same token again
    await expect(factory.createFundingPool(usdc.address)).to.be.revertedWithCustomError(factory, 'FundingPoolAlreadyExists')

    // reverts if trying to initialize base contract
    await expect(
      loanProposalImpl.initialize(
        factory.address,
        arranger.address,
        fundingPool.address,
        daoToken.address,
        ADDRESS_ZERO,
        1,
        ONE_DAY,
        ONE_DAY,
        ONE_DAY
      )
    ).to.be.revertedWith('Initializable: contract is already initialized')

    // reverts if trying to initialize base contract
    await expect(fundingPoolImpl.initialize(factory.address, usdc.address)).to.be.revertedWith(
      'Initializable: contract is already initialized'
    )

    // reverts if trying to set same MYSO token manager (initially zero)
    await expect(factory.connect(team).setMysoTokenManager(ADDRESS_ZERO)).to.be.revertedWithCustomError(
      factory,
      'InvalidAddress'
    )

    return {
      fundingPool,
      factory,
      usdc,
      daoToken,
      lender0,
      lender1,
      lender2,
      lender3,
      arranger,
      daoTreasury,
      team,
      whitelistAuthority,
      anyUser
    }
  }

  it('Should handle creating a new loan proposal contract correctly', async function () {
    const { fundingPool, factory, daoToken, arranger } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert on too small arranger fee
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          MAX_ARRANGER_FEE.add(1),
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidFee')
    // revert on too short unsubscribe grace period
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          0,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          MIN_UNSUBSCRIBE_GRACE_PERIOD.sub(1),
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD.sub(1),
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD.sub(1)
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MIN_CONVERSION_GRACE_PERIOD,
          MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD.sub(MIN_CONVERSION_GRACE_PERIOD).add(1)
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          MIN_UNSUBSCRIBE_GRACE_PERIOD,
          MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD.sub(MIN_REPAYMENT_GRACE_PERIOD).add(1),
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
    // revert on too long unsubscribe grace period
    await expect(
      factory
        .connect(arranger)
        .createLoanProposal(
          fundingPool.address,
          daoToken.address,
          ADDRESS_ZERO,
          0,
          MAX_UNSUBSCRIBE_GRACE_PERIOD.add(1),
          MIN_CONVERSION_GRACE_PERIOD,
          MIN_REPAYMENT_GRACE_PERIOD
        )
    ).to.be.revertedWithCustomError(loanProposal, 'InvalidGracePeriod')
  })

  it('Should handle loan proposals correctly', async function () {
    const { fundingPool, factory, usdc, daoToken, arranger, team, lender1 } = await setupTest()

    // arranger creates loan proposal
    await factory
      .connect(arranger)
      .createLoanProposal(
        fundingPool.address,
        daoToken.address,
        ADDRESS_ZERO,
        REL_ARRANGER_FEE,
        UNSUBSCRIBE_GRACE_PERIOD,
        CONVERSION_GRACE_PERIOD,
        REPAYMENT_GRACE_PERIOD
      )
    const loanProposalAddr = await factory.loanProposals(0)
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
      'InvalidSubscriptionRange'
    )
    // set valid min loan amount
    loanTerms.minTotalSubscriptions = ONE_USDC.mul(1000000)
    // revert if max loan amount still zero
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSubscriptionRange'
    )

    loanTerms.minTotalSubscriptions = loanTerms.maxTotalSubscriptions.add(1)
    // revert if min loan amount less than max loan amount
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSubscriptionRange'
    )

    // set valid min and max loan amounts
    loanTerms.minTotalSubscriptions = ONE_USDC.mul(1000000)
    loanTerms.maxTotalSubscriptions = ONE_USDC.mul(10000000)

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
    let firstDueDate = ethers.BigNumber.from(timestamp)
      .add(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD)
      .add(UNSUBSCRIBE_GRACE_PERIOD)
      .add(LOAN_EXECUTION_GRACE_PERIOD)
      .add(MIN_TIME_UNTIL_FIRST_DUE_DATE)
      .add(60) // +60s
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

    // move forward past loan terms update cool off period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // check revert with loan terms that lead to zero repayment amount due to truncation
    // TestToken
    // decimals = 6
    // finalLoanAmount = 9 * 10 ^ 6
    // loanTokenDue = 1 * 10 ^ 11
    // Constants.BASE = 10 ^ 18
    // brokenRepayment = (9 * 10 ^ 6) * (1 * 10 ^ 11) / 10 ^ 18 = 0.9 = 0
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    firstDueDate = ethers.BigNumber.from(timestamp)
      .add(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD)
      .add(UNSUBSCRIBE_GRACE_PERIOD)
      .add(LOAN_EXECUTION_GRACE_PERIOD)
      .add(MIN_TIME_UNTIL_FIRST_DUE_DATE)
      .add(60) // +60s
    let badLoanTerms = await getDummyLoanTerms(ADDRESS_ZERO)
    badLoanTerms.minTotalSubscriptions = ONE_USDC.mul(9)
    let badRepaymentSchedule = [
      getRepaymentScheduleEntry(ethers.BigNumber.from(10).pow(11), ethers.BigNumber.from(1), firstDueDate)
    ]
    badLoanTerms.repaymentSchedule = badRepaymentSchedule
    await expect(loanProposal.connect(arranger).proposeLoanTerms(badLoanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'LoanTokenDueIsZero'
    )

    // move forward past loan terms update cool off period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // set valid repayment schedule
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    firstDueDate = ethers.BigNumber.from(timestamp)
      .add(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD)
      .add(UNSUBSCRIBE_GRACE_PERIOD)
      .add(LOAN_EXECUTION_GRACE_PERIOD)
      .add(MIN_TIME_UNTIL_FIRST_DUE_DATE)
      .add(60) // +60s
    firstRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue1, relCollTokenDueIfConverted1, firstDueDate)
    nextDueDate = firstDueDate.add(MIN_TIME_BETWEEN_DUE_DATES)
    secondRepaymentScheduleEntry = getRepaymentScheduleEntry(relLoanTokenDue2, relCollTokenDueIfConverted2, nextDueDate)
    repaymentSchedule = [firstRepaymentScheduleEntry, secondRepaymentScheduleEntry]
    loanTerms.repaymentSchedule = repaymentSchedule

    // should not revert if same min and max loan amount
    loanTerms.maxTotalSubscriptions = loanTerms.minTotalSubscriptions
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
  })

  it('Should handle loan term subscriptions and acceptance correctly', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender0, lender1, lender2 } = await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
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
    await expect(fundingPool.connect(lender0).subscribe(loanProposal.address, bal, bal)).to.be.revertedWithCustomError(
      fundingPool,
      'NotInSubscriptionPhase'
    )
    await fundingPool.connect(lender0).withdraw(bal)

    // check initial status without any proposed loan terms
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(0)
    // propose 1st loan terms
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

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
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)).to.be.revertedWithCustomError(
      loanProposal,
      'WaitForLoanTermsCoolOffPeriod'
    )

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // reverts if too few subscriptions
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)).to.be.revertedWithCustomError(
      loanProposal,
      'NotEnoughSubscriptions'
    )

    // lender can deposit
    await usdc.connect(lender1).approve(fundingPool.address, MAX_UINT256)
    let preBalLender = await usdc.balanceOf(lender1.address)
    let addAmount = preBalLender
    await expect(fundingPool.connect(lender1).deposit(0, 0)).to.be.revertedWithCustomError(fundingPool, 'InvalidSendAmount')
    await expect(fundingPool.connect(lender1).deposit(addAmount.add(1), 0)).to.be.revertedWith(
      'ERC20: transfer amount exceeds balance'
    )
    await expect(fundingPool.connect(lender1).deposit(addAmount.sub(10), 10)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidSendAmount'
    )
    await fundingPool.connect(lender1).deposit(addAmount, 0)
    expect(await fundingPool.balanceOf(lender1.address)).to.be.equal(await usdc.balanceOf(fundingPool.address))
    expect(await fundingPool.balanceOf(lender1.address)).to.be.equal(addAmount)

    // lender can withdraw
    preBalLender = await usdc.balanceOf(lender1.address)
    let preBalPool = await usdc.balanceOf(fundingPool.address)
    await expect(fundingPool.connect(lender1).withdraw(0)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidWithdrawAmount'
    )
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
    await expect(
      fundingPool.connect(lender2).subscribe(lender2.address, ONE_USDC.mul(80000), ONE_USDC.mul(80000))
    ).to.be.revertedWithCustomError(fundingPool, 'UnregisteredLoanProposal')
    // users without or too low balance can't subscribe
    let subscriptionAmount = ONE_USDC.mul(80000)
    await expect(
      fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionAmount, subscriptionAmount)
    ).to.be.revertedWithCustomError(fundingPool, 'InsufficientBalance')
    let depositedBalance = await fundingPool.balanceOf(lender2.address)
    await expect(
      fundingPool.connect(lender1).subscribe(loanProposal.address, depositedBalance.add(1), depositedBalance.add(1))
    ).to.be.revertedWithCustomError(fundingPool, 'InsufficientBalance')

    // check can't subscribe with zero amount
    await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, 0, 0)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidAmount'
    )

    // check can't subscribe when min subscription amount > max subscription amount
    await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, 1, 0)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidAmount'
    )

    // check valid subscribe works
    await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionAmount, subscriptionAmount)

    // revert when trying to propose new loan terms with max loan amount smaller than prospective loan amount based on current subscriptions
    const prevMaxLoanAmount = loanTerms.maxTotalSubscriptions
    const currTotalSubscribed = await fundingPool.totalSubscriptions(loanProposal.address)
    const loanTokenDecimals = await usdc.decimals()
    loanTerms.maxTotalSubscriptions = currTotalSubscribed.sub(1)
    await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidMaxTotalSubscriptions'
    )
    loanTerms.maxTotalSubscriptions = prevMaxLoanAmount

    // revert when unsubscribing during cool down period
    await expect(
      fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount)
    ).to.be.revertedWithCustomError(fundingPool, 'BeforeEarliestUnsubscribe')
    // move forward past subscription cool down period to check unsubscribe method
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(MIN_WAIT_UNTIL_EARLIEST_UNSUBSCRIBE.toString())])
    let preBal = await fundingPool.balanceOf(lender2.address)
    let preSubscribedBal = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    await expect(
      fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount.add(1))
    ).to.be.revertedWithCustomError(fundingPool, 'UnsubscriptionAmountTooLarge')

    // reverts when trying unsubscribe from invalid / unknown loan proposal address
    await expect(fundingPool.connect(lender2).unsubscribe(ADDRESS_ZERO, subscriptionAmount)).to.be.revertedWithCustomError(
      fundingPool,
      'UnregisteredLoanProposal'
    )

    // check can't unsubscribe with zero amount
    await expect(fundingPool.connect(lender2).unsubscribe(loanProposal.address, 0)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidAmount'
    )

    // check valid unsubscribe works
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionAmount)
    let postBal = await fundingPool.balanceOf(lender2.address)
    let postSubscribedBal = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    expect(preSubscribedBal.sub(postSubscribedBal)).to.be.equal(postBal.sub(preBal))
    // subscribe again
    await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionAmount, subscriptionAmount)

    // check subscriptions don't change pool balance, only shift regular balance and subscription balance
    let remainingDepositBalance = await fundingPool.balanceOf(lender2.address)
    expect(remainingDepositBalance).to.be.equal(totalDeposited.sub(subscriptionAmount))
    expect(await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)).to.be.equal(subscriptionAmount)
    expect(await usdc.balanceOf(fundingPool.address)).to.be.equal(poolBal)
    await expect(
      fundingPool.connect(lender2).subscribe(loanProposal.address, remainingDepositBalance, remainingDepositBalance)
    ).to.be.revertedWithCustomError(fundingPool, 'InsufficientFreeSubscriptionSpace')

    let lenderBalancePre = await fundingPool.balanceOf(lender2.address)
    let lenderSubscriptionPre = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    let maxTotalSubscriptions = (await loanProposal.loanTerms()).maxTotalSubscriptions
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let freeSubscriptionSpace = maxTotalSubscriptions.sub(totalSubscriptions)

    // check subscription with valid min/max range will allow lender to take remaining free subscription space
    await fundingPool.connect(lender2).subscribe(loanProposal.address, 0, remainingDepositBalance)
    let lenderSubscriptionPost = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    let lenderBalancePost = await fundingPool.balanceOf(lender2.address)
    expect(lenderSubscriptionPost.sub(lenderSubscriptionPre)).to.be.equal(freeSubscriptionSpace)
    expect(lenderSubscriptionPost.sub(lenderSubscriptionPre)).to.be.equal(lenderBalancePre.sub(lenderBalancePost))

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
    await expect(loanProposal.connect(lender1).acceptLoanTerms(lastLoanTermsUpdateTime)).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )
    // reverts if trying to accept with non-matching loan terms update time
    await expect(
      loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime.sub(1))
    ).to.be.revertedWithCustomError(loanProposal, 'InconsistentLastLoanTermsUpdateTime')
    // check status didn't change
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(1)

    // test that dao treasury can accept loan terms and move forward
    let tx = await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)
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
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)).to.be.revertedWithCustomError(
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
    totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let [, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)
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

  it('Should handle accept loan terms edge case correctly', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3 } = await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)

    // get current time
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

    // make first due date as close as possible (add 15s buffer)
    loanTerms.repaymentSchedule[0].dueTimestamp = ethers.BigNumber.from(timestamp)
      .add(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD)
      .add(UNSUBSCRIBE_GRACE_PERIOD)
      .add(LOAN_EXECUTION_GRACE_PERIOD)
      .add(MIN_TIME_UNTIL_FIRST_DUE_DATE)
      .add(15)
    loanTerms.repaymentSchedule[1].dueTimestamp = loanTerms.repaymentSchedule[0].dueTimestamp.add(MIN_TIME_BETWEEN_DUE_DATES)
    loanTerms.repaymentSchedule[2].dueTimestamp = loanTerms.repaymentSchedule[1].dueTimestamp.add(MIN_TIME_BETWEEN_DUE_DATES)
    loanTerms.repaymentSchedule[3].dueTimestamp = loanTerms.repaymentSchedule[2].dueTimestamp.add(MIN_TIME_BETWEEN_DUE_DATES)

    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // check status updated correctly
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(1)

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)
    // check status updated correctly
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(2)
  })

  it('Should handle lender whitelist correctly', async function () {
    const {
      fundingPool,
      factory,
      daoToken,
      arranger,
      daoTreasury,
      usdc,
      lender0,
      lender1,
      lender2,
      lender3,
      whitelistAuthority
    } = await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      whitelistAuthority.address,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // lender 1 deposits
    let bal = await usdc.balanceOf(lender1.address)
    await usdc.connect(lender1).approve(fundingPool.address, bal)
    await fundingPool.connect(lender1).deposit(bal, 0)

    // lender 2 deposits
    bal = await usdc.balanceOf(lender2.address)
    await usdc.connect(lender2).approve(fundingPool.address, bal)
    await fundingPool.connect(lender2).deposit(bal, 0)

    // lender 3 deposits
    bal = await usdc.balanceOf(lender3.address)
    await usdc.connect(lender3).approve(fundingPool.address, bal)
    await fundingPool.connect(lender3).deposit(bal, 0)

    // lenders that aren't on whitelist can't subscribe
    bal = await fundingPool.balanceOf(lender1.address)
    await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, bal, bal)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidLender'
    )
    bal = await fundingPool.balanceOf(lender1.address)
    await expect(fundingPool.connect(lender2).subscribe(loanProposal.address, bal, bal)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidLender'
    )
    bal = await fundingPool.balanceOf(lender1.address)
    await expect(fundingPool.connect(lender3).subscribe(loanProposal.address, bal, bal)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidLender'
    )

    // should revert when trying to update lender whitelist with empty array
    await expect(factory.connect(whitelistAuthority).updateLenderWhitelist([], 1)).to.be.revertedWithCustomError(
      factory,
      'InvalidArrayLength'
    )

    // whitelist lender 1
    await whitelistLender(factory, whitelistAuthority, lender1, HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId, MAX_UINT256)
    // check subscription now works
    await fundingPool.connect(lender1).subscribe(loanProposal.address, 1, 1)
    let subscriptionAmountOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    expect(subscriptionAmountOf).to.be.equal(1)
    expect(totalSubscriptions).to.be.equal(1)

    // whitelist lender 2
    await whitelistLender(factory, whitelistAuthority, lender2, HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId, MAX_UINT256)
    // check subscription now works
    await fundingPool.connect(lender2).subscribe(loanProposal.address, 1, 1)
    subscriptionAmountOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    expect(subscriptionAmountOf).to.be.equal(1)
    expect(totalSubscriptions).to.be.equal(2)

    // whitelist lender 3
    await whitelistLender(factory, whitelistAuthority, lender3, HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId, MAX_UINT256)
    // check subscription now works
    await fundingPool.connect(lender3).subscribe(loanProposal.address, 1, 1)
    subscriptionAmountOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    expect(subscriptionAmountOf).to.be.equal(1)
    expect(totalSubscriptions).to.be.equal(3)

    // de-whitelist lenders
    await factory.connect(whitelistAuthority).updateLenderWhitelist([lender1.address, lender2.address, lender3.address], 0)

    // check lenders can't subscribe anymore
    await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, 1, 1)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidLender'
    )
    await expect(fundingPool.connect(lender2).subscribe(loanProposal.address, 1, 1)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidLender'
    )
    await expect(fundingPool.connect(lender3).subscribe(loanProposal.address, 1, 1)).to.be.revertedWithCustomError(
      fundingPool,
      'InvalidLender'
    )
  })

  it('Should revert on invalid loan acceptance', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3 } = await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward in time but "too close" to first due date
    let firstDueDate = loanTerms.repaymentSchedule[0].dueTimestamp
    await ethers.provider.send('evm_mine', [Number(firstDueDate.sub(MIN_TIME_UNTIL_FIRST_DUE_DATE).toString())])

    // reverts if trying to accept loan terms where first due date is "too close"
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )

    // move forward past first due date
    await ethers.provider.send('evm_mine', [Number(firstDueDate.toString()) + 1])

    // reverts if trying to accept loan terms where first due already passed
    await expect(loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)).to.be.revertedWithCustomError(
      loanProposal,
      'FirstDueDateTooCloseOrPassed'
    )
  })

  it('Should handle rollbacks correctly (1/3)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3 } = await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

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
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)
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
    await ethers.provider.send('evm_mine', [timestamp + Number(MIN_WAIT_UNTIL_EARLIEST_UNSUBSCRIBE.toString())])

    // check users can unsubscribe any time
    // lender 1
    let subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    await fundingPool.connect(lender1).unsubscribe(loanProposal.address, subscriptionBalOf)
    let balOf = await fundingPool.balanceOf(lender1.address)
    await fundingPool.connect(lender1).withdraw(balOf)
    // lender 2
    subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, subscriptionBalOf)
    balOf = await fundingPool.balanceOf(lender2.address)
    await fundingPool.connect(lender2).withdraw(balOf)
    // lender 3
    subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender3.address)
    await fundingPool.connect(lender3).unsubscribe(loanProposal.address, subscriptionBalOf)
    balOf = await fundingPool.balanceOf(lender3.address)
    await fundingPool.connect(lender3).withdraw(balOf)
  })

  it('Should handle rollbacks correctly (2/3)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)
    let dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(2)

    // move forward beyond minimum subscription holding period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(MIN_WAIT_UNTIL_EARLIEST_UNSUBSCRIBE.toString())])

    // lenders unsubscribe such that subscription amount lower than minTotalSubscriptions
    let subscriptionRemainder = 1
    let subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    await fundingPool
      .connect(lender1)
      .unsubscribe(loanProposal.address, (await subscriptionBalOf).sub(subscriptionRemainder))
    // test scenario where lender1 also withdraws unsubscribed amount
    await fundingPool.connect(lender1).withdraw(subscriptionBalOf.sub(subscriptionRemainder))
    subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    await fundingPool
      .connect(lender2)
      .unsubscribe(loanProposal.address, (await subscriptionBalOf).sub(subscriptionRemainder))
    subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender3.address)
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
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()
    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // borrower accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)
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
        .unsubscribe(loanProposal.address, await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address))
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')
    await expect(
      fundingPool
        .connect(lender2)
        .unsubscribe(loanProposal.address, await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address))
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')
    await expect(
      fundingPool
        .connect(lender3)
        .unsubscribe(loanProposal.address, await fundingPool.subscriptionAmountOf(loanProposal.address, lender3.address))
    ).to.be.revertedWithCustomError(fundingPool, 'NotInUnsubscriptionPhase')

    // check that anyone can rollback if borrower didn't execute within loan execution grace period
    await loanProposal.connect(anyUser).rollback()
    // check status updated correctly
    dynamicData = await loanProposal.dynamicData()
    expect(dynamicData.status).to.be.equal(4)

    // check that borrowers can then unsubscribe again
    await fundingPool
      .connect(lender1)
      .unsubscribe(loanProposal.address, await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address))
    await fundingPool
      .connect(lender2)
      .unsubscribe(loanProposal.address, await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address))
    await fundingPool
      .connect(lender3)
      .unsubscribe(loanProposal.address, await fundingPool.subscriptionAmountOf(loanProposal.address, lender3.address))
    let bal = await fundingPool.balanceOf(lender1.address)
    await fundingPool.connect(lender1).withdraw(bal)
    bal = await fundingPool.balanceOf(lender2.address)
    await fundingPool.connect(lender2).withdraw(bal)
    bal = await fundingPool.balanceOf(lender3.address)
    await fundingPool.connect(lender3).withdraw(bal)
  })

  it('Should not allow unauthorized updating of status', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )
  })

  it('Should handle loan execution correctly (1/3)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

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
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [
      finalLoanTerms,
      arrangerFee,
      finalCollAmountReservedForDefault,
      finalCollAmountReservedForConversions,
      protocolFee
    ] = await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    expect(preUsdcFundingPoolBal.sub(postUsdcFundingPoolBal)).to.be.equal(totalSubscriptions)
    expect(postUsdcDaoBal.sub(preUsdcDaoBal)).to.be.equal(totalSubscriptions.sub(arrangerFee).sub(protocolFee))
    expect(postUsdcArrangerBal.sub(preUsdcArrangerBal)).to.be.equal(arrangerFee)
    expect(postUsdcTeamBal.sub(preUsdcTeamBal)).to.be.equal(protocolFee)
  })

  it('Should handle loan execution correctly (2/3)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + 60])

    // have all lenders unsubscribe
    let bal = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    await fundingPool.connect(lender1).unsubscribe(loanProposal.address, bal)
    bal = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    await fundingPool.connect(lender2).unsubscribe(loanProposal.address, bal)
    bal = await fundingPool.subscriptionAmountOf(loanProposal.address, lender3.address)
    await fundingPool.connect(lender3).unsubscribe(loanProposal.address, bal)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // reverts if trying to finalize and subscriptions below min loan
    await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(
      loanProposal,
      'FellShortOfTotalSubscriptionTarget'
    )
  })

  it('Should handle loan execution correctly (3/3)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

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
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    let subscribedBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let totalConvertible = finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted
    let expectedConversionAmount = totalConvertible.mul(subscribedBalOf).div(totalSubscriptions)
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
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // define subscription amounts
    const subscriptionLender1 = ONE_USDC.mul(1000000)
    const subscriptionLender2 = ethers.BigNumber.from('1')

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    loanTerms.maxTotalSubscriptions = subscriptionLender1.add(subscriptionLender2)
    loanTerms.repaymentSchedule[0].collTokenDueIfConverted = 1
    loanTerms.repaymentSchedule[1].collTokenDueIfConverted = 1
    loanTerms.repaymentSchedule[2].collTokenDueIfConverted = 1
    loanTerms.repaymentSchedule[3].collTokenDueIfConverted = 1
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add large lender
    await usdc.mint(lender1.address, subscriptionLender1)
    await usdc.connect(lender1).approve(fundingPool.address, subscriptionLender1)
    await fundingPool.connect(lender1).deposit(subscriptionLender1, 0)
    await fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionLender1, subscriptionLender1)

    // add smaller lender
    await usdc.connect(lender2).approve(fundingPool.address, subscriptionLender2)
    await fundingPool.connect(lender2).deposit(subscriptionLender2, 0)
    await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionLender2, subscriptionLender2)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    let expConversionAmount = finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted
      .mul(subscriptionLender2)
      .div(totalSubscriptions)
    expect(expConversionAmount).to.be.equal(0)
    await expect(loanProposal.connect(lender2).exerciseConversion()).to.be.revertedWithCustomError(
      loanProposal,
      'ZeroConversionAmount'
    )
  })

  it('Should handle repayments correctly (1/4)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    let totalCollTokenConvertable = await finalLoanTerms.repaymentSchedule[0].collTokenDueIfConverted
    let totalCollTokenActuallyConverted = await loanProposal.collTokenConverted(0)
    let totalCollTokenLeftUnconverted = totalCollTokenConvertable.sub(totalCollTokenActuallyConverted)
    let leftRepaymentAmountDue = finalLoanTerms.repaymentSchedule[0].loanTokenDue
      .mul(totalCollTokenLeftUnconverted)
      .div(totalCollTokenConvertable)
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
    let subscriptionBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender2.address)
    let preBal = await usdc.balanceOf(lender2.address)
    await loanProposal.connect(lender2).claimRepayment(0)
    let postBal = await usdc.balanceOf(lender2.address)

    // check bal diff matches expected repayment claim
    let totalConvertedSubscriptionsOfPeriod = await loanProposal.totalConvertedSubscriptionsPerIdx(0)
    let remainingEntitledSubscriptions = totalSubscriptions.sub(totalConvertedSubscriptionsOfPeriod)
    let expectedRepaymentClaim = leftRepaymentAmountDue.mul(subscriptionBalOf).div(remainingEntitledSubscriptions)
    expect(postBal.sub(preBal)).to.be.equal(expectedRepaymentClaim)

    // revert if lender tries to claim twice
    await expect(loanProposal.connect(lender2).claimRepayment(0)).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyClaimed'
    )
  })

  it('Should handle repayments correctly (2/4)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
      loanProposal,
      'InvalidSender'
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

    // move forward past unsubscription grace period
    blocknum = await ethers.provider.getBlockNumber()
    timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(UNSUBSCRIBE_GRACE_PERIOD.toString())])

    // get final amounts
    let lockedInLoanTerms = await loanProposal.loanTerms()
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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

  it('Should handle default claims correctly (1/3)', async function () {
    const { fundingPool, factory, daoToken, arranger, daoTreasury, usdc, lender1, lender2, lender3, anyUser, team } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // revert if any user wants to update loan status
    await expect(loanProposal.connect(anyUser).checkAndUpdateStatus()).to.be.revertedWithCustomError(
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
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

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
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

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
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

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
    let subscribedBalOf = await fundingPool.subscriptionAmountOf(loanProposal.address, lender1.address)
    let expectedDefaultProceeds = totalBal.mul(subscribedBalOf).div(totalSubscriptions)
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

  it('Should handle default claims correctly (2/3)', async function () {
    const { fundingPool, factory, arranger, daoTreasury, usdc, daoToken, lender1, lender2, lender3, anyUser } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    // overwrite coll per loan token to be zero
    loanTerms.collPerLoanToken = ethers.BigNumber.from(0)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

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
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // check that final collateral amount reserved for default is 0, due to collPerLoanToken=0
    expect(finalCollAmountReservedForDefault).to.be.equal(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to conversion time windows and have all lenders always convert
    let actualConvertedAmountsTotal = ethers.BigNumber.from(0)
    for (var i = 0; i < finalLoanTerms.repaymentSchedule.length; i++) {
      const conversionStartTime = finalLoanTerms.repaymentSchedule[i].dueTimestamp
      const conversionAmountForPeriod = finalLoanTerms.repaymentSchedule[i].collTokenDueIfConverted

      // move forward in time
      await ethers.provider.send('evm_mine', [conversionStartTime])

      // tmp variable
      let actualConvertedAmounts = ethers.BigNumber.from(0)

      // lender 1 converts, do pre/post bal checks
      let preProposalBal = await daoToken.balanceOf(loanProposal.address)
      let preLenderBal = await daoToken.balanceOf(lender1.address)
      await loanProposal.connect(lender1).exerciseConversion()
      let postLenderBal = await daoToken.balanceOf(lender1.address)
      let postProposalBal = await daoToken.balanceOf(loanProposal.address)
      expect(preProposalBal.sub(postProposalBal)).to.be.equal(postLenderBal.sub(preLenderBal))
      actualConvertedAmounts = actualConvertedAmounts.add(postLenderBal.sub(preLenderBal))

      // lender 2 converts, do pre/post bal checks
      preProposalBal = await daoToken.balanceOf(loanProposal.address)
      preLenderBal = await daoToken.balanceOf(lender2.address)
      await loanProposal.connect(lender2).exerciseConversion()
      postLenderBal = await daoToken.balanceOf(lender2.address)
      postProposalBal = await daoToken.balanceOf(loanProposal.address)
      expect(preProposalBal.sub(postProposalBal)).to.be.equal(postLenderBal.sub(preLenderBal))
      actualConvertedAmounts = actualConvertedAmounts.add(postLenderBal.sub(preLenderBal))

      // lender 3 converts, do pre/post bal checks
      preProposalBal = await daoToken.balanceOf(loanProposal.address)
      preLenderBal = await daoToken.balanceOf(lender3.address)
      await loanProposal.connect(lender3).exerciseConversion()
      postLenderBal = await daoToken.balanceOf(lender3.address)
      postProposalBal = await daoToken.balanceOf(loanProposal.address)
      expect(preProposalBal.sub(postProposalBal)).to.be.equal(postLenderBal.sub(preLenderBal))
      actualConvertedAmounts = actualConvertedAmounts.add(postLenderBal.sub(preLenderBal))

      // check total conversion amounts
      expect(conversionAmountForPeriod).to.be.equal(actualConvertedAmounts)
      actualConvertedAmountsTotal = actualConvertedAmountsTotal.add(conversionAmountForPeriod)

      // move forward to repayment, trigger repayment to update state/curr idx
      const repaymentStartTime =
        finalLoanTerms.repaymentSchedule[i].dueTimestamp + Number(CONVERSION_GRACE_PERIOD.toString())
      // move forward in time
      await ethers.provider.send('evm_mine', [repaymentStartTime])
      const preProposalBal1 = await daoToken.balanceOf(loanProposal.address)
      const preProposalBal2 = await usdc.balanceOf(loanProposal.address)
      await loanProposal.connect(daoTreasury).repay(0)
      const postProposalBal1 = await daoToken.balanceOf(loanProposal.address)
      const postProposalBal2 = await usdc.balanceOf(loanProposal.address)
      // check that balances don't change if all lenders converted, i.e., shouldn't
      // cause any costs for borrower
      expect(preProposalBal1).to.be.equal(postProposalBal1)
      expect(preProposalBal2).to.be.equal(postProposalBal2)
    }

    // check total total received coll matches with repayment schedule
    expect(actualConvertedAmountsTotal).to.be.equal(finalCollAmountReservedForConversions)

    // check revert if trying to mark as defaulted when all lenders converted (and borrower repaid)
    await expect(loanProposal.connect(anyUser).markAsDefaulted()).to.be.revertedWithCustomError(
      loanProposal,
      'LoanIsFullyRepaid'
    )
  })

  it('Should handle default claims correctly (3/3)', async function () {
    const { fundingPool, factory, arranger, daoTreasury, usdc, daoToken, lender1, lender2, lender3, anyUser } =
      await setupTest()

    // arranger creates loan proposal
    const loanProposal = await createLoanProposal(
      factory,
      arranger,
      fundingPool.address,
      daoToken.address,
      ADDRESS_ZERO,
      REL_ARRANGER_FEE,
      UNSUBSCRIBE_GRACE_PERIOD,
      CONVERSION_GRACE_PERIOD,
      REPAYMENT_GRACE_PERIOD
    )

    // add some loan terms
    const loanTerms = await getDummyLoanTerms(daoTreasury.address)
    // overwrite coll per loan token to be zero
    loanTerms.collPerLoanToken = ethers.BigNumber.from(0)
    await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
    const lastLoanTermsUpdateTime = await loanProposal.lastLoanTermsUpdateTime()

    // add lender subscriptions
    await addSubscriptionsToLoanProposal(lender1, lender2, lender3, usdc, fundingPool, loanProposal)

    // move forward past loan terms update cool off period
    let blocknum = await ethers.provider.getBlockNumber()
    let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
    await ethers.provider.send('evm_mine', [timestamp + Number(LOAN_TERMS_UPDATE_COOL_OFF_PERIOD.toString())])

    // dao accepts
    await loanProposal.connect(daoTreasury).acceptLoanTerms(lastLoanTermsUpdateTime)

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
    let totalSubscriptions = await fundingPool.totalSubscriptions(loanProposal.address)
    let loanTokenDecimals = await usdc.decimals()
    let [finalLoanTerms, , finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] =
      await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscriptions, loanTokenDecimals)

    // dao finalizes loan terms and sends collateral
    let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
    await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
    await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)

    // check that final collateral amount reserved for default is 0, due to collPerLoanToken=0
    expect(finalCollAmountReservedForDefault).to.be.equal(0)

    // execute loan
    await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

    // move forward to conversion time windows and have 2/3 of lenders always convert
    for (var i = 0; i < finalLoanTerms.repaymentSchedule.length; i++) {
      const conversionStartTime = finalLoanTerms.repaymentSchedule[i].dueTimestamp
      const conversionAmountForPeriod = finalLoanTerms.repaymentSchedule[i].collTokenDueIfConverted
      const repaymentAmountForPeriod = finalLoanTerms.repaymentSchedule[i].loanTokenDue

      // move forward in time
      await ethers.provider.send('evm_mine', [conversionStartTime])

      // tmp variable
      let actualConvertedAmounts = ethers.BigNumber.from(0)

      // lender 1 converts, do pre/post bal checks
      let preProposalBal = await daoToken.balanceOf(loanProposal.address)
      let preLenderBal = await daoToken.balanceOf(lender1.address)
      await loanProposal.connect(lender1).exerciseConversion()
      let postLenderBal = await daoToken.balanceOf(lender1.address)
      let postProposalBal = await daoToken.balanceOf(loanProposal.address)
      expect(preProposalBal.sub(postProposalBal)).to.be.equal(postLenderBal.sub(preLenderBal))
      actualConvertedAmounts = actualConvertedAmounts.add(postLenderBal.sub(preLenderBal))

      // lender 2 converts, do pre/post bal checks
      preProposalBal = await daoToken.balanceOf(loanProposal.address)
      preLenderBal = await daoToken.balanceOf(lender2.address)
      await loanProposal.connect(lender2).exerciseConversion()
      postLenderBal = await daoToken.balanceOf(lender2.address)
      postProposalBal = await daoToken.balanceOf(loanProposal.address)
      expect(preProposalBal.sub(postProposalBal)).to.be.equal(postLenderBal.sub(preLenderBal))
      actualConvertedAmounts = actualConvertedAmounts.add(postLenderBal.sub(preLenderBal))

      // repay in all periods, except for last
      if (i < finalLoanTerms.repaymentSchedule.length - 1) {
        // move forward to repayment, trigger repayment to update state/curr idx
        const repaymentStartTime =
          finalLoanTerms.repaymentSchedule[i].dueTimestamp + Number(CONVERSION_GRACE_PERIOD.toString())
        // move forward in time
        await ethers.provider.send('evm_mine', [repaymentStartTime])
        const preProposalBal1 = await daoToken.balanceOf(loanProposal.address)
        const preProposalBal2 = await usdc.balanceOf(loanProposal.address)
        const preDaoTreasuryBal1 = await daoToken.balanceOf(daoTreasury.address)
        const preDaoTreasuryBal2 = await usdc.balanceOf(daoTreasury.address)

        await usdc.connect(daoTreasury).approve(loanProposal.address, repaymentAmountForPeriod.mul(2).div(3))
        await loanProposal.connect(daoTreasury).repay(0)
        const postProposalBal1 = await daoToken.balanceOf(loanProposal.address)
        const postProposalBal2 = await usdc.balanceOf(loanProposal.address)
        const postDaoTreasuryBal1 = await daoToken.balanceOf(daoTreasury.address)
        const postDaoTreasuryBal2 = await usdc.balanceOf(daoTreasury.address)
        // check collateral amount unlocked/returned to borrower
        expect(preProposalBal1.sub(postProposalBal1)).to.be.equal(postDaoTreasuryBal1.sub(preDaoTreasuryBal1))
        // check amounts reclaimed by DAO treasury
        const actualConvertedPerPeriod = await loanProposal.collTokenConverted(i)
        const expectedReclaimableAmount = conversionAmountForPeriod.sub(actualConvertedPerPeriod)
        expect(preProposalBal1.sub(postProposalBal1)).to.be.equal(expectedReclaimableAmount)
        // check repayment amount given
        expect(postProposalBal2.sub(preProposalBal2)).to.be.equal(preDaoTreasuryBal2.sub(postDaoTreasuryBal2))
        // check amount repaid by DAO Treasury
        const actualUnconvertedPerPeriod = conversionAmountForPeriod.sub(actualConvertedPerPeriod)
        const expectedRepaymentAmount = repaymentAmountForPeriod
          .mul(actualUnconvertedPerPeriod)
          .div(conversionAmountForPeriod)
        expect(postProposalBal2.sub(preProposalBal2)).to.be.equal(expectedRepaymentAmount)
      }
    }

    // move forward past final repayment window
    const repaymentCutoffTime =
      finalLoanTerms.repaymentSchedule[finalLoanTerms.repaymentSchedule.length - 1].dueTimestamp +
      Number(CONVERSION_GRACE_PERIOD.toString()) +
      Number(REPAYMENT_GRACE_PERIOD.toString())
    await ethers.provider.send('evm_mine', [repaymentCutoffTime])

    // anyone can mark as defaulted
    await loanProposal.connect(anyUser).markAsDefaulted()

    // check that lender that previously already converted don't have any additional
    // default recovery value because collPerLoanToken was zero

    // lender 1 tries to claim default proceeds, shouldn't lead to balance change
    let preProposalBal = await daoToken.balanceOf(loanProposal.address)
    let preLenderBal = await daoToken.balanceOf(lender1.address)
    await expect(loanProposal.connect(lender1).claimDefaultProceeds()).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyClaimed'
    )
    let postProposalBal = await daoToken.balanceOf(loanProposal.address)
    let postLenderBal = await daoToken.balanceOf(lender1.address)
    expect(preProposalBal).to.be.equal(postProposalBal)
    expect(preLenderBal).to.be.equal(postLenderBal)

    // lender 2 tries to claim default proceeds, shouldn't lead to balance change
    preProposalBal = await daoToken.balanceOf(loanProposal.address)
    preLenderBal = await daoToken.balanceOf(lender2.address)
    await expect(loanProposal.connect(lender2).claimDefaultProceeds()).to.be.revertedWithCustomError(
      loanProposal,
      'AlreadyClaimed'
    )
    postProposalBal = await daoToken.balanceOf(loanProposal.address)
    postLenderBal = await daoToken.balanceOf(lender2.address)
    expect(preProposalBal).to.be.equal(postProposalBal)
    expect(preLenderBal).to.be.equal(postLenderBal)

    // lender 3 tries to claim default proceeds, this should lead to balance change
    preProposalBal = await daoToken.balanceOf(loanProposal.address)
    preLenderBal = await daoToken.balanceOf(lender3.address)
    await loanProposal.connect(lender3).claimDefaultProceeds()
    postProposalBal = await daoToken.balanceOf(loanProposal.address)
    postLenderBal = await daoToken.balanceOf(lender3.address)
    // check that balance diffs match
    expect(preProposalBal.sub(postProposalBal)).to.be.equal(postLenderBal.sub(preLenderBal))
    // check that balance diff in coll token is exactly 1/3 of unclaimed/unconverted coll token
    // and no additional default recovery value as collPerLoanToken was set to zero
    const conversionAmountForPeriod =
      finalLoanTerms.repaymentSchedule[finalLoanTerms.repaymentSchedule.length - 1].collTokenDueIfConverted
    expect(preProposalBal.sub(postProposalBal)).to.be.equal(conversionAmountForPeriod.mul(1).div(3))
  })
})
