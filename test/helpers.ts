import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { LenderVaultImpl, QuoteHandler } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { chainlinkAggregatorAbi, collTokenAbi, uniV2Abi } from './abi'

const BASE = ethers.BigNumber.from(10).pow(18)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')

export const createOnChainRequest = async ({
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
  lenderVault: LenderVaultImpl
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

export const transferFeeHelper = (amountReceived : BigNumber, feeInBasisPoints : number) : BigNumber => {
  const initSendAmount = amountReceived.mul(10000).div(10000 - feeInBasisPoints)
  const initFeeAmount = initSendAmount.mul(feeInBasisPoints).div(10000)
  if(initSendAmount.sub(initFeeAmount).eq(amountReceived)){
    return initFeeAmount
  }
  else{
    let sendAmount = initSendAmount.add(1)
    let feeAmount = sendAmount.mul(feeInBasisPoints).div(10000)
    while(sendAmount.sub(feeAmount).lt(amountReceived)){
      sendAmount = sendAmount.add(1)
      feeAmount = sendAmount.mul(feeInBasisPoints).div(10000)
    }
    return feeAmount
  }
  
}

export const calcLoanBalanceDelta = (maxLoanPerColl : BigNumber, feeInBasisPoints : number, collSendAmount : BigNumber, loanDecimals : number) : BigNumber => {
  return maxLoanPerColl.mul(collSendAmount).mul(10000 - feeInBasisPoints).div(10000).div(10**loanDecimals)
}

export const getTotalEthValue = async (lpTokenAddr : string, provider : SignerWithAddress, token0OracleAddr : string, token1OracleAddr : string, wethAddr : string) : Promise<BigNumber> => {
  const uniV2Instance = new ethers.Contract(lpTokenAddr, uniV2Abi, provider)
  const token0 = await uniV2Instance.token0()
  const token1 = await uniV2Instance.token1()
  const token0Instance = new ethers.Contract(token0, collTokenAbi, provider.provider)
  const token1Instance = new ethers.Contract(token1, collTokenAbi, provider.provider)
  const token0OracleInstance = new ethers.Contract(token0OracleAddr, chainlinkAggregatorAbi, provider.provider)
  const token1OracleInstance = new ethers.Contract(token1OracleAddr, chainlinkAggregatorAbi, provider.provider)
  let answer : BigNumber
  const reserveData = await uniV2Instance.getReserves()
  const reserve0 = reserveData._reserve0
  const reserve1 = reserveData._reserve1
  const decimals0 = await token0Instance.decimals()
  const decimals1 = await token1Instance.decimals()
  if (token0 == wethAddr){
    answer = BASE
  }
  else{
    const token0OracleData = await token0OracleInstance.latestRoundData()
    answer = token0OracleData.answer
  }
  const token0EthValue = answer.mul(reserve0).div(BigNumber.from(10).pow(decimals0))
  if (token1 == wethAddr){
    answer = BASE
  }
  else{
    const token1OracleData = await token1OracleInstance.latestRoundData()
    answer = token1OracleData.answer
  }
  const token1EthValue = answer.mul(reserve1).div(BigNumber.from(10).pow(decimals1))

  return token0EthValue.gt(token1EthValue) ? token1EthValue.mul(2) : token0EthValue.mul(2)
}
