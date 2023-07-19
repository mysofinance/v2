import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { Logger, loadConfig, saveDeployedContracts } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)

async function main() {
  logger.log(`Starting ${scriptName}...`)
  logger.log('Loading signer info (check hardhat.config.ts)...')

  const [deployer] = await ethers.getSigners()
  const deployerBal = await ethers.provider.getBalance(deployer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  logger.log('Running script with the following deployer:', deployer.address)
  logger.log('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  logger.log(`Deploying to network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
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
          await createVault(deployer, hardhatNetworkName, jsonConfig)
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

async function createVault(deployer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(
    `Deploying new vault using lender vault factory with address '${jsonConfig[hardhatNetworkName]['lenderVaultFactory']}' and salt '${jsonConfig[hardhatNetworkName]['salt']}'.`
  )
  logger.log('Note that salt must be unique per deployer/sender, otherwise tx will fail!')
  const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
  const lenderVaultFactory = await LenderVaultFactory.attach(jsonConfig[hardhatNetworkName]['lenderVaultFactory'])
  const tx = await lenderVaultFactory.connect(deployer).createVault(jsonConfig[hardhatNetworkName]['salt'])
  logger.log('Waiting for NewVaultCreated...')
  const receipt = await tx.wait()
  const newVaultCreatedEvent = receipt.events?.find(x => {
    return x.event === 'NewVaultCreated'
  })
  const newVaultAddr = newVaultCreatedEvent?.args?.['newLenderVaultAddr']
  logger.log(`New vault created with address '${newVaultAddr}' and salt '${jsonConfig[hardhatNetworkName]['salt']}'.`)

  logger.log('Saving contracts to json...')
  saveDeployedContracts({ newVaultAddr: newVaultAddr }, path.join(__dirname, 'output/'), scriptName)
  logger.log('Saving completed.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
