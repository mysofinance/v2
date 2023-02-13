import { expect } from 'chai'
import { ethers } from 'hardhat'

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)

describe('Basic Local Tests', function () {
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

    // deploy test tokens
    const MyERC20 = await ethers.getContractFactory('MyERC20')

    const USDC = await MyERC20.connect(team)
    const usdc = await USDC.deploy('USDC', 'USDC', 6)
    await usdc.deployed()

    const WETH = await MyERC20.connect(team)
    const weth = await WETH.deploy('WETH', 'WETH', 18)
    await weth.deployed()

    // transfer some test tokens
    await usdc.mint(lender.address, ONE_USDC.mul(100000))
    await weth.mint(borrower.address, ONE_WETH.mul(10))

    // whitelist addrs
    await addressRegistry.connect(team).toggleTokenPair(weth.address, usdc.address)

    return { borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault }
  }

  describe('Off-Chain Quote Testing', function () {
    it('Should process off-chain quote correctly, without possibility of replaying', async function () {
      const { borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let offChainQuote = {
        borrower: borrower.address,
        collToken: weth.address,
        loanToken: usdc.address,
        collAmount: ONE_WETH.sub(ONE_WETH.mul(50).div(10000)),
        loanAmount: ONE_USDC.mul(1000),
        expiry: timestamp + 60 * 60 * 24 * 30,
        earliestRepay: timestamp,
        repayAmount: ONE_USDC.mul(1010),
        validUntil: timestamp + 60,
        upfrontFee: ONE_WETH.mul(50).div(10000),
        borrowerCompartmentImplementation: '0x0000000000000000000000000000000000000000',
        nonce: 0,
        v: 0,
        r: '0x0',
        s: '0x0'
      }
      const payload = ethers.utils.defaultAbiCoder.encode(
        [
          'address',
          'address',
          'address',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'address',
          'uint256'
        ],
        [
          offChainQuote.borrower,
          offChainQuote.collToken,
          offChainQuote.loanToken,
          offChainQuote.collAmount,
          offChainQuote.loanAmount,
          offChainQuote.expiry,
          offChainQuote.earliestRepay,
          offChainQuote.repayAmount,
          offChainQuote.validUntil,
          offChainQuote.upfrontFee,
          offChainQuote.borrowerCompartmentImplementation,
          offChainQuote.nonce
        ]
      )
      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      console.log('payloadHash:', payloadHash)
      console.log('Signature:', sig)
      expect(recoveredAddr).to.equal(lender.address)

      // lender add sig to quote and pass to borrower
      offChainQuote.v = sig.v
      offChainQuote.r = sig.r
      offChainQuote.s = sig.s

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = offChainQuote.collAmount.add(offChainQuote.upfrontFee)
      const callbackAddr = '0x0000000000000000000000000000000000000000'
      const callbackData = '0x'
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrower.address, collSendAmount, offChainQuote, callbackAddr, callbackData)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower cannot replay quote
      await expect(
        borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrower.address, collSendAmount, offChainQuote, callbackAddr, callbackData)
      ).to.be.reverted
    })
  })

  describe('On-Chain Quote Testing', function () {
    it('Should process on-chain quote correctly', async function () {
      const { borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const onChainQuote = {
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
        borrowerCompartmentImplementation: '0x0000000000000000000000000000000000000000',
      }

      const payload = ethers.utils.defaultAbiCoder.encode(
        [
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'address',
          'address',
          'uint256',
          'uint256',
          'bool',
          'address'
        ],
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

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)
      
      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = ONE_WETH
      const isAutoQuote = false
      const callbackAddr = '0x0000000000000000000000000000000000000000'
      const callbackData = '0x'
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrower.address, collSendAmount, onChainQuote, isAutoQuote, callbackAddr, callbackData)

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    })

    it('Should update and delete on-chain quota successfully', async function () {
      const { borrowerGateway, lenderVaultImplementation, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

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
        tenor: ONE_DAY.mul(365).toNumber(),
        timeUntilEarliestRepay: 0,
        isNegativeInterestRate: false,
        borrowerCompartmentImplementation: '0x0000000000000000000000000000000000000000',
      }
      let payload = ethers.utils.defaultAbiCoder.encode(
        [
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'address',
          'address',
          'uint256',
          'uint256',
          'bool',
          'address'
        ],
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
      let onChainQuoteHash = ethers.utils.keccak256(payload)

      await expect(lenderVault.connect(lender).addOnChainQuote(onChainQuote))
        .to.emit(lenderVault, 'OnChainQuote')
        .withArgs(Object.values(onChainQuote), onChainQuoteHash, true)

      onChainQuote.loanPerCollUnit = ONE_USDC.mul(900)
      payload = ethers.utils.defaultAbiCoder.encode(
        [
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'uint256',
          'address',
          'address',
          'uint256',
          'uint256',
          'bool',
          'address'
        ],
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
      onChainQuoteHash = ethers.utils.keccak256(payload)
      await expect(lenderVault.connect(lender).addOnChainQuote(onChainQuote))
        .to.emit(lenderVault, 'OnChainQuote')
        .withArgs(Object.values(onChainQuote), onChainQuoteHash, true)

      await expect(lenderVault.connect(lender).deleteOnChainQuote(onChainQuote))
        .to.emit(lenderVault, 'OnChainQuote')
        .withArgs(Object.values(onChainQuote), onChainQuoteHash, false)
    })
  })
})
