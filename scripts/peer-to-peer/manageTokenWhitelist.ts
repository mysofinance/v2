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
  logger.log(`Loading 'configs/manageTokenWhitelistConfig.json' with the following config data:`)
  const jsonConfig = loadConfig(__dirname, `/configs/${scriptName}.json`)
  logger.log(JSON.stringify(jsonConfig))
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
          await addTokenToWhitelist(signer, hardhatNetworkName, jsonConfig)
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

async function addTokenToWhitelist(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.attach(jsonConfig[hardhatNetworkName]['addressRegistry'])

  logger.log('Retrieving adress registry owner...')
  const owner = await addressRegistry.owner()

  if (signer.address == owner) {
    logger.log(`Registry owner is ${owner} and matches signer.`)
    if (jsonConfig[hardhatNetworkName]['tokenWhitelist']['tokenAddrs'].length > 0) {
      logger.log(
        `Setting token whitelist to '${jsonConfig[hardhatNetworkName]['tokenWhitelist']['isWhitelisted']}' for token addresses: ${jsonConfig[hardhatNetworkName]['tokenWhitelist']['tokenAddrs']}`
      )
      const tx = await addressRegistry.setWhitelistState(
        jsonConfig[hardhatNetworkName]['tokenWhitelist']['tokenAddrs'],
        jsonConfig[hardhatNetworkName]['tokenWhitelist']['isWhitelisted'] ? 1 : 0
      )
      const receipt = await tx.wait()
      const whitelistStateUpdatedEvent = receipt.events?.find(x => {
        return x.event === 'WhitelistStateUpdated'
      })
      const whitelistAddrs = whitelistStateUpdatedEvent?.args?.['whitelistAddrs']
      const whitelistState = whitelistStateUpdatedEvent?.args?.['whitelistState']
      logger.log(`Whitelisted address '${whitelistAddrs}' set to whitelist state '${whitelistState}'.`)
    } else {
      logger.log(`Empty token whitelist, check config!`)
    }
  } else {
    logger.log(`Registry owner is ${owner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
