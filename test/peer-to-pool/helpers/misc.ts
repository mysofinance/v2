import { ethers } from 'hardhat'
import { LoanProposalFactory, LoanProposal, FundingPool, MyERC20 } from '../../../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO = ethers.BigNumber.from(0)
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)

export const getLoanTermsTemplate = () => {
  const repaymentSchedule = getRepaymentScheduleEntry(0, 0, 0)
  const loanTerms = {
    borrower: ZERO_ADDR,
    minLoanAmount: ZERO,
    maxLoanAmount: ZERO,
    collPerLoanToken: ZERO,
    repaymentSchedule: [repaymentSchedule]
  }
  return loanTerms
}

export const getRepaymentScheduleEntry = (
  loanTokenDue: BigNumber | Number,
  collTokenDueIfConverted: BigNumber | Number,
  dueTimestamp: BigNumber | Number
) => {
  const repaymentSchedule = {
    loanTokenDue: loanTokenDue,
    collTokenDueIfConverted: collTokenDueIfConverted,
    dueTimestamp: dueTimestamp
  }
  return repaymentSchedule
}

export const getDummyLoanTerms = async (daoTreasuryAddr: string) => {
  const blocknum = await ethers.provider.getBlockNumber()
  const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
  const firstDueDate = ethers.BigNumber.from(timestamp).add(ONE_DAY.mul(365))
  const repaymentSchedule = [
    {
      loanTokenDue: BASE.mul(25).div(100), // 25%, i.e., in relative terms to final loan amount (once known)
      collTokenDueIfConverted: ONE_WETH.mul(90).div(100), // 0.9 DAO token per lent loan token, i.e., in relative terms (same as above)
      dueTimestamp: firstDueDate
    },
    {
      loanTokenDue: BASE.mul(25).div(100),
      collTokenDueIfConverted: ONE_WETH.mul(80).div(100),
      dueTimestamp: firstDueDate.add(ONE_DAY.mul(90))
    },
    {
      loanTokenDue: BASE.mul(25).div(100),
      collTokenDueIfConverted: ONE_WETH.mul(70).div(100),
      dueTimestamp: firstDueDate.add(ONE_DAY.mul(180))
    },
    {
      loanTokenDue: BASE.mul(25).div(100),
      collTokenDueIfConverted: ONE_WETH.mul(60).div(100),
      dueTimestamp: firstDueDate.add(ONE_DAY.mul(270))
    }
  ]
  const loanTerms = {
    borrower: daoTreasuryAddr,
    minLoanAmount: ONE_USDC.mul(10000),
    maxLoanAmount: ONE_USDC.mul(500000),
    collPerLoanToken: ONE_WETH.mul(2),
    repaymentSchedule: repaymentSchedule
  }
  return loanTerms
}

export const createLoanProposal = async (
  loanProposalFactory: LoanProposalFactory,
  arranger: SignerWithAddress,
  fundingPoolAddr: string,
  daoTokenAddr: string,
  relArrangerFee: BigNumber,
  unsubscribeGracePeriod: BigNumber,
  conversionGracePeriod: BigNumber,
  repaymentGracePeriod: BigNumber
) => {
  // arranger creates loan proposal
  await loanProposalFactory
    .connect(arranger)
    .createLoanProposal(
      fundingPoolAddr,
      daoTokenAddr,
      relArrangerFee,
      unsubscribeGracePeriod,
      conversionGracePeriod,
      repaymentGracePeriod
    )
  const loanProposalAddr = await loanProposalFactory.loanProposals(0)
  const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
  const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)
  return loanProposal
}

export const addSubscriptionsToLoanProposal = async (
  lender1: SignerWithAddress,
  lender2: SignerWithAddress,
  lender3: SignerWithAddress,
  fundingToken: MyERC20,
  fundingPool: FundingPool,
  loanProposal: LoanProposal
) => {
  // 3 lenders each contribute 1/3 of maxLoanAmount
  const loanTerms = await loanProposal.loanTerms()
  const subscriptionAmount = loanTerms.maxLoanAmount.div(3)
  await fundingToken.connect(lender1).approve(fundingPool.address, subscriptionAmount)
  await fundingPool.connect(lender1).deposit(subscriptionAmount, 0)
  await fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionAmount)

  await fundingToken.connect(lender2).approve(fundingPool.address, subscriptionAmount)
  await fundingPool.connect(lender2).deposit(subscriptionAmount, 0)
  await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionAmount)

  await fundingToken.connect(lender3).approve(fundingPool.address, subscriptionAmount)
  await fundingPool.connect(lender3).deposit(subscriptionAmount, 0)
  await fundingPool.connect(lender3).subscribe(loanProposal.address, subscriptionAmount)
}
