import { expect } from 'chai'
import { ethers } from 'hardhat'

const ONE_USDC = ethers.BigNumber.from('1000000')
const ONE_WETH = ethers.BigNumber.from('1000000000000000000')
const MAX_UINT128 = ethers.BigNumber.from('340282366920938463463374607431768211455')

describe('RFQ', function () {
  async function setupTest() {
    const [vaultOwner, borrower, tokenDeployer] = await ethers.getSigners()

    // deploy vault
    const Vault = await ethers.getContractFactory('Vault')
    await Vault.connect(vaultOwner)
    const vault = await Vault.deploy()
    await vault.deployed()

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

    return { vault, vaultOwner, borrower, tokenDeployer, usdc, weth }
  }

  describe('...', function () {
    it('...', async function () {
      const { vault, vaultOwner, borrower, tokenDeployer, usdc, weth } = await setupTest()

      // vault owner deposits usdc
      await usdc.connect(vaultOwner).transfer(vault.address, ONE_USDC.mul(100000))

      // vault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let loanQuote = {
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
        v: undefined,
        r: undefined,
        s: undefined
      }
      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          loanQuote.borrower,
          loanQuote.collToken,
          loanQuote.loanToken,
          loanQuote.sendAmount,
          loanQuote.loanAmount,
          loanQuote.expiry,
          loanQuote.earliestRepay,
          loanQuote.repayAmount,
          loanQuote.validUntil,
          loanQuote.upfrontFee
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
      loanQuote.v = sig.v
      loanQuote.r = sig.r
      loanQuote.s = sig.s

      // borrower approves vault
      await weth.connect(borrower).approve(vault.address, MAX_UINT128)

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(vault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(vault.address)

      // borrower executes quote
      const tx = await vault.connect(borrower).borrowWithQuote(loanQuote, '0x0000000000000000000000000000000000000000', '0x')

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(vault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(vault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower cannot replay quote
      await expect(vault.connect(borrower).borrowWithQuote(loanQuote, '0x0000000000000000000000000000000000000000', '0x')).to
        .be.reverted
    })
  })
})
