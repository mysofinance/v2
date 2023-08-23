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
          await withdraw(signer, hardhatNetworkName, jsonConfig)
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

async function withdraw(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(`Withdrawing from lender vault '${jsonConfig[hardhatNetworkName]['lenderVault']}'.`)

  logger.log('Retrieving vault owner from lender vault...')
  const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVault = await LenderVaultImpl.attach(jsonConfig[hardhatNetworkName]['lenderVault'])
  const vaultOwner = await lenderVault.owner()

  if (signer.address == vaultOwner) {
    logger.log(`Vault owner is ${vaultOwner} and matches signer.`)

    for (let withdrawalInstruction of jsonConfig[hardhatNetworkName]['withdrawalInstructions']) {
      logger.log(`Initiating withdrawal...`)
      const tx = await lenderVault.connect(signer).withdraw(withdrawalInstruction['token'], withdrawalInstruction['amount'])
      const receipt = await tx.wait()
      const event = receipt.events?.find(x => {
        return x.event === 'Withdrew'
      })
      const tokenAddr = event?.args?.['tokenAddr']
      const withdrawAmount = event?.args?.['withdrawAmount']

      logger.log(`Withdrew '${withdrawAmount}' of token '${tokenAddr}'.`)
    }
  } else {
    logger.log(`Vault owner is ${vaultOwner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
