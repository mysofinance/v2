import { ethers } from 'hardhat'
import { Logger, loadConfig } from '../../helpers/misc'

const hre = require('hardhat')
const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)

async function main() {
  logger.log(`Starting ${path.basename(__filename)}...`)
  logger.log('Loading signer info (check hardhat.config.ts)...')

  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  logger.log(`Interacting with network '${hardhatNetworkName}' (default provider network name '${network.name}')`)
  logger.log(`Configured chain id '${hardhatChainId}' (default provider config chain id '${network.chainId}')`)
  const expectedConfigFile = `${scriptName}.json`
  logger.log(`Loading config '${expectedConfigFile}' with the following data:`)
  const jsonConfig = loadConfig(__dirname, expectedConfigFile)
  logger.log(JSON.stringify(jsonConfig[hardhatNetworkName]))
  if (hardhatNetworkName in jsonConfig) {
    getCoreAddresses(hardhatNetworkName, jsonConfig)
  } else {
    logger.log(`No config defined for '${hardhatNetworkName}'!`)
  }
}

async function getCoreAddresses(hardhatNetworkName: string, jsonConfig: any) {
  const addressRegistry = await ethers.getContractAt('AddressRegistry', jsonConfig[hardhatNetworkName]['addressRegistry'])
  const quoteHandler = await addressRegistry.quoteHandler()
  const borrowerGateWayAddr = await addressRegistry.borrowerGateway()
  const lenderVaultFactory = await addressRegistry.lenderVaultFactory()
  const currOwner = await addressRegistry.owner()
  const pendingOwner = await addressRegistry.pendingOwner()
  logger.log(`Quote handler address is ${quoteHandler}`)
  logger.log(`Borrower gateway address is ${borrowerGateWayAddr}`)
  logger.log(`Lender vault factory address is ${lenderVaultFactory}`)
  logger.log(`Address registry owner is ${currOwner}`)
  logger.log(`Address registry pending owner is ${pendingOwner}`)

  const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
  const borrowerGateway = await BorrowerGateway.attach(borrowerGateWayAddr)
  const protocolFees = await borrowerGateway.getProtocolFeeParams()
  logger.log(`Current protocol fee params are: ${JSON.stringify(protocolFees)}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
