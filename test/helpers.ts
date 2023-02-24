import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { LenderVault, QuoteHandler } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const BASE = ethers.BigNumber.from(10).pow(18)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')

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
      isSingleUse: false
    },
    quoteTuples: quoteTuples,
    salt: ZERO_BYTES32
  }
  await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
    quoteHandler,
    'OnChainQuoteAdded'
  )

  return onChainQuote
}
