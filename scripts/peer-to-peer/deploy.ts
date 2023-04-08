import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()

  console.log(`Running deploy script for peer-to-peer system with account ${deployer.address}...`)
  /* ************************************ */
  /* DEPLOYMENT OF SYSTEM CONTRACTS START */
  /* ************************************ */
  // deploy address registry
  const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
  const addressRegistry = await AddressRegistry.connect(deployer).deploy()
  await addressRegistry.deployed()
  console.log(`AddressRegistry deployed to ${addressRegistry.address}`)

  // deploy borrower gate way
  const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
  const borrowerGateway = await BorrowerGateway.connect(deployer).deploy(addressRegistry.address)
  await borrowerGateway.deployed()
  console.log(`BorrowerGateway deployed to ${borrowerGateway.address}`)

  // deploy quote handler
  const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
  const quoteHandler = await QuoteHandler.connect(deployer).deploy(addressRegistry.address)
  await quoteHandler.deployed()
  console.log(`QuoteHandler deployed to ${quoteHandler.address}`)

  // deploy lender vault implementation
  const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
  const lenderVaultImplementation = await LenderVaultImplementation.connect(deployer).deploy()
  await lenderVaultImplementation.deployed()
  console.log(`LenderVaultImplmentation deployed to ${lenderVaultImplementation.address}`)

  // deploy LenderVaultFactory
  const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
  const lenderVaultFactory = await LenderVaultFactory.connect(deployer).deploy(
    addressRegistry.address,
    lenderVaultImplementation.address
  )
  await lenderVaultFactory.deployed()

  // initialize address registry
  await addressRegistry
    .connect(deployer)
    .initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)

  /* ********************************** */
  /* DEPLOYMENT OF SYSTEM CONTRACTS END */
  /* ********************************** */

  /* *************************************** */
  /* DEPLOYMENT OF PERIPHERY CONTRACTS START */
  /* *************************************** */
  // compartments

  // create aave staking implementation
  const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
  const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.connect(deployer).deploy()
  await aaveStakingCompartmentImplementation.deployed()
  console.log(`AaveStakingCompartmentImplmentation deployed to ${aaveStakingCompartmentImplementation.address}`)

  // create curve staking implementation
  const CurveLPStakingCompartmentImplementation = await ethers.getContractFactory('CurveLPStakingCompartment')
  const curveLPStakingCompartmentImplementation = await CurveLPStakingCompartmentImplementation.connect(deployer).deploy()
  await curveLPStakingCompartmentImplementation.deployed()
  console.log(`CurveLPStakingCompartmentImplmentation deployed to ${curveLPStakingCompartmentImplementation.address}`)

  // create voting compartment implementation
  const VotingCompartmentImplementation = await ethers.getContractFactory('VoteCompartment')
  const votingCompartmentImplementation = await VotingCompartmentImplementation.connect(deployer).deploy()
  await votingCompartmentImplementation.deployed()
  console.log(`VotingCompartmentImplmentation deployed to ${votingCompartmentImplementation.address}`)

  /**glp compartment only utilized on arbitrum
  // create glp staking implementation
  const GlpStakingCompartmentImplementation = await ethers.getContractFactory('GLPStakingCompartment')
  const glpStakingCompartmentImplementation = await GlpStakingCompartmentImplementation.connect(deployer).deploy()
  await glpStakingCompartmentImplementation.deployed()
  console.log(`glpStakingCompartmentImplmentation deployed to ${glpStakingCompartmentImplementation.address}`)
  */

  //callbacks
  // deploy balancer v2 callbacks
  const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
  const balancerV2Looping = await BalancerV2Looping.connect(deployer).deploy()
  await balancerV2Looping.deployed()
  console.log(`BalancerV2Looping deployed to ${balancerV2Looping.address}`)

  // deploy uni v3 callback
  const UniV3Looping = await ethers.getContractFactory('UniV3Looping')
  const uniV3Looping = await UniV3Looping.connect(deployer).deploy()
  await uniV3Looping.deployed()
  console.log(`UniV3Looping deployed to ${uniV3Looping.address}`)

  /* *************************************** */
  /* DEPLOYMENT OF PERIPHERY CONTRACTS END */
  /* *************************************** */

  // whitelist callbacks and compartments
  await addressRegistry.connect(deployer).setWhitelistState([balancerV2Looping.address, uniV3Looping.address], 4)
  await addressRegistry.connect(deployer).setWhitelistState([aaveStakingCompartmentImplementation.address, curveLPStakingCompartmentImplementation.address, votingCompartmentImplementation.address], 3)

  // only on arbitrum
  //await addressRegistry.connect(deployer).setWhitelistState([glpStakingCompartmentImplementation.address], 3)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
