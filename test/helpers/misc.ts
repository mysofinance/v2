import { ethers } from 'hardhat'
import { LoanProposalFactory } from '../../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO = ethers.BigNumber.from(0)
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)

export const getLoanTermsTemplate = () => {
  const repaymentSchedule = getRepaymentScheduleTemplate()
  const loanTerms = {
    borrower: ZERO_ADDR,
    collToken: ZERO_ADDR,
    loanToken: ZERO_ADDR,
    minLoanAmount: ZERO,
    maxLoanAmount: ZERO,
    collPerLoanToken: ZERO,
    repaymentSchedule: [repaymentSchedule]
  }
  return loanTerms
}

export const getRepaymentScheduleTemplate = () => {
  const repaymentSchedule = {
      loanTokenDue: ZERO,
      collTokenDueIfConverted: ZERO,
      dueTimestamp: ZERO,
      conversionGracePeriod: ZERO,
      repaymentGracePeriod: ZERO
    }
  return repaymentSchedule
}

export const getDummyLoanTerms = async (daoTreasuryAddr:string, daoTokenAddr:string, loanTokenAddr:string) => {
  const blocknum = await ethers.provider.getBlockNumber()
  const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
  const firstDueDate = ethers.BigNumber.from(timestamp).add(ONE_DAY.mul(365))
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
    borrower: daoTreasuryAddr,
    collToken: daoTokenAddr,
    loanToken: loanTokenAddr,
    minLoanAmount: ONE_USDC.mul(10000),
    maxLoanAmount: ONE_USDC.mul(500000),
    collPerLoanToken: ONE_WETH.mul(2),
    repaymentSchedule: repaymentSchedule
  }
  return loanTerms
}

export const createLoanProposal = async (loanProposalFactory : LoanProposalFactory, arranger : SignerWithAddress, fundingPoolAddr : string, daoTokenAddr : string, relArrangerFee : BigNumber, lenderGracePeriod : BigNumber) => {
    // arranger creates loan proposal
    await loanProposalFactory.connect(arranger).createLoanProposal(fundingPoolAddr, daoTokenAddr, relArrangerFee, lenderGracePeriod)
    const loanProposalAddr = await loanProposalFactory.loanProposals(0)
    const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
    const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)
    return loanProposal
}