import { expect } from 'chai'
import { ethers } from 'hardhat'

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

    // deploy test tokens
    const MyERC20 = await ethers.getContractFactory('MyERC20')

    const USDC = await MyERC20.connect(tokenDeployer)
    const usdc = await USDC.deploy('USDC', 'USDC', 6)
    await usdc.deployed()

    const WETH = await MyERC20.connect(tokenDeployer)
    const weth = await WETH.deploy('WETH', 'WETH', 18)
    await weth.deployed()

    // transfer some test tokens
    await usdc.mint(vaultOwner.address, ONE_USDC.mul(100000))
    await weth.mint(borrower.address, ONE_WETH.mul(10))

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

  describe('Off-Chain Quote Testing', function () {
    it('Should process off-chain quote correctly, without possibility of replaying', async function () {
      const { lenderVault, vaultOwner, borrower, tokenDeployer, usdc, weth, firstLenderVault, balancerV2Looping } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(vaultOwner).transfer(firstLenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let offChainQuote = {
        borrower: borrower.address,
        collToken: weth.address,
        loanToken: usdc.address,
        sendAmount: ONE_WETH,
        loanAmount: ONE_USDC.mul(1000),
        expiry: timestamp + 60 * 60 * 24 * 30,
        earliestRepay: timestamp,
        repayAmount: ONE_USDC.mul(1010),
        validUntil: timestamp + 60,
        upfrontFee: ONE_WETH.mul(50).div(10000),
        useCollCompartment: false,
        nonce: 0,
        v: 0,
        r: '0x0',
        s: '0x0'
      }
      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'uint256'],
        [
          offChainQuote.borrower,
          offChainQuote.collToken,
          offChainQuote.loanToken,
          offChainQuote.sendAmount,
          offChainQuote.loanAmount,
          offChainQuote.expiry,
          offChainQuote.earliestRepay,
          offChainQuote.repayAmount,
          offChainQuote.validUntil,
          offChainQuote.upfrontFee,
          offChainQuote.useCollCompartment,
          offChainQuote.nonce
        ]
      )
      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await vaultOwner.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      console.log('payloadHash:', payloadHash)
      console.log('Signature:', sig)
      expect(recoveredAddr).to.equal(vaultOwner.address)

      // lender add sig to quote and pass to borrower
      offChainQuote.v = sig.v
      offChainQuote.r = sig.r
      offChainQuote.s = sig.s

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(firstLenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(firstLenderVault.address)

      // borrower approves and executes quote
      await weth.connect(borrower).approve(firstLenderVault.address, MAX_UINT128)
      await firstLenderVault.connect(borrower).borrowWithOffChainQuote(offChainQuote, '0x0000000000000000000000000000000000000000', '0x')

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(firstLenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(firstLenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower cannot replay quote
      await expect(firstLenderVault.connect(borrower).borrowWithOffChainQuote(offChainQuote, '0x0000000000000000000000000000000000000000', '0x')).to
        .be.reverted
    })
  })

  describe('On-Chain Quote Testing', function () {
    it('Should process on-chain quote correctly', async function () {
      const { lenderVault, vaultOwner, borrower, tokenDeployer, usdc, weth, firstLenderVault, balancerV2Looping } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(vaultOwner).transfer(firstLenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let onChainQuote = {
        loanPerCollUnit: ONE_USDC.mul(1000),
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
      await firstLenderVault.connect(borrower).borrowWithOnChainQuote(onChainQuote, false, ONE_WETH, '0x0000000000000000000000000000000000000000', '0x')

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
