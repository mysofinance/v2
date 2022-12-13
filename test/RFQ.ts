import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

const ONE_USDC = ethers.BigNumber.from("1000000");
const ONE_WETH = ethers.BigNumber.from("1000000000000000000");
const MAX_UINT128 = ethers.BigNumber.from("340282366920938463463374607431768211455");

describe("RFQ", function () {

  async function setupTest() {
    const [vaultOwner, borrower, tokenDeployer] = await ethers.getSigners()

    // deploy mempool
    const Mempool = await ethers.getContractFactory("Mempool")
    const mempool = await Mempool.deploy()
    await mempool.deployed()

    // deploy vault
    const Vault = await ethers.getContractFactory("Vault")
    await Vault.connect(vaultOwner)
    const vault = await Vault.deploy(mempool.address)
    await vault.deployed()

    // deploy test tokens
    const MyERC20 = await ethers.getContractFactory("MyERC20")

    const USDC = await MyERC20.connect(tokenDeployer)
    const usdc = await USDC.deploy("USDC", "USDC", 6)
    await usdc.deployed()

    const WETH = await MyERC20.connect(tokenDeployer)
    const weth = await WETH.deploy("WETH", "WETH", 18)
    await weth.deployed()

    // transfer some test tokens
    await usdc.mint(vaultOwner.address, ONE_USDC.mul(100000))
    await weth.mint(borrower.address, ONE_WETH.mul(10))

    return { mempool, vault, vaultOwner, borrower, tokenDeployer, usdc, weth };
  }

  describe("...", function () {
    it("...", async function () {
      const { mempool, vault, vaultOwner, borrower, tokenDeployer, usdc, weth } = await setupTest();

      // vault owner deposits usdc
      await usdc.connect(vaultOwner).approve(vault.address, MAX_UINT128);
      await vault.connect(vaultOwner).deposit(usdc.address, ONE_USDC.mul(100000))
      console.log("vault", vault.address)

      // borrower deposits into mempool
      await weth.connect(borrower).approve(mempool.address, MAX_UINT128);
      await mempool.connect(borrower).deposit(weth.address, ONE_WETH.mul(10));

      // check balances
      console.log("mempool balance: ", await weth.balanceOf(mempool.address))
      console.log("vault balance: ", await usdc.balanceOf(vault.address))

      // borrower creates loan request
      const tmpBorrower = borrower.address
      const tmpCollToken = weth.address
      const tmpLoanToken = usdc.address
      const tmpBlocknum = await ethers.provider.getBlockNumber();
      const tmpExpiry = (await ethers.provider.getBlock(tmpBlocknum)).timestamp + 60*60*24
      const tmpPledgeAmount = ONE_WETH
      const tmpLoanAmount = ONE_USDC.mul(500)
      const tmpRepayAmount = ONE_USDC.mul(510)
      const tmpValidUntil = (await ethers.provider.getBlock(tmpBlocknum)).timestamp + 60*10
      const tmpNonce = (await mempool.nonce(tmpBorrower)).add(1)

      const payload = ethers.utils.defaultAbiCoder.encode(
        [
          "address",
          "address",
          "address",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256"
        ],
        [
          tmpBorrower,
          tmpCollToken,
          tmpLoanToken,
          tmpExpiry,
          tmpPledgeAmount,
          tmpLoanAmount,
          tmpRepayAmount,
          tmpValidUntil,
          tmpNonce
        ]
      )
      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await borrower.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      console.log("payloadHash:", payloadHash)
      console.log("Signature:", sig)
      expect(recoveredAddr).to.equal(borrower.address);

      // lender executes loan request
      await vault.connect(vaultOwner).setAllowance(mempool.address, tmpLoanToken, MAX_UINT128);
      console.log("allowance ", await usdc.allowance(vault.address, mempool.address))
      const loanRequest = {
        borrower: tmpBorrower,
        collToken: tmpCollToken,
        loanToken: tmpLoanToken,
        expiry: tmpExpiry,
        pledgeAmount: tmpPledgeAmount,
        loanAmount: tmpLoanAmount,
        repayAmount: tmpRepayAmount,
        validUntil: tmpValidUntil,
        nonce: tmpNonce
      }
      await mempool.connect(vaultOwner).executeLoanRequest(loanRequest, vault.address, sig.v, sig.r, sig.s)
    });
  })

});
