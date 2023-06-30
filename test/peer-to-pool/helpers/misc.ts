import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Factory, LoanProposalImpl, FundingPoolImpl, MyERC20 } from '../../../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO = ethers.BigNumber.from(0)
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')

export const getLoanTermsTemplate = () => {
  const repaymentSchedule = getRepaymentScheduleEntry(0, 0, 0)
  const loanTerms = {
    borrower: ZERO_ADDR,
    minTotalSubscriptions: ZERO,
    maxTotalSubscriptions: ZERO,
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
    minTotalSubscriptions: ONE_USDC.mul(10000),
    maxTotalSubscriptions: ONE_USDC.mul(500000),
    collPerLoanToken: ONE_WETH.mul(2),
    repaymentSchedule: repaymentSchedule
  }
  return loanTerms
}

export const createLoanProposal = async (
  factory: Factory,
  arranger: SignerWithAddress,
  fundingPoolAddr: string,
  daoTokenAddr: string,
  whitelistAuthorityAddr: string,
  relArrangerFee: BigNumber,
  unsubscribeGracePeriod: BigNumber,
  conversionGracePeriod: BigNumber,
  repaymentGracePeriod: BigNumber
) => {
  // arranger creates loan proposal
  await factory
    .connect(arranger)
    .createLoanProposal(
      fundingPoolAddr,
      daoTokenAddr,
      whitelistAuthorityAddr,
      relArrangerFee,
      unsubscribeGracePeriod,
      conversionGracePeriod,
      repaymentGracePeriod
    )
  const loanProposalAddr = await factory.loanProposals(0)
  const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
  const loanProposal = await LoanProposalImpl.attach(loanProposalAddr)
  return loanProposal
}

export const addSubscriptionsToLoanProposal = async (
  lender1: SignerWithAddress,
  lender2: SignerWithAddress,
  lender3: SignerWithAddress,
  fundingToken: MyERC20,
  fundingPool: FundingPoolImpl,
  loanProposal: LoanProposalImpl
) => {
  // 3 lenders each contribute 1/3 of maxTotalSubscriptions
  const loanTerms = await loanProposal.loanTerms()
  const subscriptionAmount = loanTerms.maxTotalSubscriptions.div(3)
  await fundingToken.connect(lender1).approve(fundingPool.address, subscriptionAmount)

  await fundingPool.connect(lender1).deposit(subscriptionAmount, 0)
  await fundingPool.connect(lender1).subscribe(loanProposal.address, subscriptionAmount, subscriptionAmount, 0)

  await fundingToken.connect(lender2).approve(fundingPool.address, subscriptionAmount)
  await fundingPool.connect(lender2).deposit(subscriptionAmount, 0)
  await fundingPool.connect(lender2).subscribe(loanProposal.address, subscriptionAmount, subscriptionAmount, 0)

  await fundingToken.connect(lender3).approve(fundingPool.address, subscriptionAmount)
  await fundingPool.connect(lender3).deposit(subscriptionAmount, 0)
  await fundingPool.connect(lender3).subscribe(loanProposal.address, subscriptionAmount, subscriptionAmount, 0)
}

export const whitelistLender = async (
  factory: Factory,
  whitelistAuthority: SignerWithAddress,
  lender: SignerWithAddress,
  chainId: number,
  whitelistedUntil?: any
) => {
  // get salt
  const salt = ZERO_BYTES32

  // construct payload and sign
  const payload = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256', 'uint256', 'bytes32'],
    [factory.address, lender.address, whitelistedUntil, chainId, salt]
  )
  const payloadHash = ethers.utils.keccak256(payload)
  const signature = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash))
  const sig = ethers.utils.splitSignature(signature)
  const compactSig = sig.compact
  const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
  expect(recoveredAddr).to.equal(whitelistAuthority.address)

  // expects to revert on invalid whitelist authority
  await expect(
    factory.connect(lender).claimLenderWhitelistStatus(ZERO_ADDR, whitelistedUntil, compactSig, salt)
  ).to.be.revertedWithCustomError(factory, 'InvalidSignature')

  // expects to revert on invalid signature
  const invalidSignature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
  const invalidSig = ethers.utils.splitSignature(invalidSignature)
  const invalidCompactSig = invalidSig.compact
  await expect(
    factory.connect(lender).claimLenderWhitelistStatus(whitelistAuthority.address, whitelistedUntil, invalidCompactSig, salt)
  ).to.be.revertedWithCustomError(factory, 'InvalidSignature')

  // have lender claim whitelist status
  await factory.connect(lender).claimLenderWhitelistStatus(whitelistAuthority.address, whitelistedUntil, compactSig, salt)

  // should revert when trying to reclaim whitelist status again
  await expect(
    factory.connect(lender).claimLenderWhitelistStatus(whitelistAuthority.address, whitelistedUntil, compactSig, salt)
  ).to.be.revertedWithCustomError(factory, 'InvalidSignature')

  // check dewhitelisting lender
  await factory.connect(whitelistAuthority).updateLenderWhitelist([lender.address], 0)

  // should revert when trying to backrun dewhitelisting
  await expect(
    factory.connect(lender).claimLenderWhitelistStatus(whitelistAuthority.address, whitelistedUntil, compactSig, salt)
  ).to.be.revertedWithCustomError(factory, 'InvalidSignature')

  // whitelist again
  await factory.connect(whitelistAuthority).updateLenderWhitelist([lender.address], MAX_UINT256)
}
