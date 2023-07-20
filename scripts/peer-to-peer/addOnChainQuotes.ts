import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { Logger, loadConfig } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)

async function main() {
  logger.log(`Starting ${path.basename(__filename)}...`)
  logger.log('Loading signer info (check hardhat.config.ts)...')

  const [signer] = await ethers.getSigners()
  const signerBal = await ethers.provider.getBalance(signer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  logger.log('Running script with the following signer:', signer.address)
  logger.log('Signer ETH balance:', ethers.utils.formatEther(signerBal.toString()))
  logger.log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  logger.log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  const expectedConfigFile = `/configs/${scriptName}.json`
  logger.log(`Loading config '${expectedConfigFile}' with the following data:`)
  const jsonConfig = loadConfig(__dirname, expectedConfigFile)
  logger.log(JSON.stringify(jsonConfig[hardhatNetworkName]))
  if (hardhatNetworkName in jsonConfig) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    try {
      const answer = await rl.question('Do you want to continue the script? [y/n] ', {
        signal: AbortSignal.timeout(15_000) // 10s timeout
      })

      switch (answer.toLowerCase()) {
        case 'y':
          await addOnChainQuote(signer, hardhatNetworkName, jsonConfig)
          logger.log('Script completed.')
          break
        case 'n':
          logger.log('Ending script.')
          break
        default:
          logger.log('Invalid input.')
          logger.log('Ending script.')
      }
    } finally {
      rl.close()
    }
  } else {
    logger.log(`No config defined for '${hardhatNetworkName}'!`)
  }
}

async function addOnChainQuote(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(
    `Adding on-chain quote for lender vault '${jsonConfig[hardhatNetworkName]['lenderVaultAddr']}' and quote handler '${jsonConfig[hardhatNetworkName]['quoteHandler']}'.`
  )

  const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
  const quoteHandler = await QuoteHandler.attach(jsonConfig[hardhatNetworkName]['quoteHandler'])

  logger.log('Retrieving vault owner from lender vault...')
  const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVault = await LenderVaultImpl.attach(jsonConfig[hardhatNetworkName]['lenderVaultAddr'])
  const vaultOwner = await lenderVault.owner()

  if (signer.address == vaultOwner) {
    logger.log(`Vault owner is ${vaultOwner} and matches signer.`)
    const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
    const addressRegistry = await AddressRegistry.attach(jsonConfig[hardhatNetworkName]['addressRegistry'])

    for (let onChainQuote of jsonConfig[hardhatNetworkName]['onChainQuotes']) {
      logger.log(`Checking general quote info...`)

      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      logger.log(
        `Valid until timestamp is '${onChainQuote['generalQuoteInfo']['validUntil']}' vs block timestamp '${timestamp}'.`
      )

      if (ethers.BigNumber.from(onChainQuote['generalQuoteInfo']['validUntil']).lte(ethers.BigNumber.from(timestamp))) {
        logger.log(`Valid until date is in the past...`)
        process.exitCode = 1
      }

      const collTokenWhitelistStatus = await addressRegistry.whitelistState(onChainQuote['generalQuoteInfo']['collToken'])
      logger.log(
        `Coll token '${onChainQuote['generalQuoteInfo']['collToken']}' has whitelist status '${collTokenWhitelistStatus}!`
      )

      const loanTokenWhitelistStatus = await addressRegistry.whitelistState(onChainQuote['generalQuoteInfo']['loanToken'])
      logger.log(
        `Loan token '${onChainQuote['generalQuoteInfo']['loanToken']}' has whitelist status '${loanTokenWhitelistStatus}!`
      )

      const oracleAddrWhitelistStatus = await addressRegistry.whitelistState(onChainQuote['generalQuoteInfo']['oracleAddr'])
      logger.log(
        `Oracle '${onChainQuote['generalQuoteInfo']['oracleAddr']}' has whitelist status '${oracleAddrWhitelistStatus}!`
      )

      const compartmentWhitelistStatus = await addressRegistry.whitelistState(
        onChainQuote['generalQuoteInfo']['borrowerCompartmentImplementation']
      )
      logger.log(
        `Compartment impl '${onChainQuote['generalQuoteInfo']['borrowerCompartmentImplementation']}' has whitelist status '${compartmentWhitelistStatus}!`
      )

      logger.log(`Adding on-chain quote...`)
      const tx = await quoteHandler
        .connect(signer)
        .addOnChainQuote(jsonConfig[hardhatNetworkName]['lenderVaultAddr'], onChainQuote)
      const receipt = await tx.wait()
      const event = receipt.events?.find(x => {
        return x.event === 'OnChainQuoteAdded'
      })
      const quoteHash = event?.args?.['onChainQuoteHash']
      logger.log(`Added on-chain quote with quote hash '${quoteHash}'.`)
    }
  } else {
    logger.log(`Vault owner is ${vaultOwner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
