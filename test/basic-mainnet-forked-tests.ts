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
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(addressRegistry.address, lenderVaultImplementation.address)
    await lenderVaultFactory.deployed()

    // set lender vault factory on address registry (immutable) 
    addressRegistry.setLenderVaultFactory(lenderVaultFactory.address)
    addressRegistry.setBorrowerGateway(borrowerGateway.address)
    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault()
    const lenderVaultAddr = await addressRegistry.registeredVaults(0)
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

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
    await usdc.connect(masterMinter).mint(lender.address, MAX_UINT128);

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
    await BalancerV2Looping.connect(lender)
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // whitelist addrs
    await addressRegistry.connect(team).toggleTokenPair(weth.address, usdc.address)
    await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address)

    return { addressRegistry, borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping }
  }

  describe('On-Chain Quote Testing', function () {
    it('Should process atomic balancer swap correctly', async function () {
      const { addressRegistry, borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

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
      await lenderVault.connect(lender).addOnChainQuote(onChainQuote)

      // Balancer V2 integration: calculate which send amount would be needed to max. lever up in 1-click
      const poolAddr = "0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8"
      const poolId = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" // look up via getPoolId() on bal pool
      const balancerV2Pool = await new ethers.Contract(poolAddr, balancerV2PoolAbi, team) // could be any signer, here used team

      const PRECISION = 10000
      const collBuffer = BASE.mul(990).div(1000)
      const initCollFromBorrower = ONE_WETH.mul(collBuffer).div(BASE)
      const initCollFromBorrowerNumber = Number(initCollFromBorrower.mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanPerColl = Number(onChainQuote.loanPerCollUnit.mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
      const swapFee = Number((await balancerV2Pool.getSwapFeePercentage()).mul(PRECISION).div(BASE).toString()) / PRECISION
      const balancerV2Vault = await new ethers.Contract("0xBA12222222228d8Ba445958a75a0704d566BF2C8", balancerV2VaultAbi, team) // could be any signer, here used team
      const balancerV2PoolTokens = await balancerV2Vault.getPoolTokens(poolId)
      const collTokenInDexPool = Number((balancerV2PoolTokens.tokens[0] == weth.address ? balancerV2PoolTokens.balances[0] : balancerV2PoolTokens.balances[1]).mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanTokenInDexPool = Number((balancerV2PoolTokens.tokens[0] == usdc.address ? balancerV2PoolTokens.balances[0] : balancerV2PoolTokens.balances[1]).mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
      const collSendAmountNumber = getLoopingSendAmount(initCollFromBorrowerNumber, loanPerColl, collTokenInDexPool, loanTokenInDexPool, swapFee)
      const collSendAmount = ethers.BigNumber.from(Math.floor(collSendAmountNumber * PRECISION)).mul(ONE_WETH).div(PRECISION)
      console.log("sendAmountNumber to max. lever up: ", collSendAmountNumber)
      console.log("sendAmount to max. lever up: ", collSendAmount)

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const isAutoQuote = false
      const slippageTolerance = BASE.mul(30).div(10000)
      const minSwapReceive = collSendAmount.sub(initCollFromBorrower).mul(BASE.sub(slippageTolerance)).div(BASE)
      console.log("minSwapReceive: ", minSwapReceive)
      const deadline = MAX_UINT128
      const callbackAddr = balancerV2Looping.address
      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [
          poolId,
          minSwapReceive,
          deadline
        ]
      )
      await borrowerGateway.connect(borrower).borrowWithOnChainQuote(lenderVault.address, borrower.address, collSendAmount, onChainQuote, isAutoQuote, callbackAddr, callbackData)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const borrowerWethBalDiffActual = borrowerWethBalPre.add(borrowerWethBalPost)
      const borrowerWethBalDiffExpected = borrowerWethBalPre.sub(collSendAmount)
      const borrowerWethBalDiffComparison = Math.abs(Number(borrowerWethBalDiffActual.sub(borrowerWethBalDiffExpected).mul(PRECISION).div(borrowerWethBalDiffActual).div(ONE_WETH).toString())/PRECISION)
      expect(borrowerWethBalDiffComparison).to.be.lessThan(0.01)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(0) // borrower: no usdc change as all swapped for weth
      expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(collSendAmount)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(onChainQuote.loanPerCollUnit.mul(collSendAmount).div(ONE_WETH))
    })
  })

  it('Should handle auto-quotes correctly', async function () {
    const { addressRegistry, borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping } = await setupTest()
    // deploy an autoquote strategy
    const AaveAutoQuoteStrategy1 = await ethers.getContractFactory('AaveAutoQuoteStrategy1')
    const aaveAutoQuoteStrategy1 = await AaveAutoQuoteStrategy1.connect(team).deploy()
    await aaveAutoQuoteStrategy1.deployed()

    // test retrieiving autoquote
    const onChainQuote = await aaveAutoQuoteStrategy1.getOnChainQuote();
    console.log("onChainQuote from Aave strategy:", onChainQuote)

    // whitelist autoquote strategy
    await addressRegistry.connect(team).toggleAutoQuoteStrategy(aaveAutoQuoteStrategy1.address)

    // lender subscribes to strategy
    await lenderVault.connect(lender).setAutoQuoteStrategy(weth.address, usdc.address, aaveAutoQuoteStrategy1.address)
    
    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

    // borrower approves borrower gateway
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // borrower uses quote to borrow
    const collSendAmount = ONE_WETH
    const isAutoQuote = true
    const callbackAddr = '0x0000000000000000000000000000000000000000'
    const callbackData = '0x'
    const bal = await weth.balanceOf(borrower.address)
    console.log(bal)
    await borrowerGateway.connect(borrower).borrowWithOnChainQuote(lenderVault.address, borrower.address, collSendAmount, onChainQuote, isAutoQuote, callbackAddr, callbackData)
  })
})
