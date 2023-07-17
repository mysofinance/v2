import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { log, logFileNameWithPathP2P, loadP2PAddOnChainQuoteConfig } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')

async function main() {
  log(`Starting ${path.basename(__filename)}...`)
  log('Logging into:', logFileNameWithPathP2P)
  log('Loading signer info (check hardhat.config.ts)...')

  const [signer] = await ethers.getSigners()
  const signerBal = await ethers.provider.getBalance(signer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  log('Running script with the following signer:', signer.address)
  log('Signer ETH balance:', ethers.utils.formatEther(signerBal.toString()))
  log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  log(`Loading 'configs/createVaultConfig.json' with the following config data:`)
  const jsonConfig = loadP2PAddOnChainQuoteConfig()
  log(JSON.stringify(jsonConfig))

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
        log('Script completed.')
        break
      case 'n':
        log('Ending script.')
        break
      default:
        log('Invalid input.')
        log('Ending script.')
    }
  } finally {
    rl.close()
  }
}

async function addOnChainQuote(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  if (hardhatNetworkName in jsonConfig) {
    log(
      `Adding on-chain quote for lender vault '${jsonConfig[hardhatNetworkName]['lenderVaultAddr']}' and quote handler '${jsonConfig[hardhatNetworkName]['quoteHandler']}'.`
    )

    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    const quoteHandler = await QuoteHandler.attach(jsonConfig[hardhatNetworkName]['quoteHandler'])

    log('Retrieving vault owner from lender vault...')
    const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVault = await LenderVaultImpl.attach(jsonConfig[hardhatNetworkName]['lenderVaultAddr'])
    const vaultOwner = await lenderVault.owner()

    if (signer.address == vaultOwner) {
      log(`Vault owner is ${vaultOwner} and matches signer.`)

      for (let onChainQuote of jsonConfig[hardhatNetworkName]['onChainQuotes']) {
        log(`Adding on-chain quote...`)
        console.log(onChainQuote)
        const tx = await quoteHandler
          .connect(signer)
          .addOnChainQuote(jsonConfig[hardhatNetworkName]['lenderVaultAddr'], onChainQuote)
        const receipt = await tx.wait()
        const event = receipt.events?.find(x => {
          return x.event === 'OnChainQuoteAdded'
        })
        const quoteHash = event?.args?.['onChainQuoteHash']
        log(`Added on-chain quote with quote hash '${quoteHash}'.`)
      }
    } else {
      log(`Vault owner is ${vaultOwner} but doesn't match signer.`)
    }
  } else {
    log(`No config defined for '${hardhatNetworkName}', check '${loadP2PAddOnChainQuoteConfig}'`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
