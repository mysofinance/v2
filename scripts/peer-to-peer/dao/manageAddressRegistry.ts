import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { Logger, loadConfig } from '../../helpers/misc'

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

  logger.log('Running script with the following signer:', signer.address)
  logger.log('Signer ETH balance:', ethers.utils.formatEther(signerBal.toString()))
  logger.log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)

  logger.log(`Loading '${scriptName}.json' with the following config data:`)
  const jsonConfig = loadConfig(__dirname, `${scriptName}.json`)
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
          await performActions(signer, hardhatNetworkName, jsonConfig)
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

async function performActions(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.attach(jsonConfig[hardhatNetworkName]['addressRegistry'])

  logger.log('Retrieving address registry owner...')
  const owner = await addressRegistry.owner()

  if (signer.address === owner) {
    logger.log(`Registry owner is ${owner} and matches signer.`)
    const actions = jsonConfig[hardhatNetworkName]['actions']
    for (const action of actions) {
      switch (action.type) {
        case 'setWhitelistState':
          await addressRegistry.setWhitelistState(action.addresses, action.state)
          logger.log(`Whitelist state for addresses ${action.addresses} set to ${action.state}.`)
          break

        case 'setAllowedTokensForCompartment':
          await addressRegistry.setAllowedTokensForCompartment(action.compartmentImpl, action.tokens, action.allow)
          logger.log(`Allowed tokens for compartment ${action.compartmentImpl} updated.`)
          break

        case 'transferOwnership':
          await addressRegistry.transferOwnership(action.newOwnerProposal)
          logger.log(`New owner ${action.newOwnerProposal} proposed.`)
          break

        default:
          logger.log(`Unknown action type: ${action.type}`)
      }
    }
  } else {
    logger.log(`Registry owner is ${owner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
