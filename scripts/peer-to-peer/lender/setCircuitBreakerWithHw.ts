import { ethers } from 'hardhat'
import { Logger } from '../../helpers/misc'

const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)
const CHAIN_ID = 5000
const LENDER_VAULT = '0x89e056143394FBc106b752e8a4C37c8Fcc9593DA'
const CIRCUIT_BREAKER = '0x2b13a4AcFF9934f1c60582Dcd5a7db947E74AdEb'

// Create a Frame connection
const ethProvider = require('eth-provider') // eth-provider is a simple EIP-1193 provider
const frame = ethProvider('frame') // Connect to Frame
frame.setChain(CHAIN_ID)

async function main() {
  logger.log(`Starting ${path.basename(__filename)}...`)
  logger.log(`Creating frame connection for chain id ${CHAIN_ID}...`)
  const signer = (await frame.request({ method: 'eth_requestAccounts' }))[0]
  logger.log(`Signing from account ${signer}...`)

  // get tx data
  const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVaultImpl = await LenderVaultImpl.attach(LENDER_VAULT)
  const tx = await lenderVaultImpl.populateTransaction.setCircuitBreaker(CIRCUIT_BREAKER)
  const currentCircuitBreaker = await lenderVaultImpl.circuitBreaker()

  logger.log(`Setting circuit breaker on vault ${LENDER_VAULT}...`)
  logger.log(`Setting circuit breaker to ${CIRCUIT_BREAKER}...`)
  logger.log(`Current circuit breaker is ${currentCircuitBreaker}...`)

  // Set `tx.from` to current Frame account
  tx.from = signer
  // Sign and send the transaction using Frame
  await frame.request({ method: 'eth_sendTransaction', params: [tx] })
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
