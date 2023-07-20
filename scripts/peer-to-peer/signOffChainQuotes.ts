import { ethers } from 'hardhat'
import * as readline from 'readline/promises'
import { Logger, loadConfig } from '../helpers/misc'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { payloadScheme } from '../../test/peer-to-peer/helpers/abi'

const hre = require('hardhat')
const path = require('path')
const scriptName = path.parse(__filename).name
const logger = new Logger(__dirname, scriptName)

async function main() {
  logger.log(`Starting ${scriptName}...`)
  logger.log('Loading signer info (check hardhat.config.ts)...')

  const [signer] = await ethers.getSigners()
  const deployerBal = await ethers.provider.getBalance(signer.address)
  const network = await ethers.getDefaultProvider().getNetwork()
  const hardhatNetworkName = hre.network.name
  const hardhatChainId = hre.network.config.chainId

  logger.log('Running script with the following signer:', signer.address)
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
        signal: AbortSignal.timeout(15_000)
      })

      switch (answer.toLowerCase()) {
        case 'y':
          await signOffChainQuotes(signer, hardhatChainId, hardhatNetworkName, jsonConfig)
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

async function signOffChainQuotes(signer: any, hardhatChainId: any, hardhatNetworkName: string, jsonConfig: any) {
  logger.log(`Loading off-chain quote...`)
  for (let offChainQuoteInfo of jsonConfig[hardhatNetworkName]['offChainQuoteInfos']) {
    logger.log(`Checking off-chain quote info...`)

    const chainId = offChainQuoteInfo['chainId']
    logger.log(`The provided chain id '${chainId} and the hardhat config chain id is '${hardhatChainId}'.`)
    if (chainId != hardhatChainId) {
      logger.log('Note: chain ids are inconsistent!')
      logger.log('Continuing nonetheless...')
    }

    const LenderVaultImpl = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVault = await LenderVaultImpl.attach(offChainQuoteInfo['lenderVault'])
    const isSigner = await lenderVault.isSigner(signer.address)
    logger.log(
      `Signer '${signer.address}' is ${isSigner ? '' : 'not'} registered as a valid signer on '${
        offChainQuoteInfo['lenderVault']
      }'.`
    )
    if (!isSigner) {
      logger.log('Continuing nonetheless...')
    }

    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    const quoteHandler = await QuoteHandler.attach(jsonConfig[hardhatNetworkName]['quoteHandler'])
    const currNonce = await quoteHandler.offChainQuoteNonce(offChainQuoteInfo['lenderVault'])
    logger.log(
      `Current off-chain quote nonce for vault is '${currNonce}', provided nonce in config is '${offChainQuoteInfo['nonce']}'...`
    )
    if (Number(offChainQuoteInfo['nonce']) < Number(currNonce)) {
      logger.log(`Note: the provided nonce is too small and will fail!`)
      logger.log('Continuing nonetheless...')
    }

    const quoteTuples = offChainQuoteInfo['quoteTuples']
    const quoteTuplesTree = StandardMerkleTree.of(
      quoteTuples.map(quoteTuple => Object.values(quoteTuple)),
      ['uint256', 'uint256', 'uint256', 'uint256']
    )

    logger.log(`Determining merkle root of quote tuples...`)
    const quoteTuplesRoot = quoteTuplesTree.root
    logger.log(`Merkle root of quote tuples is: ${quoteTuplesRoot}`)

    logger.log(`Signing the following general quote info: ${JSON.stringify(offChainQuoteInfo['generalQuoteInfo'])}`)
    logger.log(`Signing the following quoteTuplesRoot: ${quoteTuplesRoot}`)
    logger.log(`Signing the following salt: ${offChainQuoteInfo['salt']}`)
    logger.log(`Signing the following nonce: ${offChainQuoteInfo['nonce']}`)
    logger.log(`Signing the following lenderVault: ${offChainQuoteInfo['lenderVault']}`)
    logger.log(`Signing the following chainId: ${chainId}`)

    const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
      offChainQuoteInfo['generalQuoteInfo'],
      quoteTuplesRoot,
      offChainQuoteInfo['salt'],
      offChainQuoteInfo['nonce'],
      offChainQuoteInfo['lenderVault'],
      chainId
    ])

    const payloadHash = ethers.utils.keccak256(payload)
    logger.log(`Payload hash is: ${payloadHash}`)

    logger.log('Producing signature...')
    const signature = await signer.signMessage(ethers.utils.arrayify(payloadHash))
    const sig = ethers.utils.splitSignature(signature)
    const compactSig = sig.compact
    logger.log(`Signature is: ${JSON.stringify(sig)}`)
    logger.log(`Compact signature is: ${compactSig}`)

    const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
    if (recoveredAddr == signer.address) {
      logger.log('Recovered address matches signer address.')
    } else {
      logger.log(`Note: recovered address '${recoveredAddr}' does not match signer address '${signer.address}'...`)
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
