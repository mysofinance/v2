import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log(`Running deploy script for vault with account ${deployer.address}...`)
  const Vault = await ethers.getContractFactory("Vault")
  const vault = await Vault.connect(deployer).deploy()
  await vault.deployed()
  console.log(`Vault deployed to ${vault.address}`)

  /*
  // deploy test tokens
  console.log(`Deploying test tokens...`)
  const MyERC20 = await ethers.getContractFactory("MyERC20")
  const usdc = await MyERC20.deploy("USDC", "USDC", 6, {nonce: 80})
  await usdc.deployed()
  console.log(`USDC deployed to ${usdc.address}`)

  const weth = await MyERC20.deploy("WETH", "WETH", 18)
  await weth.deployed()
  console.log(`WETH deployed to ${weth.address}`)
  */
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
