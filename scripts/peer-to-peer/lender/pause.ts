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
  const hardhatChainId = hre.network.config.chainId

  logger.log('Running script with the following signer:', signer.address)
  logger.log('Signer ETH balance:', ethers.utils.formatEther(signerBal.toString()))
  logger.log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  logger.log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  const expectedConfigFile = `/${scriptName}.json`
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
          await circuitBreaker(signer, hardhatNetworkName, jsonConfig)
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

async function circuitBreaker(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(`Running circuit breaker script on lender vault '${jsonConfig[hardhatNetworkName]['lenderVault']}'.`)

  logger.log('Retrieving circuit breaker from lender vault...')
  const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVault = await LenderVaultImpl.attach(jsonConfig[hardhatNetworkName]['lenderVault'])

  const owner = await lenderVault.owner()
  logger.log(`Vault owner is ${owner}.`)

  const circuitBreaker = await lenderVault.circuitBreaker()
  logger.log(`Registered circuit breaker is ${circuitBreaker}.`)

  logger.log('Retrieving reverse circuit breaker from lender vault...')
  const reverseCircuitBreaker = await lenderVault.reverseCircuitBreaker()
  logger.log(`Registered reverse circuit breaker is ${reverseCircuitBreaker}.`)

  logger.log('Retrieving pause state...')
  const isPaused = await lenderVault.paused()
  logger.log(`Lender vault is ${isPaused ? '' : 'not'} paused.`)

  if (jsonConfig[hardhatNetworkName]['unpauseVault'] == jsonConfig[hardhatNetworkName]['pauseVault']) {
    logger.log(`Invalid config!`)
  } else if (isPaused && jsonConfig[hardhatNetworkName]['pauseVault']) {
    logger.log(`Nothing to do, vault already paused.`)
  } else if (!isPaused && jsonConfig[hardhatNetworkName]['unpauseVault']) {
    logger.log(`Nothing to do, vault already unpaused.`)
  } else if (isPaused && jsonConfig[hardhatNetworkName]['unpauseVault']) {
    if (signer.address == reverseCircuitBreaker || signer.address == owner) {
      logger.log(`Unpausing vault as ${signer.address == reverseCircuitBreaker ? 'reverse circuite breaker' : 'owner'}...`)
      await lenderVault.unpauseQuotes()
      logger.log(`All quotes unpaused.`)
    } else {
      logger.log(`Invalid signer ${signer.address}, neither matches reverse circuit breaker nor owner.`)
    }
  } else if (!isPaused && jsonConfig[hardhatNetworkName]['pauseVault']) {
    if (signer.address == circuitBreaker || signer.address == owner) {
      logger.log(`Pausing vault as ${signer.address == circuitBreaker ? 'circuite breaker' : 'owner'}...`)
      await lenderVault.pauseQuotes()
      logger.log(`All quotes paused`)
    } else {
      logger.log(`Invalid signer ${signer.address}, neither matches circuit breaker nor owner.`)
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
