import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { LenderVault } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)

export const createOnChainRequest = async ({
  lender,
  collToken,
  loanToken,
  borrowerCompartmentImplementation,
  lenderVault,
  loanPerCollUnit
}: {
  lender: SignerWithAddress
  collToken: string
  loanToken: string
  borrowerCompartmentImplementation: string
  lenderVault: LenderVault
  loanPerCollUnit: BigNumber
}) => {
  //
  let onChainQuote = {
    loanPerCollUnit,
    interestRatePctInBase: BASE.mul(10).div(100),
    upfrontFeePctInBase: BASE.mul(1).div(100),
    expectedTransferFee: 0,
    minCollAmount: 0,
    collToken,
    loanToken: loanToken,
    tenor: ONE_DAY.mul(90),
    timeUntilEarliestRepay: 0,
    isNegativeInterestRate: false,
    borrowerCompartmentImplementation: borrowerCompartmentImplementation
  }

  const payload = ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256', 'uint256', 'bool', 'address'],
    [
      onChainQuote.loanPerCollUnit,
      onChainQuote.interestRatePctInBase,
      onChainQuote.upfrontFeePctInBase,
      onChainQuote.expectedTransferFee,
      onChainQuote.minCollAmount,
      onChainQuote.collToken,
      onChainQuote.loanToken,
      onChainQuote.tenor,
      onChainQuote.timeUntilEarliestRepay,
      onChainQuote.isNegativeInterestRate,
      onChainQuote.borrowerCompartmentImplementation
    ]
  )

  const onChainQuoteHash = ethers.utils.keccak256(payload)

  await expect(lenderVault.connect(lender).addOnChainQuote(onChainQuote))
    .to.emit(lenderVault, 'OnChainQuote')
    .withArgs(Object.values(onChainQuote), onChainQuoteHash, true)

  return onChainQuote
}
