import { expect } from 'chai'
import { ethers } from 'hardhat'

const hre = require("hardhat")
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60*60*24)

describe('Vault and Test Token Deployment', function () {
  async function setupTest() {
    const [vaultOwner, borrower, tokenDeployer] = await ethers.getSigners()

    //deploy CompartmentFactory
    const CompartmentFactory = await ethers.getContractFactory('CollateralCompartmentFactory')
    await CompartmentFactory.connect(vaultOwner)
    const compartmentFactory = await CompartmentFactory.deploy(['0x0000000000000000000000000000000000000001'])
    await compartmentFactory.deployed()

    // deploy lenderVault
    const LenderVault = await ethers.getContractFactory('LenderVault')
    await LenderVault.connect(vaultOwner)
    const lenderVault = await LenderVault.deploy()
    await lenderVault.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    await LenderVaultFactory.connect(vaultOwner)
    const lenderVaultFactory = await LenderVaultFactory.deploy(lenderVault.address)
    await lenderVaultFactory.deployed()

    // whitelist compartment factory and create first vault
    await lenderVaultFactory.addToWhitelist(5, compartmentFactory.address)
    await lenderVaultFactory.createVault(compartmentFactory.address)

    const newlyCreatedVaultAddr = await lenderVaultFactory.registeredVaults(0);
    const firstLenderVault = await LenderVault.attach(newlyCreatedVaultAddr);

    // prepare USDC balances
    const USDC_ADDRESS ="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    const USDC_MASTER_MINTER = "0xe982615d461dd5cd06575bbea87624fda4e3de17"
    const usdc = await ethers.getContractAt("IUSDC", USDC_ADDRESS);
    await ethers.provider.send("hardhat_setBalance", [
      USDC_MASTER_MINTER,
      "0x56BC75E2D63100000",
    ]);
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDC_MASTER_MINTER],
    });
    const masterMinter = await ethers.getSigner(USDC_MASTER_MINTER);
    await usdc.connect(masterMinter).configureMinter(masterMinter.address, MAX_UINT128);
    await usdc.connect(masterMinter).mint(vaultOwner.address, MAX_UINT128);

    // prepare WETH balance
    const WETH_ADDRESS ="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    const weth = await ethers.getContractAt("IWETH", WETH_ADDRESS);
    await ethers.provider.send("hardhat_setBalance", [
      borrower.address,
      "0x204FCE5E3E25026110000000",
    ]);
    await weth.connect(borrower).deposit({value: ONE_WETH.mul(10)});

    // deploy balancer v2 callbacks
    const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
    await BalancerV2Looping.connect(vaultOwner)
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // whitelist addrs
    await lenderVaultFactory.addToWhitelist(0, usdc.address)
    await lenderVaultFactory.addToWhitelist(0, weth.address)
    await lenderVaultFactory.addToWhitelist(3, balancerV2Looping.address)

    return { lenderVault, vaultOwner, borrower, tokenDeployer, usdc, weth, firstLenderVault, balancerV2Looping }
  }

  describe('On-Chain Quote Testing', function () {
    it('Should process atomic balancer swap correctly', async function () {
      const { lenderVault, vaultOwner, borrower, tokenDeployer, usdc, weth, firstLenderVault, balancerV2Looping } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(vaultOwner).transfer(firstLenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let onChainQuote = {
        loanPerCollUnit: ONE_USDC.mul(1600),
        interestRatePctInBase: BASE.mul(10).div(100),
        upfrontFeePctInBase: BASE.mul(1).div(100),
        collToken: weth.address,
        loanToken: usdc.address,
        tenor: ONE_DAY.mul(365),
        timeUntilEarliestRepay: 0,
        isNegativeInterestRate: false,
        useCollCompartment: false
      }
      await firstLenderVault.connect(vaultOwner).setOnChainQuote(onChainQuote, 0, 0)

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(firstLenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(firstLenderVault.address)

      // borrower approves and executes quote
      await weth.connect(borrower).approve(firstLenderVault.address, MAX_UINT128)
      await usdc.connect(borrower).approve(balancerV2Looping.address, MAX_UINT128)
      const poolId = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" // look up via getPoolId() on bal pool
      const minSwapReceive = 0
      const deadline = MAX_UINT128
      const data = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [
          poolId,
          minSwapReceive,
          deadline
        ]
      )
      await firstLenderVault.connect(borrower).borrowWithOnChainQuote(onChainQuote, false, ONE_WETH.mul(2), balancerV2Looping.address, data)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(firstLenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(firstLenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    })
  })
})
