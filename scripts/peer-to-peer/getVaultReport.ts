import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { log, logFileNameWithPathP2P, loadP2PVaultReportConfig } from '../helpers/misc'
import { StringSupportOption } from 'prettier'

type Loan = {
  collToken: string
  loanToken: String
  expiry: BigNumber
  earliestRepay: BigNumber
  initCollAmount: BigNumber
  initLoanAmount: BigNumber
  initRepayAmount: BigNumber
  amountRepaidSoFar: BigNumber
  amountReclaimedSoFar: BigNumber
  collUnlocked: boolean
  collTokenCompartmentAddr: string
}

const hre = require('hardhat')
const path = require('path')

async function main() {
  log(`Starting ${path.basename(__filename)}...`)
  log('Logging into:', logFileNameWithPathP2P)
  log('Loading signer info (check hardhat.config.ts)...')

  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  log(`Loading 'configs/getVaultReportConfig.json' with the following config data:`)
  const jsonConfig = loadP2PVaultReportConfig()
  log(JSON.stringify(jsonConfig))
  if (hardhatNetworkName in jsonConfig) {
    getVaultReport(hardhatNetworkName, jsonConfig)
  } else {
    log(`No config defined for '${hardhatNetworkName}'!`)
  }
}

async function getVaultReport(hardhatNetworkName: string, jsonConfig: any) {
  const lenderVault = await ethers.getContractAt('ILenderVaultImpl', jsonConfig[hardhatNetworkName]['lenderVault'])

  // get owner
  const vaultOwner = await lenderVault.owner()
  log(`Vault owner is ${vaultOwner}`)

  // get signer info
  const numSigners = parseInt(await ethers.provider.getStorageAt(jsonConfig[hardhatNetworkName]['lenderVault'], 1), 16)
  log(`Num. signers ${numSigners}`)
  const minNumOfSigners = await lenderVault.minNumOfSigners()
  log(`Vault min. number of signers is ${minNumOfSigners}`)

  for (let i = 0; i < numSigners; ++i) {
    const signer = await lenderVault.signers(i)
    log(`Signer ${i} is: ${signer}`)
  }

  // get circuit breakers
  const circuitBreaker = await lenderVault.circuitBreaker()
  log(`Circuit breaker is ${circuitBreaker}`)
  const reverseCircuitBreaker = await lenderVault.reverseCircuitBreaker()
  log(`Reverse circuit breaker is ${reverseCircuitBreaker}`)

  // get balances
  log('tokenAddr;name;symbol;balance')
  let tokenLookups: any = {}
  for (let tokenAddr of jsonConfig[hardhatNetworkName]['tokenAddrsToCheck']) {
    const token = await ethers.getContractAt('IERC20Metadata', tokenAddr)
    const name = await token.name()
    const symbol = await token.symbol()
    const decimals = await token.decimals()
    const balance = await token.balanceOf(jsonConfig[hardhatNetworkName]['lenderVault'])
    tokenLookups[tokenAddr] = { symbol: symbol, decimals: decimals }
    log(`${tokenAddr};${name};${symbol};${ethers.utils.formatUnits(balance, decimals)}`)
  }

  // get loans
  const totalNumLoans = await lenderVault.totalNumLoans()
  log(`Total number of loans: ${totalNumLoans}`)
  const blocknum = await ethers.provider.getBlockNumber()
  const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
  log(`Current block timestamp is: ${timestamp}`)

  let openLoans = []
  let repaidLoans = []
  let defaultedLoans = []
  let defaultedAndUnlockableLoans = []
  let unlockableCollAmounts: any = {}
  for (let i = 0; i < parseInt(totalNumLoans.toString()); ++i) {
    log(`Checking loan id: ${i}`)
    const loan = await lenderVault.loan(i)
    const repaid = loan.initRepayAmount == loan.amountRepaidSoFar
    const expired = ethers.BigNumber.from(loan.expiry).lte(ethers.BigNumber.from(timestamp))
    const open = !repaid && !expired

    if (open) {
      openLoans.push({ loanId: i, loanInfo: loan })
    } else if (repaid) {
      repaidLoans.push({ loanId: i, loanInfo: loan })
    } else {
      if (!loan.collUnlocked) {
        defaultedAndUnlockableLoans.push({ loanId: i, loanInfo: loan })
        const unlockableColl = loan.initCollAmount.sub(loan.amountReclaimedSoFar)
        if (loan.collToken in unlockableColl) {
          unlockableCollAmounts['loan.collToken'].push(unlockableColl)
        } else {
          unlockableCollAmounts['loan.collToken'] = [unlockableColl]
        }
      } else {
        defaultedLoans.push({ loanId: i, loanInfo: loan })
      }
    }
  }

  log(
    'loanId;status;borrower;collToken;loanToken;expiry;earliestRepay;initCollAmount;initLoanAmount;initRepayAmount;initRepaidSoFar;amountReclaimedSoFar;collUnlocked;collTokenCompartmentAddr'
  )
  for (let openLoan of openLoans) {
    logLoan(openLoan['loanId'], 'open', openLoan['loanInfo'], tokenLookups)
  }

  for (let repaidLoan of repaidLoans) {
    logLoan(repaidLoan['loanId'], 'repaid', repaidLoan['loanInfo'], tokenLookups)
  }

  for (let defaultedAndUnlockableLoan of defaultedAndUnlockableLoans) {
    logLoan(
      defaultedAndUnlockableLoan['loanId'],
      'defaultedAndUnlockable',
      defaultedAndUnlockableLoan['loanInfo'],
      tokenLookups
    )
  }

  for (let defaultedLoan of defaultedLoans) {
    logLoan(defaultedLoan['loanId'], 'defaulted', defaultedLoan['loanInfo'], tokenLookups)
  }
}

function logLoan(loanId: number, status: string, loan: any, tokenLookups: any) {
  const collTokenSymbol = tokenLookups[loan.collToken]['symbol']
  const loanTokenSymbol = tokenLookups[loan.loanToken]['symbol']
  const initCollAmount = ethers.utils.formatUnits(loan.initCollAmount.toString(), tokenLookups[loan.collToken]['decimals'])
  const initLoanAmount = ethers.utils.formatUnits(loan.initLoanAmount.toString(), tokenLookups[loan.loanToken]['decimals'])
  const initRepayAmount = ethers.utils.formatUnits(loan.initRepayAmount.toString(), tokenLookups[loan.loanToken]['decimals'])
  const amountRepaidSoFar = ethers.utils.formatUnits(
    loan.amountRepaidSoFar.toString(),
    tokenLookups[loan.loanToken]['decimals']
  )
  const amountReclaimedSoFar = ethers.utils.formatUnits(
    loan.amountReclaimedSoFar.toString(),
    tokenLookups[loan.collToken]['decimals']
  )
  log(
    `${loanId};${status};${
      loan.borrower
    };${collTokenSymbol};${loanTokenSymbol};${loan.expiry.toString()};${loan.earliestRepay.toString()};${initCollAmount};${initLoanAmount};${initRepayAmount};${amountRepaidSoFar};${amountReclaimedSoFar};${
      loan.collUnlocked
    };${loan.collTokenCompartmentAddr}`
  )
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
