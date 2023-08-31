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
          await setSigningPolicy(signer, hardhatNetworkName, jsonConfig)
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

async function setSigningPolicy(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(`Setting signer policy for lender vault '${jsonConfig[hardhatNetworkName]['lenderVault']}'.`)

  logger.log('Retrieving vault owner from lender vault...')
  const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVault = await LenderVaultImpl.attach(jsonConfig[hardhatNetworkName]['lenderVault'])
  const vaultOwner = await lenderVault.owner()

  if (signer.address == vaultOwner) {
    logger.log(`Vault owner is ${vaultOwner} and matches signer.`)

    // 1) check if signers shall be removed
    if (jsonConfig[hardhatNetworkName]['removeSigners']) {
      const signersToBeRemoved = jsonConfig[hardhatNetworkName]['signersToBeRemoved']
      logger.log(`Starting to remove signers: ${signersToBeRemoved}`)

      const numSigners = await lenderVault.totalNumSigners()
      const currSigners: any = {}
      for (let i = 0; i < Number(numSigners.toString()); ++i) {
        const signer = await lenderVault.signers(i)
        logger.log(`Signer '${signer}' at idx '${i}'.`)
        currSigners[signer] = i
      }

      for (let signerToBeRemoved of signersToBeRemoved) {
        const signerIdx = currSigners[signerToBeRemoved]
        if (signerIdx >= 0) {
          logger.log(`Removing signer '${signerToBeRemoved}' with idx '${signerIdx}'.`)
          await lenderVault.removeSigner(signerToBeRemoved, signerIdx)
          logger.log(`Removed.`)
        } else {
          logger.log(`Skipping address '${signerToBeRemoved}' because it isn't a signer and hence cannot be removed.`)
        }
      }
    } else {
      logger.log(`Skipping remove signers.`)
    }

    // 2) check if min number of signer threshold shall be updated
    if (jsonConfig[hardhatNetworkName]['updateMinNumOfSigners']) {
      const newMinNumOfSigners = jsonConfig[hardhatNetworkName]['newMinNumOfSigners']
      logger.log(`Starting to update min. number of signer to '${newMinNumOfSigners}'...`)

      const minNumOfSigners = await lenderVault.minNumOfSigners()
      if (minNumOfSigners == newMinNumOfSigners) {
        logger.log(`Min. number of signers is already set to '${minNumOfSigners}', skipping update.`)
      } else {
        logger.log(`Changing min. number of signers from '${minNumOfSigners}' to '${newMinNumOfSigners}'...`)
        await lenderVault.setMinNumOfSigners(newMinNumOfSigners)
        logger.log(`Min. number of signers set.`)
      }
    } else {
      logger.log('Skipping min. number of signer updates.')
    }

    // 3) check if new signers shall be added
    // note: new signers are added last to prevent potential front-running of min num signer update
    if (jsonConfig[hardhatNetworkName]['addSigners']) {
      const signersToBeAdded = jsonConfig[hardhatNetworkName]['signersToBeAdded']
      logger.log(`Starting to add signers: '${signersToBeAdded}'`)
      let canBeAdded = true
      for (let signerToBeAdded of signersToBeAdded) {
        const isSigner = await lenderVault.isSigner(signerToBeAdded)
        if (isSigner) {
          canBeAdded = false
          logger.log(`Address '${signerToBeAdded}' is already a signer...`)
          break
        }
      }
      if (canBeAdded) {
        logger.log(`Adding signers: '${signersToBeAdded}'.`)
        await lenderVault.connect(signer).addSigners(signersToBeAdded)
        logger.log(`Added.`)
      } else {
        logger.log(`Cannot add signers with given array as one of the address is already a signer.`)
      }
    } else {
      logger.log('Skipping add signers.')
    }
  } else {
    logger.log(`Vault owner is ${vaultOwner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
