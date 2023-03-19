import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()

  console.log(`Running deploy script for peer-to-peer system with account ${deployer.address}...`)
  /* ************************************ */
  /* DEPLOYMENT OF SYSTEM CONTRACTS START */
  /* ************************************ */
  // deploy loan proposal implementation
  const LoanProposalImpl = await ethers.getContractFactory('LoanProposalImpl')
  const loanProposalImpl = await LoanProposalImpl.connect(deployer).deploy()
  await loanProposalImpl.deployed()
  console.log(`LoanProposalImpl deployed to ${loanProposalImpl.address}`)

  // deploy loan proposal factory
  const LoanProposalFactory = await ethers.getContractFactory('LoanProposalFactory')
  const loanProposalFactory = await LoanProposalFactory.connect(deployer).deploy(loanProposalImpl.address)
  await loanProposalFactory.deployed()
  console.log(`LoanProposalFactory deployed to ${loanProposalFactory.address}`)

  //example funding pool with usdc as deposit token
  const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const FundingPool = await ethers.getContractFactory('FundingPool')
  const fundingPool = await FundingPool.deploy(loanProposalFactory.address, USDC_ADDRESS)
  await fundingPool.deployed()
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
