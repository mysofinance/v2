import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { log, logFileNameWithPathP2P, loadP2PCreateVaultConfig } from '../helpers/misc'

const hre = require('hardhat')
const path = require('path')

async function main() {
  log(`Starting ${path.basename(__filename)}...`)
  log('Logging into:', logFileNameWithPathP2P)
  log('Loading signer info (check hardhat.config.ts)...')

  const [deployer] = await ethers.getSigners()
  const deployerBal = await ethers.provider.getBalance(deployer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  log('Running script with the following deployer:', deployer.address)
  log('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  log(`Deploying to network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  log(`Loading 'configs/createVaultConfig.json' with the following config data:`)
  const jsonConfig = loadP2PCreateVaultConfig()
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
        await createVault(deployer, hardhatNetworkName, jsonConfig)
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

async function createVault(deployer: any, hardhatNetworkName: string, jsonConfig: any) {
  if (hardhatNetworkName in jsonConfig) {
    log(
      `Deploying new vault using lender vault factory with address '${jsonConfig[hardhatNetworkName]['lenderVaultFactory']}' and salt '${jsonConfig[hardhatNetworkName]['salt']}'.`
    )
    log('Note that salt must be unique per deployer/sender, otherwise tx will fail!')
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.attach(jsonConfig[hardhatNetworkName]['lenderVaultFactory'])
    const tx = await lenderVaultFactory.connect(deployer).createVault(jsonConfig[hardhatNetworkName]['salt'])
    log('Waiting for NewVaultCreated...')
    const receipt = await tx.wait()
    const newVaultCreatedEvent = receipt.events?.find(x => {
      return x.event === 'NewVaultCreated'
    })
    const newVaultAddr = newVaultCreatedEvent?.args?.['newLenderVaultAddr']
    log(`New vault created with address '${newVaultAddr}' and salt '${jsonConfig[hardhatNetworkName]['salt']}'.`)
  } else {
    log(`No config defined for '${hardhatNetworkName}', check '${loadP2PCreateVaultConfig}'`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
