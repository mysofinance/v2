import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('Basic Local Tests', function () {
  async function setupTest() {
    const [lender1, lender2, lender3, arranger, daoTreasury] = await ethers.getSigners()

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
    const loanProposalFactory = await LoanProposalFactory.deploy(loanProposalImpl.address)
    await loanProposalFactory.deployed()

    const FundingPool = await ethers.getContractFactory('FundingPool')
    const fundingPool = await FundingPool.deploy(loanProposalFactory.address, usdc.address)
    await fundingPool.deployed()

    return { fundingPool, loanProposalFactory, usdc, daoToken, lender1, lender2, lender3, arranger, daoTreasury }
  }

  describe('...', function () {
    it('...', async function () {
      const { fundingPool, loanProposalFactory, usdc, daoToken, lender1, lender2, lender3, arranger, daoTreasury } = await setupTest()

      // lenders deposit
      await usdc.connect(lender1).approve(fundingPool.address, MAX_UINT256)
      await fundingPool.connect(lender1).deposit(ONE_USDC.mul(50000), 0)

      await usdc.connect(lender2).approve(fundingPool.address, MAX_UINT256)
      await fundingPool.connect(lender2).deposit(ONE_USDC.mul(30000), 0)

      await usdc.connect(lender3).approve(fundingPool.address, MAX_UINT256)
      await fundingPool.connect(lender3).deposit(ONE_USDC.mul(20000), 0)

      // arranger creates loan proposal
      const arrangerFee = BASE.mul(50).div(10000)
      const lenderGracePeriod = ONE_DAY
      const firstDueDate = ethers.BigNumber.from(1703416332)
      await loanProposalFactory.connect(arranger).createLoanProposal(fundingPool.address, daoToken.address, arrangerFee, lenderGracePeriod)
      const loanProposalAddr = await loanProposalFactory.loanProposals(0)
      const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
      const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)

      // loan terms
      const repaymentSchedule = [
        {
          loanTokenDue: BASE.mul(25).div(100),
          collTokenDueIfConverted: ONE_WETH.mul(90).div(100),
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
      await loanProposal.connect(arranger).proposeLoanTerms(loanTerms)
      
      // lenders subscribe
      const bal = await usdc.balanceOf(fundingPool.address)
      await fundingPool.connect(lender1).subscribe(loanProposal.address, ONE_USDC.mul(40000))
      await fundingPool.connect(lender2).subscribe(loanProposal.address, ONE_USDC.mul(20000))

      // dao accepts
      await loanProposal.connect(daoTreasury).acceptLoanTerms()

      // move forward
      const loanTermsLockedTime = await loanProposal.loanTermsLockedTime()
      const newTimestamp = loanTermsLockedTime.add(ONE_DAY.add(1))
      await ethers.provider.send('evm_mine', [Number(newTimestamp.toString())])

      // finalize loan amounts
      await loanProposal.lockInFinalAmounts()
      const finalLoanTerms = await loanProposal.loanTerms()
      console.log(finalLoanTerms)

      // execute loan
      const finalCollAmount = await loanProposal.finalCollAmount()
      await daoToken.connect(daoTreasury).approve(fundingPool.address, finalCollAmount)
      await fundingPool.connect(daoTreasury).executeLoanProposal(loanProposal.address)

      // todo: add case where loan never gets finalized and lenders reclaim their subscription amounts
    })
  })
})
