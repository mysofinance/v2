import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { BigNumber as BN } from 'bignumber.js'
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
      whitelistAuthority: ZERO_ADDR,
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

export const transferFeeHelper = (amountReceived: BigNumber, feeInBasisPoints: number): BigNumber => {
  const initSendAmount = amountReceived.mul(10000).div(10000 - feeInBasisPoints)
  const initFeeAmount = initSendAmount.mul(feeInBasisPoints).div(10000)
  if (initSendAmount.sub(initFeeAmount).eq(amountReceived)) {
    return initFeeAmount
  } else {
    let sendAmount = initSendAmount.add(1)
    let feeAmount = sendAmount.mul(feeInBasisPoints).div(10000)
    while (sendAmount.sub(feeAmount).lt(amountReceived)) {
      sendAmount = sendAmount.add(1)
      feeAmount = sendAmount.mul(feeInBasisPoints).div(10000)
    }
    return feeAmount
  }
}

export const calcLoanBalanceDelta = (
  maxLoanPerColl: BigNumber,
  feeInBasisPoints: number,
  collSendAmount: BigNumber,
  loanDecimals: number
): BigNumber => {
  return maxLoanPerColl
    .mul(collSendAmount)
    .mul(10000 - feeInBasisPoints)
    .div(10000)
    .div(10 ** loanDecimals)
}

export const getTotalEthValue = async (
  lpTokenAddr: string,
  provider: SignerWithAddress,
  token0OracleAddr: string,
  token1OracleAddr: string,
  wethAddr: string,
  isColl: boolean
): Promise<BigNumber> => {
  const uniV2Instance = new ethers.Contract(lpTokenAddr, uniV2Abi, provider)
  const token0 = await uniV2Instance.token0()
  const token1 = await uniV2Instance.token1()
  const token0Instance = new ethers.Contract(token0, collTokenAbi, provider.provider)
  const token1Instance = new ethers.Contract(token1, collTokenAbi, provider.provider)
  let answer: BigNumber
  const reserveData = await uniV2Instance.getReserves()
  const reserve0 = reserveData._reserve0
  const reserve1 = reserveData._reserve1
  const decimals0 = await token0Instance.decimals()
  const decimals1 = await token1Instance.decimals()
  if (token0 == wethAddr) {
    answer = BASE
  } else {
    const token0OracleInstance = new ethers.Contract(token0OracleAddr, chainlinkAggregatorAbi, provider.provider)
    const token0OracleData = await token0OracleInstance.latestRoundData()
    answer = token0OracleData.answer
  }
  const token0EthValue = answer.mul(reserve0).div(BigNumber.from(10).pow(decimals0))
  if (token1 == wethAddr) {
    answer = BASE
  } else {
    const token1OracleInstance = new ethers.Contract(token1OracleAddr, chainlinkAggregatorAbi, provider.provider)
    const token1OracleData = await token1OracleInstance.latestRoundData()
    answer = token1OracleData.answer
  }
  const token1EthValue = answer.mul(reserve1).div(BigNumber.from(10).pow(decimals1))

  if (isColl) {
    return token0EthValue.gt(token1EthValue) ? token1EthValue.mul(2) : token0EthValue.mul(2)
  } else {
    return token0EthValue.gt(token1EthValue) ? token0EthValue.mul(2) : token1EthValue.mul(2)
  }
}

export const getExactLpTokenPriceInEth = async (
  lpTokenAddr: string,
  provider: SignerWithAddress,
  oracleAddrs: Record<string, string>,
  wethAddr: string
): Promise<BigNumber> => {
  const uniV2Instance = new ethers.Contract(lpTokenAddr, uniV2Abi, provider)
  const totalSupply = await uniV2Instance.totalSupply()
  const lpTokenDecimals = await uniV2Instance.decimals()
  const token0 = await uniV2Instance.token0()
  const token1 = await uniV2Instance.token1()
  const token0Instance = new ethers.Contract(token0, collTokenAbi, provider.provider)
  const token1Instance = new ethers.Contract(token1, collTokenAbi, provider.provider)
  let answer: BigNumber
  const reserveData = await uniV2Instance.getReserves()
  const reserve0 = reserveData._reserve0
  const reserve1 = reserveData._reserve1
  const decimals0 = await token0Instance.decimals()
  const decimals1 = await token1Instance.decimals()
  if (token0 == wethAddr) {
    answer = BASE
  } else {
    const token0OracleInstance = new ethers.Contract(oracleAddrs[token0], chainlinkAggregatorAbi, provider.provider)
    const token0OracleData = await token0OracleInstance.latestRoundData()
    answer = token0OracleData.answer
  }
  const token0EthValue = answer.mul(reserve0).div(BigNumber.from(10).pow(decimals0))
  if (token1 == wethAddr) {
    answer = BASE
  } else {
    const token1OracleInstance = new ethers.Contract(oracleAddrs[token1], chainlinkAggregatorAbi, provider.provider)
    const token1OracleData = await token1OracleInstance.latestRoundData()
    answer = token1OracleData.answer
  }
  const token1EthValue = answer.mul(reserve1).div(BigNumber.from(10).pow(decimals1))

  const totalExactEthValue = token0EthValue.add(token1EthValue)

  return totalExactEthValue.mul(BigNumber.from(10).pow(lpTokenDecimals)).div(totalSupply)
}

