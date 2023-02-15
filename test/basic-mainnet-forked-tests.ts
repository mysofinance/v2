import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { LenderVault } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const ONE_PAXG = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

const balancerV2VaultAbi = [
  {
    inputs: [{ internalType: 'bytes32', name: 'poolId', type: 'bytes32' }],
    name: 'getPoolTokens',
    outputs: [
      { internalType: 'contract IERC20[]', name: 'tokens', type: 'address[]' },
      { internalType: 'uint256[]', name: 'balances', type: 'uint256[]' },
      { internalType: 'uint256', name: 'lastChangeBlock', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]
const balancerV2PoolAbi = [
  {
    inputs: [],
    name: 'getSwapFeePercentage',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
]

const collTokenAbi = [
  {
    name: 'balanceOf',
    outputs: [{ type: 'uint256', name: '' }],
    inputs: [{ type: 'address', name: 'arg0' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    name: 'approve',
    outputs: [{ type: 'bool', name: '' }],
    inputs: [
      { type: 'address', name: '_spender' },
      { type: 'uint256', name: '_value' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    name: 'getCurrentVotes',
    constant: true,
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    outputs: [{ internalType: 'uint96', name: '', type: 'uint96' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
]

function getLoopingSendAmount(
  collTokenFromBorrower: number,
  loanPerColl: number,
  collTokenInDexPool: number,
  loanTokenInDexPool: number,
  swapFee: number
): number {
  const p = collTokenFromBorrower + loanTokenInDexPool / (loanPerColl * (1 - swapFee)) - collTokenInDexPool
  const q = -collTokenInDexPool * collTokenFromBorrower
  const collTokenReceivedFromDex = -p / 2 + Math.sqrt(Math.pow(p, 2) / 4 - q)
  return collTokenReceivedFromDex + collTokenFromBorrower
}

const createOnChainRequest = async ({
  lender,
  collToken,
  loanToken,
  borrowerCompartmentImplementation,
  lenderVault,
  loanPerCollUnit
}: {
  lender: SignerWithAddress
  collToken: string
  loanToken: string
  borrowerCompartmentImplementation: string
  lenderVault: LenderVault
  loanPerCollUnit: BigNumber
}) => {
  //
  let onChainQuote = {
    loanPerCollUnit,
    interestRatePctInBase: BASE.mul(10).div(100),
    upfrontFeePctInBase: BASE.mul(1).div(100),
    expectedTransferFee: 0,
    minCollAmount: 0,
    collToken: collToken,
    loanToken: loanToken,
    tenor: ONE_DAY.mul(365),
    timeUntilEarliestRepay: 0,
    isNegativeInterestRate: false,
    borrowerCompartmentImplementation: borrowerCompartmentImplementation
  }

  const payload = ethers.utils.defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256', 'uint256', 'bool', 'address'],
    [
      onChainQuote.loanPerCollUnit,
      onChainQuote.interestRatePctInBase,
      onChainQuote.upfrontFeePctInBase,
      onChainQuote.expectedTransferFee,
      onChainQuote.minCollAmount,
      onChainQuote.collToken,
      onChainQuote.loanToken,
      onChainQuote.tenor,
      onChainQuote.timeUntilEarliestRepay,
      onChainQuote.isNegativeInterestRate,
      onChainQuote.borrowerCompartmentImplementation
    ]
  )

  const onChainQuoteHash = ethers.utils.keccak256(payload)

  await expect(lenderVault.connect(lender).addOnChainQuote(onChainQuote))
    .to.emit(lenderVault, 'OnChainQuote')
    .withArgs(Object.values(onChainQuote), onChainQuoteHash, true)

  return onChainQuote
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
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // deploy borrower compartment factory
    const BorrowerCompartmentFactory = await ethers.getContractFactory('BorrowerCompartmentFactory')
    await BorrowerCompartmentFactory.connect(team)
    const borrowerCompartmentFactory = await BorrowerCompartmentFactory.deploy()
    await borrowerCompartmentFactory.deployed()

    // set lender vault factory, borrower gateway and borrower compartment on address registry (immutable)
    addressRegistry.setLenderVaultFactory(lenderVaultFactory.address)
    addressRegistry.setBorrowerGateway(borrowerGateway.address)
    addressRegistry.setBorrowerCompartmentFactory(borrowerCompartmentFactory.address)

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault()
    const lenderVaultAddr = await addressRegistry.registeredVaults(0)
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // prepare USDC balances
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const USDC_MASTER_MINTER = '0xe982615d461dd5cd06575bbea87624fda4e3de17'
    const usdc = await ethers.getContractAt('IUSDC', USDC_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [USDC_MASTER_MINTER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDC_MASTER_MINTER]
    })
    const masterMinter = await ethers.getSigner(USDC_MASTER_MINTER)
    await usdc.connect(masterMinter).configureMinter(masterMinter.address, MAX_UINT128)
    await usdc.connect(masterMinter).mint(lender.address, MAX_UINT128)

    // prepare WETH balance
    const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const weth = await ethers.getContractAt('IWETH', WETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [borrower.address, '0x204FCE5E3E25026110000000'])
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(1) })

    // prepare PAXG balances
    const PAXG_ADDRESS = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'
    const SUPPLY_CONTROLLER = '0xE25a329d385f77df5D4eD56265babe2b99A5436e'
    const paxg = await ethers.getContractAt('IPAXG', PAXG_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [SUPPLY_CONTROLLER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [SUPPLY_CONTROLLER]
    })
    const supplyController = await ethers.getSigner(SUPPLY_CONTROLLER)

    await paxg.connect(supplyController).increaseSupply('800000000000000000000000000')
    await paxg.connect(supplyController).transfer(borrower.address, '800000000000000000000000000')

    // deploy balancer v2 callbacks
    const BalancerV2Looping = await ethers.getContractFactory('BalancerV2Looping')
    await BalancerV2Looping.connect(lender)
    const balancerV2Looping = await BalancerV2Looping.deploy()
    await balancerV2Looping.deployed()

    // whitelist addrs
    await addressRegistry.connect(team).toggleTokenPair(weth.address, usdc.address)
    await addressRegistry.connect(team).toggleTokenPair(paxg.address, usdc.address)
    await addressRegistry.connect(team).toggleCallbackAddr(balancerV2Looping.address)

    return {
      addressRegistry,
      borrowerGateway,
      borrowerCompartmentFactory,
      lenderVaultImplementation,
      lender,
      borrower,
      team,
      usdc,
      weth,
      paxg,
      lenderVault,
      lenderVaultFactory,
      balancerV2Looping
    }
  }

  describe('On-Chain Quote Testing', function () {
    it('Should process atomic balancer swap correctly', async function () {
      const { borrowerGateway, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let onChainQuote = {
        loanPerCollUnit: ONE_USDC.mul(1000),
        interestRatePctInBase: BASE.mul(10).div(100),
        upfrontFeePctInBase: BASE.mul(1).div(100),
        expectedTransferFee: 0,
        minCollAmount: 0,
        collToken: weth.address,
        loanToken: usdc.address,
        tenor: ONE_DAY.mul(365),
        timeUntilEarliestRepay: 0,
        isNegativeInterestRate: false,
        borrowerCompartmentImplementation: '0x0000000000000000000000000000000000000000'
      }
      await lenderVault.connect(lender).addOnChainQuote(onChainQuote)

      // Balancer V2 integration: calculate which send amount would be needed to max. lever up in 1-click
      const poolAddr = '0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8'
      const poolId = '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019' // look up via getPoolId() on bal pool
      const balancerV2Pool = await new ethers.Contract(poolAddr, balancerV2PoolAbi, team) // could be any signer, here used team

      const PRECISION = 10000
      const collBuffer = BASE.mul(990).div(1000)
      const initCollFromBorrower = ONE_WETH.mul(collBuffer).div(BASE)
      const initCollFromBorrowerNumber = Number(initCollFromBorrower.mul(PRECISION).div(ONE_WETH).toString()) / PRECISION
      const loanPerColl = Number(onChainQuote.loanPerCollUnit.mul(PRECISION).div(ONE_USDC).toString()) / PRECISION
      const swapFee = Number((await balancerV2Pool.getSwapFeePercentage()).mul(PRECISION).div(BASE).toString()) / PRECISION
      const balancerV2Vault = await new ethers.Contract(
        '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        balancerV2VaultAbi,
        team
      ) // could be any signer, here used team
      const balancerV2PoolTokens = await balancerV2Vault.getPoolTokens(poolId)
      const collTokenInDexPool =
        Number(
          (balancerV2PoolTokens.tokens[0] == weth.address
            ? balancerV2PoolTokens.balances[0]
            : balancerV2PoolTokens.balances[1]
          )
            .mul(PRECISION)
            .div(ONE_WETH)
            .toString()
        ) / PRECISION
      const loanTokenInDexPool =
        Number(
          (balancerV2PoolTokens.tokens[0] == usdc.address
            ? balancerV2PoolTokens.balances[0]
            : balancerV2PoolTokens.balances[1]
          )
            .mul(PRECISION)
            .div(ONE_USDC)
            .toString()
        ) / PRECISION
      const collSendAmountNumber = getLoopingSendAmount(
        initCollFromBorrowerNumber,
        loanPerColl,
        collTokenInDexPool,
        loanTokenInDexPool,
        swapFee
      )
      const collSendAmount = ethers.BigNumber.from(Math.floor(collSendAmountNumber * PRECISION))
        .mul(ONE_WETH)
        .div(PRECISION)
      console.log('sendAmountNumber to max. lever up: ', collSendAmountNumber)
      console.log('sendAmount to max. lever up: ', collSendAmount)

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
      console.log('minSwapReceive: ', minSwapReceive)
      const deadline = MAX_UINT128
      const callbackAddr = balancerV2Looping.address
      const callbackData = ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'uint256'],
        [poolId, minSwapReceive, deadline]
      )
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          onChainQuote,
          isAutoQuote,
          callbackAddr,
          callbackData
        )

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const borrowerWethBalDiffActual = borrowerWethBalPre.add(borrowerWethBalPost)
      const borrowerWethBalDiffExpected = borrowerWethBalPre.sub(collSendAmount)
      const borrowerWethBalDiffComparison = Math.abs(
        Number(
          borrowerWethBalDiffActual
            .sub(borrowerWethBalDiffExpected)
            .mul(PRECISION)
            .div(borrowerWethBalDiffActual)
            .div(ONE_WETH)
            .toString()
        ) / PRECISION
      )
      expect(borrowerWethBalDiffComparison).to.be.lessThan(0.01)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(0) // borrower: no usdc change as all swapped for weth
      expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(collSendAmount)
      expect(vaultUsdcBalPre.sub(vaultUsdcBalPost)).to.equal(onChainQuote.loanPerCollUnit.mul(collSendAmount).div(ONE_WETH))
    })
  })

  it('Should handle auto-quotes correctly', async function () {
    const { addressRegistry, borrowerGateway, lender, borrower, team, usdc, weth, lenderVault, balancerV2Looping } =
      await setupTest()
    // deploy an autoquote strategy
    const AaveAutoQuoteStrategy1 = await ethers.getContractFactory('AaveAutoQuoteStrategy1')
    const aaveAutoQuoteStrategy1 = await AaveAutoQuoteStrategy1.connect(team).deploy()
    await aaveAutoQuoteStrategy1.deployed()

    // whitelist autoquote strategy
    await addressRegistry.connect(team).toggleAutoQuoteStrategy(aaveAutoQuoteStrategy1.address)

    // lender subscribes to strategy
    await lenderVault.connect(lender).setAutoQuoteStrategy(weth.address, usdc.address, aaveAutoQuoteStrategy1.address)

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

    // borrower approves borrower gateway
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // test retrieiving autoquote
    const onChainQuote = await aaveAutoQuoteStrategy1.getOnChainQuote()
    console.log('onChainQuote from Aave strategy:', onChainQuote)

    // borrower uses quote to borrow
    const collSendAmount = ONE_WETH
    const isAutoQuote = true
    const callbackAddr = '0x0000000000000000000000000000000000000000'
    const callbackData = '0x'
    await borrowerGateway
      .connect(borrower)
      .borrowWithOnChainQuote(
        lenderVault.address,
        collSendAmount,
        onChainQuote,
        isAutoQuote,
        callbackAddr,
        callbackData
      )
    const loan = await lenderVault.loans(0)
    const expectedLoanAmount = collSendAmount.mul(onChainQuote.loanPerCollUnit).div(ONE_WETH)
    const expectedRepayAmount = expectedLoanAmount.mul(BASE.add(onChainQuote.interestRatePctInBase)).div(BASE)

    expect(loan.initCollAmount).to.equal(collSendAmount)
    expect(loan.initLoanAmount).to.equal(expectedLoanAmount)
    expect(loan.initRepayAmount).to.equal(expectedRepayAmount)
  })

  it('Should handle unlockCollateral without compartment correctly', async () => {
    const { addressRegistry, borrowerGateway, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()
    // deploy an autoquote strategy
    const AaveAutoQuoteStrategy1 = await ethers.getContractFactory('AaveAutoQuoteStrategy1')
    const aaveAutoQuoteStrategy1 = await AaveAutoQuoteStrategy1.connect(team).deploy()
    await aaveAutoQuoteStrategy1.deployed()

    // whitelist autoquote strategy
    await addressRegistry.connect(team).toggleAutoQuoteStrategy(aaveAutoQuoteStrategy1.address)

    // lender subscribes to strategy
    await lenderVault.connect(lender).setAutoQuoteStrategy(weth.address, usdc.address, aaveAutoQuoteStrategy1.address)

    // lender deposits usdc
    await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

    // borrower approves borrower gateway
    await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

    // test retrieiving autoquote
    const onChainQuote = await aaveAutoQuoteStrategy1.getOnChainQuote()

    // borrower uses quote to borrow
    const collSendAmount = ONE_WETH
    const isAutoQuote = true
    const callbackAddr = '0x0000000000000000000000000000000000000000'
    const callbackData = '0x'
    await borrowerGateway
      .connect(borrower)
      .borrowWithOnChainQuote(
        lenderVault.address,
        collSendAmount,
        onChainQuote,
        isAutoQuote,
        callbackAddr,
        callbackData
      )

    const loan = await lenderVault.loans(0)

    await ethers.provider.send('evm_mine', [loan.expiry + 12])

    const lenderWethBalPre = await weth.balanceOf(lender.address)

    expect(lenderWethBalPre).to.equal(BigNumber.from(0))

    await lenderVault.connect(lender).unlockCollateral(weth.address, [0])

    const lenderWethBalPost = await weth.balanceOf(lender.address)

    expect(lenderWethBalPost).to.equal(collSendAmount)
  })

  describe('Compartment Testing', function () {
    it('Should process Curve LP staking/repay correctly', async () => {
      const { borrowerGateway, lender, borrower, team, usdc, lenderVault, addressRegistry } = await setupTest()

      // create curve staking implementation
      const CurveLPStakingCompartmentImplementation = await ethers.getContractFactory('CurveLPStakingCompartment')
      await CurveLPStakingCompartmentImplementation.connect(team)
      const curveLPStakingCompartmentImplementation = await CurveLPStakingCompartmentImplementation.deploy()
      await curveLPStakingCompartmentImplementation.deployed()

      // increase borrower CRV balance
      const locallyCRVBalance = ethers.BigNumber.from(10).pow(18)
      const collTokenAddress = '0xEd4064f376cB8d68F770FB1Ff088a3d0F3FF5c4d' // LP crvCRVETH
      const crvGaugeAddress = '0x1cEBdB0856dd985fAe9b8fEa2262469360B8a3a6'
      const CRV_SLOT = 5
      const crvInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)
      const crvGaugeInstance = new ethers.Contract(crvGaugeAddress, collTokenAbi, borrower.provider)

      // Get storage slot index
      const index = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [CRV_SLOT, borrower.address])
      await ethers.provider.send('hardhat_setStorageAt', [
        collTokenAddress,
        index.toString(),
        ethers.utils.hexZeroPad(locallyCRVBalance.toHexString(), 32)
      ])

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get pre balances
      const borrowerCRVBalPre = await crvInstance.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(borrowerCRVBalPre).to.equal(locallyCRVBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).toggleTokenPair(collTokenAddress, usdc.address)

      // whitelist gauge crv-eth contract
      await addressRegistry.connect(team).toggleCollTokenHandler(crvGaugeAddress)

      // borrower approves borrower gateway
      await crvInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const ONE_CRV = BigNumber.from(10).pow(18)

      const onChainQuote = await createOnChainRequest({
        lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: curveLPStakingCompartmentImplementation.address,
        lenderVault,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // borrow with on chain quote
      const collSendAmount = ONE_CRV
      const isAutoQuote = false
      const callbackAddr = '0x0000000000000000000000000000000000000000'
      const callbackData = '0x'
      const compartmentData = 84 //crv-ETH gauge index

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          onChainQuote,
          isAutoQuote,
          callbackAddr,
          callbackData
        )

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      const collTokenCompartmentAddr = borrowEvent?.args?.['collTokenCompartmentAddr']
      const loanId = borrowEvent?.args?.['loanId']
      const repayAmount = borrowEvent?.args?.['initRepayAmount']

      const crvCompInstance = await curveLPStakingCompartmentImplementation.attach(collTokenCompartmentAddr)

      await crvCompInstance.connect(borrower).stake(compartmentData)

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      const compartmentGaugeBalPost = await crvGaugeInstance.balanceOf(collTokenCompartmentAddr)

      expect(compartmentGaugeBalPost).to.equal(borrowerCRVBalPre)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower approves borrower gateway
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // repay
      await expect(
        borrowerGateway
          .connect(borrower)
          .repay(
            { collToken: collTokenAddress, loanToken: usdc.address, loanId, repayAmount, repaySendAmount: repayAmount },
            lenderVault.address,
            callbackAddr,
            callbackData
          )
      )
        .to.emit(borrowerGateway, 'Repay')
        .withArgs(lenderVault.address, loanId, repayAmount)

      // check balance post repay
      const borrowerCRVRepayBalPost = await crvInstance.balanceOf(borrower.address)

      expect(borrowerCRVRepayBalPost).to.equal(locallyCRVBalance)
    })

    it('Should delegate voting correctly', async () => {
      const { borrowerGateway, lender, borrower, team, usdc, lenderVault, addressRegistry } = await setupTest()

      // create uni staking implementation
      const VotingCompartmentImplementation = await ethers.getContractFactory('VoteCompartment')
      await VotingCompartmentImplementation.connect(team)
      const votingCompartmentImplementation = await VotingCompartmentImplementation.deploy()
      await votingCompartmentImplementation.deployed()

      // increase borrower UNI balance
      const locallyUNIBalance = ethers.BigNumber.from(10).pow(18)
      const collTokenAddress = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' // UNI
      const UNI_SLOT = 4
      const collInstance = new ethers.Contract(collTokenAddress, collTokenAbi, borrower.provider)

      // Get storage slot index
      const index = ethers.utils.solidityKeccak256(['uint256', 'uint256'], [borrower.address, UNI_SLOT])
      await ethers.provider.send('hardhat_setStorageAt', [
        collTokenAddress,
        index.toString(),
        ethers.utils.hexZeroPad(locallyUNIBalance.toHexString(), 32)
      ])

      // lender deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // get pre balances
      const borrowerUNIBalPre = await collInstance.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultUNIBalPre = BigNumber.from(0) // compartment balance
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      expect(borrowerUNIBalPre).to.equal(locallyUNIBalance)
      expect(vaultUsdcBalPre).to.equal(ONE_USDC.mul(100000))

      // whitelist token pair
      await addressRegistry.connect(team).toggleTokenPair(collTokenAddress, usdc.address)

      // borrower approves borrower gateway
      await collInstance.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const ONE_UNI = BigNumber.from(10).pow(18)

      const onChainQuote = await createOnChainRequest({
        lender: lender,
        collToken: collTokenAddress,
        loanToken: usdc.address,
        borrowerCompartmentImplementation: votingCompartmentImplementation.address,
        lenderVault,
        loanPerCollUnit: ONE_USDC.mul(1000)
      })

      // borrow with on chain quote
      const collSendAmount = ONE_UNI
      const isAutoQuote = false
      const callbackAddr = '0x0000000000000000000000000000000000000000'
      const callbackData = '0x'

      const borrowWithOnChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          onChainQuote,
          isAutoQuote,
          callbackAddr,
          callbackData
        )

      const borrowWithOnChainQuoteReceipt = await borrowWithOnChainQuoteTransaction.wait()

      const collTokenCompartmentAddr = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })?.args?.['collTokenCompartmentAddr']

      const uniCompInstance = await votingCompartmentImplementation.attach(collTokenCompartmentAddr)

      const borrowerVotesPreDelegation = await collInstance.getCurrentVotes(borrower.address)

      await uniCompInstance.connect(borrower).delegate(borrower.address)

      // check balance post borrow
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const borroweUNIBalPost = await collInstance.balanceOf(borrower.address)
      const vaultUNIBalPost = await collInstance.balanceOf(collTokenCompartmentAddr)

      const borrowerVotesPost = await collInstance.getCurrentVotes(borrower.address)

      expect(borrowerVotesPost).to.equal(borrowerUNIBalPre)
      expect(borrowerVotesPreDelegation).to.equal(0)

      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
      expect(borrowerUNIBalPre.sub(borroweUNIBalPost)).to.equal(vaultUNIBalPost.sub(vaultUNIBalPre))
    })
  })

  describe('Testing with token transfer fees', function () {
    it('Should process onChain quote with fees', async function () {
      const { borrowerGateway, lender, borrower, usdc, paxg, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let onChainQuote = {
        loanPerCollUnit: ONE_USDC.mul(1000),
        interestRatePctInBase: BASE.mul(10).div(100),
        upfrontFeePctInBase: BASE.mul(1).div(100),
        expectedTransferFee: ONE_PAXG.mul(2).div(9998),
        minCollAmount: 0,
        collToken: paxg.address,
        loanToken: usdc.address,
        tenor: ONE_DAY.mul(365),
        timeUntilEarliestRepay: 0,
        isNegativeInterestRate: false,
        borrowerCompartmentImplementation: '0x0000000000000000000000000000000000000000'
      }
      await lenderVault.connect(lender).addOnChainQuote(onChainQuote)

      // check balance pre borrow
      const borrowerPaxgBalPre = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPre = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves and executes quote
      await paxg.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const isAutoQuote = false
      const collSendAmount = ONE_PAXG.mul(10000).div(9998)
      const callbackAddr = ZERO_ADDR
      const callbackData = '0x'
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          onChainQuote,
          isAutoQuote,
          callbackAddr,
          callbackData
        )

      // check balance post borrow
      const borrowerPaxgBalPost = await paxg.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultPaxgBalPost = await paxg.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      
      expect(borrowerPaxgBalPre.sub(borrowerPaxgBalPost)).to.equal(collSendAmount)
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(ONE_USDC.mul(1000))
      expect(Math.abs(Number(vaultPaxgBalPost.sub(vaultPaxgBalPre).sub(collSendAmount.mul(9998).div(10000).toString())))).to.lessThanOrEqual(1)
      expect(Math.abs(Number(vaultUsdcBalPre.sub(vaultUsdcBalPost).sub(onChainQuote.loanPerCollUnit.mul(collSendAmount.mul(9998)).div(10000).div(ONE_PAXG)).toString()))).to.lessThanOrEqual(1)
    })
  })
})
