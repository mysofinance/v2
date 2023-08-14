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
        signal: AbortSignal.timeout(15_000)
      })

      switch (answer.toLowerCase()) {
        case 'y':
          await setProtocolFee(signer, hardhatNetworkName, jsonConfig)
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

async function setProtocolFee(signer: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(`Setting protocol fee for address registry '${jsonConfig[hardhatNetworkName]['addressRegistry']}'.`)

  const addressRegistryAddr = jsonConfig[hardhatNetworkName]['addressRegistry']
  logger.log(`Retrieving owner from address registry at ${addressRegistryAddr}...`)
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.attach(addressRegistryAddr)
  const owner = await addressRegistry.owner()

  if (signer.address == owner) {
    logger.log(`Address registry owner is ${owner} and matches signer.`)

    const borrowerGatewayAddr = jsonConfig[hardhatNetworkName]['borrowerGateway']
    logger.log(`Retrieving borrower gateway at ${borrowerGatewayAddr}...`)
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    const borrowerGateway = await BorrowerGateway.attach(borrowerGatewayAddr)

    logger.log(`Retrieving current protocol fee params from borrower gateway...`)
    const currProtocolFeeParams = await borrowerGateway.getProtocolFeeParams()
    logger.log(`Current protocol fee params are '${currProtocolFeeParams[0]}' and '${currProtocolFeeParams[1]}'...`)

    const newProtocolFeeParams = jsonConfig[hardhatNetworkName]['protocolFeeParams']
    if (
      ethers.BigNumber.from(newProtocolFeeParams[0]).eq(currProtocolFeeParams[0]) &&
      ethers.BigNumber.from(newProtocolFeeParams[1]).eq(currProtocolFeeParams[1])
    ) {
      logger.log(`Current protocol fee params already match the target params!`)
    } else {
      await borrowerGateway.setProtocolFeeParams(newProtocolFeeParams)
      logger.log(`New protocol fee set to '${newProtocolFeeParams[0]}' and '${newProtocolFeeParams[1]}'.`)
    }
  } else {
    logger.log(`Address registry owner is ${owner} and doesn't match signer.`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
