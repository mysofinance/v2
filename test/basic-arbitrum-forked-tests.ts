import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { collTokenAbi, gmxRewarRouterAbi } from './abi'
import { createOnChainRequest } from './helpers'

const hre = require('hardhat')

const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)

describe('Basic Forked Arbitrum Tests', function () {
  async function setupTest() {
    const [lender, borrower, team] = await ethers.getSigners()
    /* ************************************ */
    /* DEPLOYMENT OF SYSTEM CONTRACTS START */
    /* ************************************ */
    // deploy address registry
    const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
    const addressRegistry = await AddressRegistry.connect(team).deploy()
    await addressRegistry.deployed()

    // deploy borrower gate way
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    const borrowerGateway = await BorrowerGateway.connect(team).deploy(addressRegistry.address)
    await borrowerGateway.deployed()

    // deploy lender vault implementation
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVault')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(team).deploy()
    await lenderVaultImplementation.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // deploy borrower compartment factory
    const BorrowerCompartmentFactory = await ethers.getContractFactory('BorrowerCompartmentFactory')
    await BorrowerCompartmentFactory.connect(team)
    const borrowerCompartmentFactory = await BorrowerCompartmentFactory.deploy()
    await borrowerCompartmentFactory.deployed()

    // set lender vault factory, borrower gateway and borrower compartment on address registry (immutable)
    addressRegistry.setLenderVaultFactory(lenderVaultFactory.address)
    addressRegistry.setBorrowerGateway(borrowerGateway.address)
    addressRegistry.setBorrowerCompartmentFactory(borrowerCompartmentFactory.address)

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault()
    const lenderVaultAddr = await addressRegistry.registeredVaults(0)
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // prepare USDC balances
    const USDC_ADDRESS = '0x1eFB3f88Bc88f03FD1804A5C53b7141bbEf5dED8'
    const USDC_MASTER_MINTER = '0x096760f208390250649e3e8763348e783aef5562'
    const usdc = await ethers.getContractAt('IUSDC', USDC_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [USDC_MASTER_MINTER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_MASTER_MINTER]
    })
    const masterMinter = await ethers.getSigner(USDC_MASTER_MINTER)
    await usdc.connect(masterMinter).bridgeMint(lender.address, MAX_UINT128)

    // prepare WETH balance
    const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    const weth = await ethers.getContractAt('IWETH', WETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [borrower.address, '0x204FCE5E3E25026110000000'])
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(1) })

    // deploy balancer v2 callbacks
    const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
    await BalancerV2Looping.connect(lender)
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // whitelist addrs
    await expect(addressRegistry.connect(lender).toggleCallbackAddr(balancerV2Looping.address)).to.be.reverted
    await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address)

    return {
      addressRegistry,
      borrowerGateway,
      borrowerCompartmentFactory,
      lenderVaultImplementation,
      lender,
      borrower,
      team,
      usdc,
      weth,
      lenderVault,
      lenderVaultFactory,
      balancerV2Looping
    }
  }

  it('Should process GLP borrow/repay correctly with rewards', async function () {
    const { borrowerGateway, lender, borrower, team, usdc, weth, lenderVault, addressRegistry } = await setupTest()

    // create curve staking implementation
    const GlpStakingCompartmentImplementation = await ethers.getContractFactory('GLPStakingCompartment')
    await GlpStakingCompartmentImplementation.connect(team)
    const glpStakingCompartmentImplementation = await GlpStakingCompartmentImplementation.deploy()
    await glpStakingCompartmentImplementation.deployed()

    // increase borrower GLP balance
    const collTokenAddress = '0x5402B5F40310bDED796c7D0F3FF6683f5C0cFfdf' // GLP
    const rewardRouterAddress = '0xB95DB5B167D75e6d04227CfFFA61069348d271F5' // GMX: Reward Router V2
    const glpManagerAddress = '0x3963FfC9dff443c2A94f21b129D429891E32ec18' // GLP Manager
    const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

    const rewardRouterInstance = new ethers.Contract(rewardRouterAddress, gmxRewarRouterAbi, borrower.provider)

    // mint GLP token
    await weth.connect(borrower).approve(glpManagerAddress, MAX_UINT256)
    await rewardRouterInstance
      .connect(borrower)
      .mintAndStakeGlp(weth.address, ONE_WETH, BigNumber.from(0), BigNumber.from(0))

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(10000000))

    // get pre balances
    const borrowerCollBalPre = await collInstance.balanceOf(borrower.address)
    const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

    expect(borrowerCollBalPre).to.be.above(BigNumber.from(0))
    expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(10000000))

    // whitelist token pair
    await addressRegistry.connect(team).toggleTokens([collTokenAddress, usdc.address])

    // borrower approves borrower gateway
    await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    const onChainQuote = await createOnChainRequest({
      lender,
      collToken: collTokenAddress,
      loanToken: usdc.address,
      borrowerCompartmentImplementation: glpStakingCompartmentImplementation.address,
      lenderVault,
      loanPerCollUnit: ONE_USDC.mul(1000)
    })

    // borrow with on chain quote
    const collSendAmount = borrowerCollBalPre.div(2)
    const isAutoQuote = false
    const callbackAddr = '0x0000000000000000000000000000000000000000'
    const callbackData = '0x'

    // Since there is a 15 min cooldown duration after minting GLP, needs to pass for the user before transfer
    // mine 200 blocks with an interval of 60 seconds, ~3 hours
    await hre.network.provider.send('hardhat_mine', [BigNumber.from(200).toHexString(), BigNumber.from(60).toHexString()])

    const borrowWithOnChainQuoteTransaction = await borrowerGateway
      .connect(borrower)
      .borrowWithOnChainQuote(lenderVault.address, collSendAmount, onChainQuote, isAutoQuote, callbackAddr, callbackData)

    const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

    const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
      return x.event === 'Borrow'
    })

    const loanId = borrowEvent?.args?.['loanId']
    const repayAmount = borrowEvent?.args?.['initRepayAmount']

    // check balance post borrow
    const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
    const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

    expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

    // borrower approves borrower gateway
    await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // mine 50000 blocks with an interval of 60 seconds, ~1 month
    await hre.network.provider.send('hardhat_mine', [BigNumber.from(50000).toHexString(), BigNumber.from(60).toHexString()])

    // repay
    await expect(
      borrowerGateway
        .connect(borrower)
        .repay(
          { collToken: collTokenAddress, loanToken: usdc.address, loanId, repayAmount, repaySendAmount: repayAmount },
          lenderVault.address,
          callbackAddr,
          callbackData
        )
    )
      .to.emit(borrowerGateway, 'Repay')
      .withArgs(lenderVault.address, loanId, repayAmount)

    // check balance post repay
    const borrowerCollRepayBalPost = await collInstance.balanceOf(borrower.address)

    expect(borrowerCollRepayBalPost).to.be.above(borrowerCollBalPre)

    // TODO: check rewards
  })
})
