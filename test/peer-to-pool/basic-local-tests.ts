import { ethers } from 'hardhat'
import { expect } from 'chai'
import { getLoanTermsTemplate, getRepaymentScheduleTemplate, createLoanProposal, getDummyLoanTerms } from '../helpers/misc'
import { ADDRESS_ZERO } from '@uniswap/v3-sdk'

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)

describe('Basic Local Tests', function () {
  async function setupTest() {
    const [lender1, lender2, lender3, arranger, daoTreasury, team] = await ethers.getSigners()

    // deploy test tokens
    const MyERC20 = await ethers.getContractFactory('MyERC20')

    const USDC = await MyERC20
    const usdc = await USDC.deploy('USDC', 'USDC', 6)
    await usdc.deployed()

    const DAOToken = await MyERC20
    const daoToken = await DAOToken.deploy('DAO-Token', 'DAO-Token', 18)
    await daoToken.deployed()

    // transfer some test tokens
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
    await expect(loanProposalFactory.connect(lender1).setArrangerFeeSplit(BASE.mul(20).div(100))).to.be.reverted
    await loanProposalFactory.connect(team).setArrangerFeeSplit(BASE.mul(20).div(100))

    const FundingPool = await ethers.getContractFactory('FundingPool')
    const fundingPool = await FundingPool.deploy(loanProposalFactory.address, usdc.address)
    await fundingPool.deployed()

    return { fundingPool, loanProposalFactory, usdc, daoToken, lender1, lender2, lender3, arranger, daoTreasury, team }
  }

  describe('Peer-to-Pool Tests', function () {
    describe('Loan Proposal Implementation Tests', function () {
      it('Should handle new loan proposal creation correctly', async function () {
        const { fundingPool, loanProposalFactory, daoToken, arranger, team } = await setupTest()

        // arranger creates loan proposal
        const relArrangerFee = BASE.mul(50).div(10000)
        const lenderGracePeriod = ONE_DAY
        const loanProposal = await createLoanProposal(loanProposalFactory, arranger, fundingPool.address, daoToken.address, relArrangerFee, lenderGracePeriod)

        // revert on zero addresses
        await expect(loanProposalFactory.connect(arranger).createLoanProposal(ADDRESS_ZERO, daoToken.address, BASE.mul(10).div(100), ONE_DAY)).to.be.revertedWithCustomError(loanProposal, 'InvalidAddress')
        await expect(loanProposalFactory.connect(arranger).createLoanProposal(fundingPool.address, ADDRESS_ZERO, BASE.mul(10).div(100), ONE_DAY)).to.be.revertedWithCustomError(loanProposal, 'InvalidAddress')
        // revert on zero arranger fee
        await expect(loanProposalFactory.connect(arranger).createLoanProposal(fundingPool.address, daoToken.address, 0, ONE_DAY)).to.be.revertedWithCustomError(loanProposal, 'InvalidFee')
        // revert on too short unsubscribe grace period
        await expect(loanProposalFactory.connect(arranger).createLoanProposal(fundingPool.address, daoToken.address, 1, 0)).to.be.revertedWithCustomError(loanProposal, 'UnsubscribeGracePeriodTooShort')
      })

      it('Should handle loan proposals correctly', async function () {
        const { fundingPool, loanProposalFactory, daoToken, arranger, team } = await setupTest()

        // arranger creates loan proposal
        const relArrangerFee = BASE.mul(50).div(10000)
        const lenderGracePeriod = ONE_DAY
        const blocknum = await ethers.provider.getBlockNumber()
        const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
        const firstDueDate = ethers.BigNumber.from(timestamp).add(ONE_DAY)
        await loanProposalFactory.connect(arranger).createLoanProposal(fundingPool.address, daoToken.address, relArrangerFee, lenderGracePeriod)
        const loanProposalAddr = await loanProposalFactory.loanProposals(0)
        const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
        const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)

        // check various loan terms
        let loanTerms = getLoanTermsTemplate()
        loanTerms.repaymentSchedule = []
        // revert on unauthorized sender
        await expect(loanProposal.connect(team).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'InvalidSender')

        // revert on empty repayment schedule
        await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'EmptyRepaymentSchedule')

        let repaymentSchedule = [getRepaymentScheduleTemplate(), getRepaymentScheduleTemplate()]
        repaymentSchedule[0].dueTimestamp = ethers.BigNumber.from(timestamp)
        repaymentSchedule[0].conversionGracePeriod = ONE_DAY
        repaymentSchedule[0].repaymentGracePeriod = ONE_DAY
        let nextDueDate = repaymentSchedule[0].dueTimestamp.add(repaymentSchedule[0].conversionGracePeriod).add(repaymentSchedule[0].repaymentGracePeriod)
        repaymentSchedule[1].dueTimestamp = nextDueDate.add(ONE_DAY)
        repaymentSchedule[1].conversionGracePeriod = ONE_DAY
        repaymentSchedule[1].repaymentGracePeriod = ONE_DAY
        loanTerms.repaymentSchedule = repaymentSchedule
        // revert on too close first due date
        await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'FirstDueDateTooClose')

        repaymentSchedule[0].dueTimestamp = firstDueDate
        repaymentSchedule[0].conversionGracePeriod = ONE_DAY
        repaymentSchedule[0].repaymentGracePeriod = ONE_DAY
        nextDueDate = repaymentSchedule[0].dueTimestamp.add(repaymentSchedule[0].conversionGracePeriod).add(repaymentSchedule[0].repaymentGracePeriod)
        repaymentSchedule[1].dueTimestamp = nextDueDate.add(1)
        repaymentSchedule[1].conversionGracePeriod = ONE_DAY
        repaymentSchedule[1].repaymentGracePeriod = ONE_DAY
        loanTerms.repaymentSchedule = repaymentSchedule
        // revert on too close due timestamps
        await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'DueDatesTooClose')

        repaymentSchedule[0].dueTimestamp = firstDueDate
        repaymentSchedule[0].conversionGracePeriod = 1
        repaymentSchedule[0].repaymentGracePeriod = 1
        nextDueDate = repaymentSchedule[0].dueTimestamp.add(repaymentSchedule[0].conversionGracePeriod).add(repaymentSchedule[0].repaymentGracePeriod)
        repaymentSchedule[1].dueTimestamp = nextDueDate.add(ONE_DAY)
        repaymentSchedule[1].conversionGracePeriod = 1
        repaymentSchedule[1].repaymentGracePeriod = 1
        loanTerms.repaymentSchedule = repaymentSchedule
        // revert when grace periods too short
        await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'GracePeriodsTooShort')

        repaymentSchedule[0].dueTimestamp = firstDueDate
        repaymentSchedule[0].conversionGracePeriod = ONE_DAY
        repaymentSchedule[0].repaymentGracePeriod = ONE_DAY
        nextDueDate = repaymentSchedule[0].dueTimestamp.add(repaymentSchedule[0].conversionGracePeriod).add(repaymentSchedule[0].repaymentGracePeriod)
        repaymentSchedule[1].dueTimestamp = nextDueDate.add(ONE_DAY)
        repaymentSchedule[1].conversionGracePeriod = ONE_DAY
        repaymentSchedule[1].repaymentGracePeriod = ONE_DAY
        repaymentSchedule[1].repaid = true
        loanTerms.repaymentSchedule = repaymentSchedule
        // revert when grace periods too short
        await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'InvalidRepaidStatus')

        repaymentSchedule[1].repaid = false
        // now should pass
        await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
      })

      it('Should handle loan term acceptance correctly', async function () {
        const { fundingPool, loanProposalFactory, daoToken, arranger, daoTreasury, usdc, lender1, lender2} = await setupTest()
        // arranger creates loan proposal
        const relArrangerFee = BASE.mul(50).div(10000)
        const lenderGracePeriod = ONE_DAY
        const loanProposal = await createLoanProposal(loanProposalFactory, arranger, fundingPool.address, daoToken.address, relArrangerFee, lenderGracePeriod)

        const loanTerms = await getDummyLoanTerms(daoTreasury.address, daoToken.address, usdc.address)
        // revert if converting relative loan terms to absolute values would cause overflow
        await expect(loanProposal.getAbsoluteLoanTerms(loanTerms, MAX_UINT256, 6)).to.be.reverted

        await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
        
        // check values correctly set
        expect(await loanProposal.fundingPool()).to.equal(fundingPool.address)
        expect(await loanProposal.collToken()).to.equal(daoToken.address)
        expect(await loanProposal.arrangerFee()).to.equal(relArrangerFee)
        
        // check loan terms correctly set
      const unfinalizedLoanTerms = await loanProposal.loanTerms()
      for (var i = 0; i < unfinalizedLoanTerms.repaymentSchedule.length; i++) {
        expect(unfinalizedLoanTerms.repaymentSchedule[i].loanTokenDue).to.equal(loanTerms.repaymentSchedule[i].loanTokenDue)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].collTokenDueIfConverted).to.equal(loanTerms.repaymentSchedule[i].collTokenDueIfConverted)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].dueTimestamp).to.equal(loanTerms.repaymentSchedule[i].dueTimestamp)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].conversionGracePeriod).to.equal(loanTerms.repaymentSchedule[i].conversionGracePeriod)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].repaymentGracePeriod).to.equal(loanTerms.repaymentSchedule[i].repaymentGracePeriod)
      }
        // reverts if too few subscriptions
        await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(loanProposal, 'TotalSubscribedTooLow')

        // lender can deposit
        await usdc.connect(lender1).approve(fundingPool.address, MAX_UINT256)
        let preBalLender = await usdc.balanceOf(lender1.address)
        let addAmount = preBalLender
        await expect(fundingPool.connect(lender1).deposit(addAmount.add(1), 0)).to.be.revertedWith
        await fundingPool.connect(lender1).deposit(addAmount, 0)
        expect(await fundingPool.balanceOf(lender1.address)).to.be.equal(await usdc.balanceOf(fundingPool.address))
        expect(await fundingPool.balanceOf(lender1.address)).to.be.equal(addAmount)

        // lender can withdraw
        preBalLender = await usdc.balanceOf(lender1.address)
        let preBalPool = await usdc.balanceOf(fundingPool.address)
        await expect(fundingPool.connect(lender1).withdraw(addAmount.add(1))).to.be.revertedWithCustomError(fundingPool, 'InvalidWithdrawAmount')
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
        await expect(fundingPool.connect(lender2).subscribe(lender2.address, ONE_USDC.mul(80000))).to.be.revertedWithCustomError(fundingPool, 'UnregisteredLoanProposal')
        // users without or too low balance can't subscribe
        let subscriptionAmount = ONE_USDC.mul(80000)
        await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionAmount)).to.be.revertedWithCustomError(fundingPool, 'InsufficientBalance')
        let depositedBalance = await fundingPool.balanceOf(lender2.address)
        await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, depositedBalance.add(1))).to.be.revertedWithCustomError(fundingPool, 'InsufficientBalance')
        await fundingPool.connect(lender2).subscribe(loanProposal.address,subscriptionAmount)
        // revert when unsubscribing during cool down period
        await expect(fundingPool.connect(lender2).unsubscribe(loanProposal.address,subscriptionAmount)).to.be.revertedWithCustomError(fundingPool, 'BeforeEarliestUnsubscribe')
        // move forward to check unsubscription
        let blocknum = await ethers.provider.getBlockNumber()
        let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
        await ethers.provider.send('evm_mine', [timestamp+60])
        let preBal = await fundingPool.balanceOf(lender2.address)
        let preSubscribedBal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
        await fundingPool.connect(lender2).unsubscribe(loanProposal.address,subscriptionAmount)
        let postBal = await fundingPool.balanceOf(lender2.address)
        let postSubscribedBal = await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)
        expect(preSubscribedBal.sub(postSubscribedBal)).to.be.equal(postBal.sub(preBal))
        // subscribe again
        await fundingPool.connect(lender2).subscribe(loanProposal.address,subscriptionAmount)

        // check subscriptions don't change pool balance, only shift regular balance and subscription balance
        let remainingDepositBalance = await fundingPool.balanceOf(lender2.address)
        expect(remainingDepositBalance).to.be.equal(totalDeposited.sub(subscriptionAmount))
        expect(await fundingPool.subscribedBalanceOf(loanProposal.address, lender2.address)).to.be.equal(subscriptionAmount)
        expect(await usdc.balanceOf(fundingPool.address)).to.be.equal(poolBal)
        await expect(fundingPool.connect(lender2).subscribe(loanProposal.address,remainingDepositBalance)).to.be.revertedWithCustomError(fundingPool, 'SubscriptionAmountTooHigh')

        // reverts if trying to finalize loan terms prior to acceptance
        await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(loanProposal, 'InvalidActionForCurrentStatus')

        // reverts if unauthorized user tries to accept loan terms
        await expect(loanProposal.connect(lender1).acceptLoanTerms()).to.be.revertedWithCustomError(loanProposal, 'InvalidSender')
        // check status didn't change
        expect(await loanProposal.status()).to.be.equal(0)
        let tx = await loanProposal.connect(daoTreasury).acceptLoanTerms()
        let receipt = await tx.wait()
        timestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp
        // check loanTermsLockedTime and status were updated
        expect(await loanProposal.loanTermsLockedTime()).to.be.equal(timestamp)
        expect(await loanProposal.status()).to.be.equal(1)

        // revert if arranger tries to propose new loan terms if already accepted
        await expect(loanProposal.connect(arranger).proposeLoanTerms(loanTerms)).to.be.revertedWithCustomError(loanProposal, 'InvalidActionForCurrentStatus')
        // reverts if trying to 'double accept'
        await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(loanProposal, 'InvalidActionForCurrentStatus')
      
        // reverts if trying to finalize loan terms during lender unsubscribe grace period
        await expect(loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(loanProposal, 'InvalidActionForCurrentStatus')

        // move forward post lender unsubscribe grace period
        blocknum = await ethers.provider.getBlockNumber()
        timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
        let lenderUnsubscribeGracePeriod = await loanProposal.lenderGracePeriod()
        await ethers.provider.send('evm_mine', [timestamp+Number(lenderUnsubscribeGracePeriod.toString())])

        // reverts if unauthorized sender tries to finalize loan terms and convert relative to absolute terms
        await expect(loanProposal.connect(lender1).finalizeLoanTermsAndTransferColl(0)).to.be.revertedWithCustomError(loanProposal, 'InvalidSender')

        // get final amounts
        let lockedInLoanTerms = await loanProposal.loanTerms()
        let totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
        let loanTokenDecimals = await usdc.decimals()
        let [ finalLoanTerms, arrangerFee, finalLoanAmount, finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] = await loanProposal.getAbsoluteLoanTerms(lockedInLoanTerms, totalSubscribed, loanTokenDecimals)
        let finalCollTransferAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
        await daoToken.connect(daoTreasury).approve(loanProposal.address, finalCollTransferAmount)
        let daoTreasuryBalPre = await daoToken.balanceOf(daoTreasury.address)
        let loanProposalBalPre = await daoToken.balanceOf(loanProposal.address)
        await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)
        let daoTreasuryBalPost = await daoToken.balanceOf(daoTreasury.address)
        let loanProposalBalPost = await daoToken.balanceOf(loanProposal.address)
        expect(loanProposalBalPost.sub(loanProposalBalPre)).to.be.equal(daoTreasuryBalPre.sub(daoTreasuryBalPost))
      })
    })

    /*
    it('...', async function () {
      const { fundingPool, loanProposalFactory, usdc, daoToken, lender1, lender2, lender3, arranger, daoTreasury, team } = await setupTest()

      // lenders deposit
      await usdc.connect(lender1).approve(fundingPool.address, MAX_UINT256)
      await fundingPool.connect(lender1).deposit(ONE_USDC.mul(50000), 0)

      await usdc.connect(lender2).approve(fundingPool.address, MAX_UINT256)
      await fundingPool.connect(lender2).deposit(ONE_USDC.mul(30000), 0)

      await usdc.connect(lender3).approve(fundingPool.address, MAX_UINT256)
      await fundingPool.connect(lender3).deposit(ONE_USDC.mul(20000), 0)

      // arranger creates loan proposal
      const relArrangerFee = BASE.mul(50).div(10000)
      const lenderGracePeriod = ONE_DAY
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const firstDueDate = ethers.BigNumber.from(timestamp).add(ONE_DAY.mul(365))
      await loanProposalFactory.connect(arranger).createLoanProposal(fundingPool.address, daoToken.address, relArrangerFee, lenderGracePeriod)
      const loanProposalAddr = await loanProposalFactory.loanProposals(0)
      const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
      const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)

      // check values correctly set
      expect(await loanProposal.fundingPool()).to.equal(fundingPool.address)
      expect(await loanProposal.collToken()).to.equal(daoToken.address)
      expect(await loanProposal.arrangerFee()).to.equal(relArrangerFee)

      // loan terms
      const repaymentSchedule = [
        {
          loanTokenDue: BASE.mul(25).div(100), // 25%, i.e., in relative terms to final loan amount (once known)
          collTokenDueIfConverted: ONE_WETH.mul(90).div(100), // 0.9 DAO token per lent loan token, i.e., in relative terms (same as above)
          dueTimestamp: firstDueDate,
          conversionGracePeriod: ONE_DAY,
          repaymentGracePeriod: ONE_DAY
        },
        {
          loanTokenDue: BASE.mul(25).div(100),
          collTokenDueIfConverted: ONE_WETH.mul(80).div(100),
          dueTimestamp: firstDueDate.add(ONE_DAY.mul(90)),
          conversionGracePeriod: ONE_DAY,
          repaymentGracePeriod: ONE_DAY
        },
        {
          loanTokenDue: BASE.mul(25).div(100),
          collTokenDueIfConverted: ONE_WETH.mul(70).div(100),
          dueTimestamp: firstDueDate.add(ONE_DAY.mul(180)),
          conversionGracePeriod: ONE_DAY,
          repaymentGracePeriod: ONE_DAY
        },
        {
          loanTokenDue: BASE.mul(25).div(100),
          collTokenDueIfConverted: ONE_WETH.mul(60).div(100),
          dueTimestamp: firstDueDate.add(ONE_DAY.mul(270)),
          conversionGracePeriod: ONE_DAY,
          repaymentGracePeriod: ONE_DAY
        }
      ]
      const loanTerms = {
        borrower: daoTreasury.address,
        collToken: daoToken.address,
        loanToken: usdc.address,
        minLoanAmount: ONE_USDC.mul(10000),
        maxLoanAmount: ONE_USDC.mul(100000),
        collPerLoanToken: ONE_WETH.mul(2),
        repaymentSchedule: repaymentSchedule
      }
      await expect(loanProposal.connect(daoTreasury).proposeLoanTerms(loanTerms)).to.be.reverted
      await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)

      // check loan terms correctly set
      const unfinalizedLoanTerms = await loanProposal.loanTerms()
      for (var i = 0; i < unfinalizedLoanTerms.repaymentSchedule.length; i++) {
        expect(unfinalizedLoanTerms.repaymentSchedule[i].loanTokenDue).to.equal(loanTerms.repaymentSchedule[i].loanTokenDue)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].collTokenDueIfConverted).to.equal(loanTerms.repaymentSchedule[i].collTokenDueIfConverted)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].dueTimestamp).to.equal(loanTerms.repaymentSchedule[i].dueTimestamp)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].conversionGracePeriod).to.equal(loanTerms.repaymentSchedule[i].conversionGracePeriod)
        expect(unfinalizedLoanTerms.repaymentSchedule[i].repaymentGracePeriod).to.equal(loanTerms.repaymentSchedule[i].repaymentGracePeriod)
      }

      // revert if not enough subscriptions and below target loan amount
      await expect(loanProposal.connect(daoTreasury).acceptLoanTerms()).to.be.revertedWithCustomError(loanProposal, 'TotalSubscribedTooLow')
      
      // lenders subscribe
      await fundingPool.connect(lender1).subscribe(loanProposal.address, ONE_USDC.mul(40000))
      await fundingPool.connect(lender2).subscribe(loanProposal.address, ONE_USDC.mul(20000))
      await fundingPool.connect(lender3).subscribe(loanProposal.address, ONE_USDC.mul(20000))
      // await fundingPool.connect(lender3).unsubscribe(loanProposal.address, ONE_USDC.mul(10000))

      // revert if unauthorized user tries to accept
      await expect(loanProposal.connect(lender1).acceptLoanTerms()).to.be.revertedWithCustomError(loanProposal, 'InvalidSender')
      await loanProposal.connect(daoTreasury).acceptLoanTerms()

      // lenders can still unsubscribe
      await fundingPool.connect(lender3).unsubscribe(loanProposal.address, ONE_USDC.mul(10000))

      // move forward
      const loanTermsLockedTime = await loanProposal.loanTermsLockedTime()
      const newTimestamp = loanTermsLockedTime.add(ONE_DAY.add(1))
      await ethers.provider.send('evm_mine', [Number(newTimestamp.toString())])

      // lenders can't unsubscribe anymore
      await expect(fundingPool.connect(lender1).subscribe(loanProposal.address, ONE_USDC.mul(40000))).to.be.reverted
      await expect(fundingPool.connect(lender2).subscribe(loanProposal.address, ONE_USDC.mul(20000))).to.be.reverted

      // cannot roll back anymore
      await expect(loanProposal.connect(daoTreasury).rollback()).to.be.reverted

      // finalize loan amounts
      const totalSubscribed = await fundingPool.totalSubscribed(loanProposal.address)
      const loanTokenDecimals = 6
      const [finalizedLoanTerms, absArrangerFee, finalLoanAmount, finalCollAmountReservedForDefault, finalCollAmountReservedForConversions] = await loanProposal.getAbsoluteLoanTerms(unfinalizedLoanTerms, totalSubscribed, loanTokenDecimals)
      const totalFinalCollAmount = finalCollAmountReservedForDefault.add(finalCollAmountReservedForConversions)
      for (var i = 0; i < finalizedLoanTerms.repaymentSchedule.length; i++) {
        const expectedLoanTokenDue = unfinalizedLoanTerms.repaymentSchedule[i].loanTokenDue.mul(finalLoanAmount).div(BASE)
        // should change from relative to absolute
        expect(finalizedLoanTerms.repaymentSchedule[i].loanTokenDue).to.equal(expectedLoanTokenDue)
        const expectedCollTokenDueIfConverted = expectedLoanTokenDue.mul(unfinalizedLoanTerms.repaymentSchedule[i].collTokenDueIfConverted).div(ethers.BigNumber.from(10).pow(loanTokenDecimals))
        // should change from relative to absolute
        expect(finalizedLoanTerms.repaymentSchedule[i].collTokenDueIfConverted).to.equal(expectedCollTokenDueIfConverted)
        // shouldn't change
        expect(finalizedLoanTerms.repaymentSchedule[i].dueTimestamp).to.equal(unfinalizedLoanTerms.repaymentSchedule[i].dueTimestamp)
        expect(finalizedLoanTerms.repaymentSchedule[i].conversionGracePeriod).to.equal(finalizedLoanTerms.repaymentSchedule[i].conversionGracePeriod)
        expect(finalizedLoanTerms.repaymentSchedule[i].repaymentGracePeriod).to.equal(finalizedLoanTerms.repaymentSchedule[i].repaymentGracePeriod)
      }
      console.log('finalizedLoanTerms:', finalizedLoanTerms)

      // borrower approves loan proposal contract to send final coll. amount
      await daoToken.connect(daoTreasury).approve(loanProposal.address, totalFinalCollAmount)
      console.log('totalFinalCollAmount:', totalFinalCollAmount)
      console.log('finalLoanAmount:', finalLoanAmount)

      // borrower locks in absolute amounts and sends coll. token
      const preCollBalDaoTreasury = await daoToken.balanceOf(daoTreasury.address)
      const preCollLoanProposal = await daoToken.balanceOf(loanProposal.address)
      await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl(0)
      const finalizedLoanTermsCheck = await loanProposal.loanTerms()
      console.log(finalizedLoanTermsCheck)
      // check amounts correctly set
      expect(finalizedLoanTerms.repaymentSchedule).to.deep.equal(finalizedLoanTermsCheck.repaymentSchedule)
      expect(await loanProposal.fundingPool()).to.equal(fundingPool.address)
      expect(await loanProposal.collToken()).to.equal(daoToken.address)
      expect(await loanProposal.arrangerFee()).to.equal(absArrangerFee)
      expect(await loanProposal.finalLoanAmount()).to.equal(finalLoanAmount)
      expect(await loanProposal.finalCollAmountReservedForDefault()).to.equal(finalCollAmountReservedForDefault)
      expect(await loanProposal.finalCollAmountReservedForConversions()).to.equal(finalCollAmountReservedForConversions)
      const postCollBalDaoTreasury = await daoToken.balanceOf(daoTreasury.address)
      const postCollLoanProposal = await daoToken.balanceOf(loanProposal.address)
      // check balance diffs
      expect(preCollBalDaoTreasury.sub(postCollBalDaoTreasury)).to.equal(postCollLoanProposal.sub(preCollLoanProposal))
      expect(preCollBalDaoTreasury.sub(postCollBalDaoTreasury)).to.equal(totalFinalCollAmount)

      // execute loan
      const preLoanTokenBalDaoTreasury = await usdc.balanceOf(daoTreasury.address)
      const preLoanTokenBalFundingPool = await usdc.balanceOf(fundingPool.address)
      const preLoanTokenBalArranger = await usdc.balanceOf(arranger.address)
      const preLoanTokenBalTeam = await usdc.balanceOf(team.address)
      await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)
      const postLoanTokenBalDaoTreasury = await usdc.balanceOf(daoTreasury.address)
      const postLoanTokenBalFundingPool = await usdc.balanceOf(fundingPool.address)
      const postLoanTokenBalArranger = await usdc.balanceOf(arranger.address)
      const postLoanTokenBalTeam = await usdc.balanceOf(team.address)

      // check balance diffs
      expect(preLoanTokenBalArranger).to.equal(0)
      expect(preLoanTokenBalTeam).to.equal(0)
      expect(postLoanTokenBalDaoTreasury.sub(preLoanTokenBalDaoTreasury).add(postLoanTokenBalArranger).add(postLoanTokenBalTeam)).to.equal(preLoanTokenBalFundingPool.sub(postLoanTokenBalFundingPool))
      expect(postLoanTokenBalDaoTreasury.sub(preLoanTokenBalDaoTreasury)).to.equal(finalLoanAmount)
      expect(postLoanTokenBalArranger.add(postLoanTokenBalTeam)).to.equal(absArrangerFee)


      // todo: add case where loan never gets finalized and lenders reclaim their subscription amounts
    })*/
  })
})