import { ethers } from 'hardhat'
import { expect } from 'chai'

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
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
    await usdc.mint(lender1.address, ONE_USDC.mul(50000))
    await usdc.mint(lender2.address, ONE_USDC.mul(30000))
    await usdc.mint(lender3.address, ONE_USDC.mul(20000))
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

  describe('...', function () {
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

      // lenders subscribe
      await fundingPool.connect(lender1).subscribe(loanProposal.address, ONE_USDC.mul(40000))
      await fundingPool.connect(lender2).subscribe(loanProposal.address, ONE_USDC.mul(20000))
      await fundingPool.connect(lender3).subscribe(loanProposal.address, ONE_USDC.mul(20000))
      await fundingPool.connect(lender3).unsubscribe(loanProposal.address, ONE_USDC.mul(10000))

      // dao accepts
      await expect(loanProposal.connect(lender1).acceptLoanTerms()).to.be.reverted
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
      await loanProposal.connect(daoTreasury).finalizeLoanTermsAndTransferColl()
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
    })
  })
})