export const getFairReservesPriceAndEthValue = async (
  lpTokenAddr: string,
  provider: SignerWithAddress,
  token0OracleAddr: string,
  token1OracleAddr: string,
  wethAddr: string
): Promise<FairReservesPriceAndEthValue> => {
  BN.set({ ROUNDING_MODE: 0, DECIMAL_PLACES: 0 })
  const uniV2Instance = new ethers.Contract(lpTokenAddr, uniV2Abi, provider)
  const token0 = await uniV2Instance.token0()
  const token1 = await uniV2Instance.token1()
  const token0Instance = new ethers.Contract(token0, collTokenAbi, provider.provider)
  const token1Instance = new ethers.Contract(token1, collTokenAbi, provider.provider)
  const reserveData = await uniV2Instance.getReserves()
  const totalSupply = await uniV2Instance.totalSupply()
  const lpTokenDecimals = await uniV2Instance.decimals()
  const reserve0: BigNumber = reserveData._reserve0
  const reserve1: BigNumber = reserveData._reserve1
  const decimals0 = await token0Instance.decimals()
  const decimals1 = await token1Instance.decimals()
  const token0Factor = BigNumber.from(10).pow(decimals0)
  const token1Factor = BigNumber.from(10).pow(decimals1)
  const reserveMul = new BN(reserve0.mul(reserve1).toString())
  const sqrtK_BN_JS = reserveMul.squareRoot()
  const sqrtK = BigNumber.from(sqrtK_BN_JS.toString())
  let priceToken0: BigNumber, priceToken1: BigNumber
  if (token0 == wethAddr) {
    priceToken0 = BASE
  } else {
    const token0OracleInstance = new ethers.Contract(token0OracleAddr, chainlinkAggregatorAbi, provider.provider)
    const token0OracleData = await token0OracleInstance.latestRoundData()
    priceToken0 = token0OracleData.answer
  }
  if (token1 == wethAddr) {
    priceToken1 = BASE
  } else {
    const token1OracleInstance = new ethers.Contract(token1OracleAddr, chainlinkAggregatorAbi, provider.provider)
    const token1OracleData = await token1OracleInstance.latestRoundData()
    priceToken1 = token1OracleData.answer
  }

  const priceToken0_BN_JS = new BN(priceToken0.toString()).squareRoot()
  const priceToken1_BN_JS = new BN(priceToken1.toString()).squareRoot()
  const token0Factor_BN_JS = new BN(token0Factor.toString()).squareRoot()
  const token1Factor_BN_JS = new BN(token1Factor.toString()).squareRoot()
  const priceToken0Sqrt = BigNumber.from(priceToken0_BN_JS.toString())
  const priceToken1Sqrt = BigNumber.from(priceToken1_BN_JS.toString())
  const token0FactorSqrt = BigNumber.from(token0Factor_BN_JS.toString())
  const token1FactorSqrt = BigNumber.from(token1Factor_BN_JS.toString())

  const fairReserve0 = sqrtK.mul(priceToken1Sqrt).mul(token0FactorSqrt).div(priceToken0Sqrt.mul(token1FactorSqrt))
  const fairReserve1 = sqrtK.mul(priceToken0Sqrt).mul(token1FactorSqrt).div(priceToken1Sqrt.mul(token0FactorSqrt))

  const totalFairReserveEthValue = fairReserve0
    .mul(priceToken0)
    .div(token0Factor)
    .add(fairReserve1.mul(priceToken1).div(token1Factor))

  const fairPriceOfLpToken = totalFairReserveEthValue.mul(BigNumber.from(10).pow(lpTokenDecimals)).div(totalSupply)

  return {
    fairReserve0,
    fairReserve1,
    totalFairReserveEthValue,
    fairPriceOfLpToken
  }
}

export const getDeltaBNComparison = (exact: BigNumber, estimate: BigNumber, threshold: number): boolean => {
  const Delta = exact.sub(estimate).abs()
  const DeltaThreshold = Delta.mul(10 ** threshold).div(exact)
  return DeltaThreshold.isZero()
}

type FairReservesPriceAndEthValue = {
  fairReserve0: BigNumber
  fairReserve1: BigNumber
  totalFairReserveEthValue: BigNumber
  fairPriceOfLpToken: BigNumber
}
