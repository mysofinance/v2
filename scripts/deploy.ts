import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`Running deploy script for vault with account ${deployer.address}...`)
  const Vault = await ethers.getContractFactory("Vault")
  const vault = await Vault.connect(deployer).deploy()
  await vault.deployed()
  console.log(`Vault deployed to ${vault.address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
