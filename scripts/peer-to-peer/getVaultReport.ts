import { ethers } from 'hardhat'
import { Logger, loadConfig } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)

async function main() {
  logger.log(`Starting ${path.basename(__filename)}...`)
  logger.log('Loading signer info (check hardhat.config.ts)...')

  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  logger.log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  logger.log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  logger.log(`Loading 'configs/getVaultReportConfig.json' with the following config data:`)
  const jsonConfig = loadConfig(__dirname, `/configs/${scriptName}.json`)
  logger.log(JSON.stringify(jsonConfig))
  if (hardhatNetworkName in jsonConfig) {
    getVaultReport(hardhatNetworkName, jsonConfig)
  } else {
    logger.log(`No config defined for '${hardhatNetworkName}'!`)
  }
}

async function getVaultReport(hardhatNetworkName: string, jsonConfig: any) {
  const lenderVault = await ethers.getContractAt('ILenderVaultImpl', jsonConfig[hardhatNetworkName]['lenderVault'])

  // get owner
  const vaultOwner = await lenderVault.owner()
  logger.log(`Vault owner is ${vaultOwner}`)

  // get signer info
  const numSigners = parseInt(await ethers.provider.getStorageAt(jsonConfig[hardhatNetworkName]['lenderVault'], 1), 16)
  logger.log(`Num. signers ${numSigners}`)
  const minNumOfSigners = await lenderVault.minNumOfSigners()
  logger.log(`Vault min. number of signers is ${minNumOfSigners}`)

  for (let i = 0; i < numSigners; ++i) {
    const signer = await lenderVault.signers(i)
    logger.log(`Signer ${i} is: ${signer}`)
  }

  // get circuit breakers
  const circuitBreaker = await lenderVault.circuitBreaker()
  logger.log(`Circuit breaker is ${circuitBreaker}`)
  const reverseCircuitBreaker = await lenderVault.reverseCircuitBreaker()
  logger.log(`Reverse circuit breaker is ${reverseCircuitBreaker}`)

  // get balances
  logger.log('tokenAddr;name;symbol;balance')
  let tokenLookups: any = {}
  for (let tokenAddr of jsonConfig[hardhatNetworkName]['tokenAddrsToCheck']) {
    const token = await ethers.getContractAt('IERC20Metadata', tokenAddr)
    const name = await token.name()
    const symbol = await token.symbol()
    const decimals = await token.decimals()
    const balance = await token.balanceOf(jsonConfig[hardhatNetworkName]['lenderVault'])
    tokenLookups[tokenAddr] = { symbol: symbol, decimals: decimals }
    logger.log(`${tokenAddr};${name};${symbol};${ethers.utils.formatUnits(balance, decimals)}`)
  }

  // get loans
  const totalNumLoans = await lenderVault.totalNumLoans()
  logger.log(`Total number of loans: ${totalNumLoans}`)
  const blocknum = await ethers.provider.getBlockNumber()
  const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
  logger.log(`Current block timestamp is: ${timestamp}`)

  let openLoans = []
  let repaidLoans = []
  let defaultedLoans = []
  let defaultedAndUnlockableLoans = []
  let unlockableCollAmounts: any = {}
  for (let i = 0; i < parseInt(totalNumLoans.toString()); ++i) {
    logger.log(`Checking loan id: ${i}`)
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

  logger.log(
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
  logger.log(
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
