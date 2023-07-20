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
        signal: AbortSignal.timeout(15_000)
      })

      switch (answer.toLowerCase()) {
        case 'y':
          await deleteOnChainQuote(signer, hardhatNetworkName, jsonConfig)
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

async function deleteOnChainQuote(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(
    `Deleting on-chain quote for lender vault '${jsonConfig[hardhatNetworkName]['lenderVault']}' and quote handler '${jsonConfig[hardhatNetworkName]['quoteHandler']}'.`
  )

  const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
  const quoteHandler = await QuoteHandler.attach(jsonConfig[hardhatNetworkName]['quoteHandler'])

  logger.log('Retrieving vault owner from lender vault...')
  const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVault = await LenderVaultImpl.attach(jsonConfig[hardhatNetworkName]['lenderVault'])
  const vaultOwner = await lenderVault.owner()

  if (signer.address == vaultOwner) {
    logger.log(`Vault owner is ${vaultOwner} and matches signer.`)

    for (let onChainQuotesToBeDeleted of jsonConfig[hardhatNetworkName]['onChainQuotesToBeDeleted']) {
      logger.log(
        `Initiating deletion of on-chain quote with the following info: ${JSON.stringify(onChainQuotesToBeDeleted)}`
      )
      logger.log(`Checking whether on-chain quote with hash '${onChainQuotesToBeDeleted['onChainQuoteHash']}' exists...`)
      const isOnChainQuote = await quoteHandler.isOnChainQuote(
        jsonConfig[hardhatNetworkName]['lenderVault'],
        onChainQuotesToBeDeleted['onChainQuoteHash']
      )
      if (isOnChainQuote) {
        logger.log(`On-chain quote found.`)
        logger.log(`Deleting on-chain quote...`)
        const tx = await quoteHandler
          .connect(signer)
          .deleteOnChainQuote(jsonConfig[hardhatNetworkName]['lenderVault'], onChainQuotesToBeDeleted['onChainQuote'])
        const receipt = await tx.wait()
        const event = receipt.events?.find(x => {
          return x.event === 'OnChainQuoteDeleted'
        })
        logger.log(`On-chain quote deleted.`)
      } else {
        logger.log(`On-chain quote not found.`)
        logger.log(`Skipping.`)
      }
    }
  } else {
    logger.log(`Vault owner is ${vaultOwner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
