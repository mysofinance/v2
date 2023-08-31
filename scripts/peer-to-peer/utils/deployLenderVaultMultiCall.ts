import { ethers } from 'hardhat'
import { Logger } from '../../helpers/misc'

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

  logger.log('Running deployment script with the following deployer:', deployer.address)
  logger.log('Deployer ETH balance:', ethers.utils.formatEther(deployerBal.toString()))
  logger.log(`Deploying to network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  logger.log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  const LenderVaultMultiCall = await ethers.getContractFactory('LenderVaultMultiCall')
  const lenderVaultMultiCall = await LenderVaultMultiCall.connect(deployer).deploy()
  await lenderVaultMultiCall.deployed()
  logger.log('lenderVaultMultiCall deployed at:', lenderVaultMultiCall.address)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
