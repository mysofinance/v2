import { BigNumber, ethers } from 'ethers'
import { computePoolAddress, FeeAmount } from '@uniswap/v3-sdk'
import { Token } from '@uniswap/sdk-core'

const hre = require("hardhat");

const quoterAbi = [{"inputs":[{"internalType":"address","name":"tokenIn","type":"address"},{"internalType":"address","name":"tokenOut","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}],"name":"quoteExactInputSingle","outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}]

const poolAbi = [{inputs:[],name:'token0',outputs:[{internalType:'address',name:'',type:'address'}],'stateMutability':'view',type:'function'},{inputs:[],name:'token1',outputs:[{internalType:'address',name:'',type:'address'}],stateMutability:'view',type:'function'}, {inputs:[],name:'fee',outputs:[{internalType:'uint24',name:'',type:'uint24'}],stateMutability:'view',type:'function'}]

const POOL_FACTORY_CONTRACT_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const QUOTER_CONTRACT_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
const READABLE_FORM_LEN = 4

export async function getOutGivenIn(inAmount: string, tokenIn: Token, tokenOut: Token, poolFee: FeeAmount): Promise<string> {
  const quoterContract = new ethers.Contract(
    QUOTER_CONTRACT_ADDRESS,
    quoterAbi,
    hre.ethers.provider
  )
  const poolConstants = await getPoolConstants(tokenIn, tokenOut, poolFee)

  const quotedRequiredIn = await quoterContract.callStatic.quoteExactInputSingle(
    poolConstants.token0,
    poolConstants.token1,
    poolConstants.fee,
    inAmount,
    0
  )

  return quotedRequiredIn
}

async function getPoolConstants(tokenIn: Token, tokenOut: Token, poolFee: FeeAmount): Promise<{
  token0: string
  token1: string
  fee: number
}> {
  const currentPoolAddress = computePoolAddress({
    factoryAddress: POOL_FACTORY_CONTRACT_ADDRESS,
    tokenA: tokenIn,
    tokenB: tokenOut,
    fee: poolFee,
  })

  const poolContract = new ethers.Contract(
    currentPoolAddress,
    poolAbi,
    hre.ethers.provider
  )
  const [token0, token1, fee] = await Promise.all([
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
  ])

  return {
    token0,
    token1,
    fee,
  }
}

export function fromReadableAmount(
    amount: number,
    decimals: number
  ): BigNumber {
    return ethers.utils.parseUnits(amount.toString(), decimals)
  }
  
export function toReadableAmount(rawAmount: number, decimals: number): string {
return ethers.utils
    .formatUnits(rawAmount, decimals)
    .slice(0, READABLE_FORM_LEN)
}