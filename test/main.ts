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

    // deploy vault
    const Vault = await ethers.getContractFactory("Vault")
    await Vault.connect(vaultOwner)
    const vault = await Vault.deploy("0x0000000000000000000000000000000000000000")
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

    return { vault, vaultOwner, borrower, tokenDeployer, usdc, weth };
  }

  describe("...", function () {
    it("...", async function () {
      const { vault, vaultOwner, borrower, tokenDeployer, usdc, weth } = await setupTest();

      // vault owner deposits usdc
      //await usdc.connect(vaultOwner).approve(vault.address, MAX_UINT128);
      //await vault.connect(vaultOwner).deposit(usdc.address, ONE_USDC.mul(100000))
      console.log("vault", vault.address)

      const lendingConfig = {
        minRate: 0,
        maxRate: MAX_UINT128,
        spread: 0,
        ltv: "900000000000000000000000000",
        minLoanSize: 0,
        minTenor: 0,
        maxTenor: 60*60*24*30
      }
      await vault.connect(vaultOwner).setLendingConfig(["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"], lendingConfig)

      // lender executes loan request
      await vault.quote(["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"], "1000000000000000000", 60*60*24*10);
    });
  })

});
