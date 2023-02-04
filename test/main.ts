import { expect } from 'chai'
import { ethers } from 'hardhat'

const ONE_USDC = ethers.BigNumber.from('1000000')
const ONE_WETH = ethers.BigNumber.from('1000000000000000000')
const MAX_UINT128 = ethers.BigNumber.from('340282366920938463463374607431768211455')

describe('RFQ', function () {
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
    const lenderVault = await LenderVault.deploy(compartmentFactory.address)
    await lenderVault.deployed()

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

    return { lenderVault, vaultOwner, borrower, tokenDeployer, usdc, weth }
  }

  describe('...', function () {
    it('...', async function () {
      const { lenderVault, vaultOwner, borrower, tokenDeployer, usdc, weth } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(vaultOwner).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote

      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let loanOffChainQuote = {
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
          loanOffChainQuote.borrower,
          loanOffChainQuote.collToken,
          loanOffChainQuote.loanToken,
          loanOffChainQuote.sendAmount,
          loanOffChainQuote.loanAmount,
          loanOffChainQuote.expiry,
          loanOffChainQuote.earliestRepay,
          loanOffChainQuote.repayAmount,
          loanOffChainQuote.validUntil,
          loanOffChainQuote.upfrontFee,
          loanOffChainQuote.useCollCompartment,
          loanOffChainQuote.nonce
        ]
      )
      
      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await vaultOwner.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      console.log('payloadHash:', payloadHash)
      console.log('Signature:', sig)
      expect(recoveredAddr).to.equal(vaultOwner.address)

      // borrower adds sig to quote
      loanOffChainQuote.v = sig.v
      loanOffChainQuote.r = sig.r
      loanOffChainQuote.s = sig.s

      // borrower approves lenderVault
      await weth.connect(borrower).approve(lenderVault.address, MAX_UINT128)

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower executes quote
      const tx = await lenderVault.connect(borrower).borrowWithOffChainQuote(loanOffChainQuote, '0x0000000000000000000000000000000000000000', '0x')

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower cannot replay quote
      await expect(lenderVault.connect(borrower).borrowWithOffChainQuote(loanOffChainQuote, '0x0000000000000000000000000000000000000000', '0x')).to
        .be.reverted
    })
  })
})
