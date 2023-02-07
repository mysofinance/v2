import { expect } from 'chai'
import { ethers } from 'hardhat'

const hre = require("hardhat")
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60*60*24)


const balancerV2VaultAbi = [{"inputs":[{"internalType":"bytes32","name":"poolId","type":"bytes32"}],"name":"getPoolTokens","outputs":[{"internalType":"contract IERC20[]","name":"tokens","type":"address[]"},{"internalType":"uint256[]","name":"balances","type":"uint256[]"},{"internalType":"uint256","name":"lastChangeBlock","type":"uint256"}],"stateMutability":"view","type":"function"}]
const balancerV2PoolAbi = [{
  "inputs": [],
  "name": "getSwapFeePercentage",
  "outputs": [
      {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
      }
  ],
  "stateMutability": "view",
  "type": "function"
}]

function getLoopingSendAmount(collTokenFromBorrower: number, loanPerColl:number, collTokenInDexPool: number, loanTokenInDexPool: number, swapFee: number): number {
  const p = collTokenFromBorrower + loanTokenInDexPool/(loanPerColl*(1-swapFee)) - collTokenInDexPool
  const q = -collTokenInDexPool*collTokenFromBorrower
  const collTokenReceivedFromDex = -p/2 + Math.sqrt(Math.pow(p,2)/4 - q)
  return collTokenReceivedFromDex + collTokenFromBorrower
}

describe('Basic Forked Mainnet Tests', function () {
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
    await weth.connect(borrower).deposit({value: ONE_WETH.mul(1)});

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

      // Balancer V2 integration: calculate which send amount would be needed to max. lever up in 1-click
      const poolAddr = "0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8"
      const poolId = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" // look up via getPoolId() on bal pool
      const balancerV2Pool = await new ethers.Contract(poolAddr, balancerV2PoolAbi, tokenDeployer)

      const PRECISION = 10000
      const sendTolerance = BASE.mul(30).div(10000)
      const collTokenFromBorrower = ONE_WETH.mul(BASE.sub(sendTolerance)).div(BASE)
      const collTokenFromBorrowerNumber = Number(collTokenFromBorrower.mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanPerColl = Number(onChainQuote.loanPerCollUnit.mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
      const swapFee = Number((await balancerV2Pool.getSwapFeePercentage()).mul(PRECISION).div(BASE).toString()) / PRECISION
      const balancerV2Vault = await new ethers.Contract("0xBA12222222228d8Ba445958a75a0704d566BF2C8", balancerV2VaultAbi, tokenDeployer)
      const balancerV2PoolTokens = await balancerV2Vault.getPoolTokens(poolId)
      const collTokenInDexPool = Number((balancerV2PoolTokens.tokens[0] == weth.address ? balancerV2PoolTokens.balances[0] : balancerV2PoolTokens.balances[1]).mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanTokenInDexPool = Number((balancerV2PoolTokens.tokens[0] == usdc.address ? balancerV2PoolTokens.balances[0] : balancerV2PoolTokens.balances[1]).mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
      const sendAmountNumber = getLoopingSendAmount(collTokenFromBorrowerNumber, loanPerColl, collTokenInDexPool, loanTokenInDexPool, swapFee)
      const sendAmount = ethers.BigNumber.from(Math.floor(sendAmountNumber * PRECISION)).mul(ONE_WETH).div(PRECISION)
      console.log("sendAmountNumber to max. lever up: ", sendAmountNumber)
      console.log("sendAmount to max. lever up: ", sendAmount)

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(firstLenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(firstLenderVault.address)

      // borrower approves and executes quote
      await weth.connect(borrower).approve(firstLenderVault.address, MAX_UINT128)
      await usdc.connect(borrower).approve(balancerV2Looping.address, MAX_UINT128)
      const slippageTolerance = BASE.mul(30).div(10000)
      const minSwapReceive = sendAmount.sub(collTokenFromBorrower).mul(BASE.sub(slippageTolerance)).div(BASE)
      console.log("minSwapReceive: ", minSwapReceive)
      const deadline = MAX_UINT128
      const data = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [
          poolId,
          minSwapReceive,
          deadline
        ]
      )
      await firstLenderVault.connect(borrower).borrowWithOnChainQuote(onChainQuote, false, sendAmount, balancerV2Looping.address, data)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(firstLenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(firstLenderVault.address)

      const borrowerWethBalDiffActual = borrowerWethBalPre.add(borrowerWethBalPost)
      const borrowerWethBalDiffExpected = borrowerWethBalPre.sub(collTokenFromBorrower)
      const borrowerWethBalDiffComparison = Math.abs(Number(borrowerWethBalDiffActual.sub(borrowerWethBalDiffExpected).mul(PRECISION).div(borrowerWethBalDiffActual).div(ONE_WETH).toString())/PRECISION)
      expect(borrowerWethBalDiffComparison).to.be.lessThan(0.01)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(0) // borrower: no usdc change as all swapped for weth
      expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(sendAmount)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(onChainQuote.loanPerCollUnit.mul(sendAmount).div(ONE_WETH))
    })
  })
})
