import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

    // deploy borrower gateway
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    const borrowerGateway = await BorrowerGateway.connect(team).deploy(addressRegistry.address)
    await borrowerGateway.deployed()

    // deploy quote handler
    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    const quoteHandler = await QuoteHandler.connect(team).deploy(addressRegistry.address)
    await quoteHandler.deployed()
    
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
    await expect(addressRegistry.connect(lender).setLenderVaultFactory(lenderVaultFactory.address)).to.be.reverted
    await addressRegistry.connect(team).setLenderVaultFactory(lenderVaultFactory.address)
    await expect(addressRegistry.connect(team).setLenderVaultFactory('0x0000000000000000000000000000000000000001')).to.be.reverted
    await expect(addressRegistry.connect(lender).setBorrowerGateway(borrowerGateway.address)).to.be.reverted
    await addressRegistry.connect(team).setBorrowerGateway(borrowerGateway.address)
    await addressRegistry.connect(team).setQuoteHandler(quoteHandler.address)
    await expect(addressRegistry.connect(team).setBorrowerGateway('0x0000000000000000000000000000000000000001')).to.be.reverted
    await expect(addressRegistry.connect(lender).setBorrowerCompartmentFactory(borrowerGateway.address)).to.be.reverted
    await addressRegistry.connect(team).setBorrowerCompartmentFactory(borrowerCompartmentFactory.address)
    await expect(addressRegistry.connect(team).setBorrowerCompartmentFactory('0x0000000000000000000000000000000000000001')).to.be.reverted


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
    await expect(addressRegistry.connect(lender).toggleTokens([weth.address])).to.be.reverted
    await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address])
    await addressRegistry.connect(team).toggleTokens([ZERO_ADDRESS])
    expect(await addressRegistry.isWhitelistedToken(ZERO_ADDRESS)).to.be.false

    //test lenderVault check works
    await expect(addressRegistry.connect(team).addLenderVault(lenderVaultAddr)).to.be.reverted
    
    return { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault }
  }

  describe('Off-Chain Quote Testing', function () {
    it('Should process off-chain quote correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      const quoteTuplesTree = StandardMerkleTree.of(quoteTuples.map(quoteTuple => Object.values(quoteTuple)), ['uint256', 'uint256', 'uint256', 'uint256'])
      const quoteTuplesRoot = quoteTuplesTree.root
      console.log('quoteTuplesTree:', quoteTuplesTree)
      console.log('quoteTuplesRoot:', quoteTuplesRoot)
      let offChainQuote = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
        },
        quoteTuplesRoot: quoteTuplesRoot,
        salt: ZERO_BYTES32,
        nonce: 0,
        v: 0,
        r: ZERO_BYTES32,
        s: ZERO_BYTES32
      }
      const payload = ethers.utils.defaultAbiCoder.encode(
        [
          {
            "components": [
              {
                "internalType": "address",
                "name": "borrower",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "collToken",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "loanToken",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "oracleAddr",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "minLoan",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxLoan",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "validUntil",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "earliestRepayTenor",
                "type": "uint256"
              },
              {
                "internalType": "address",
                "name": "borrowerCompartmentImplementation",
                "type": "address"
              },
              {
                "internalType": "bool",
                "name": "isSingleUse",
                "type": "bool"
              }
            ],
            "internalType": "struct DataTypes.GeneralQuoteInfo",
            "name": "generalQuoteInfo",
            "type": "tuple"
          },
          {
            "internalType": "bytes32",
            "name": "quoteTuplesRoot",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "salt",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        [
          offChainQuote.generalQuoteInfo,
          offChainQuote.quoteTuplesRoot,
          offChainQuote.salt,
          offChainQuote.nonce
        ]
      )
      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
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

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 0
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)
      console.log('Value:', selectedQuoteTuple)
      console.log('Proof:', proof)
      
      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = ONE_WETH
      const expectedTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      // unregistered vault address reverts
      await expect(borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(
          lender.address,
          collSendAmount,
          expectedTransferFee,
          offChainQuote,
          selectedQuoteTuple,
          proof,
          callbackAddr,
          callbackData
        )).to.be.revertedWithCustomError(borrowerGateway, 'UnregisteredVault')

      // if borrower is not msg.sender, reverts
      await expect(borrowerGateway
        .connect(team)
        .borrowWithOffChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          offChainQuote,
          selectedQuoteTuple,
          proof,
          callbackAddr,
          callbackData
        )).to.be.reverted

      // if quote tuple that's not part of tree, reverts
      const unregisteredQuoteTuple = {
        loanPerCollUnitOrLtv: ONE_USDC.mul(1000000),
        interestRatePctInBase: 0,
        upfrontFeePctInBase: 0,
        tenor: ONE_DAY.mul(360)
      }
      await expect(borrowerGateway
        .connect(team)
        .borrowWithOffChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          offChainQuote,
          unregisteredQuoteTuple,
          proof,
          callbackAddr,
          callbackData
          )).to.be.reverted

      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          offChainQuote,
          selectedQuoteTuple,
          proof,
          callbackAddr,
          callbackData
        )

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    })
  })

  describe('On-Chain Quote Testing', function () {
    it('Should process on-chain quote correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          borrower: borrower.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuote')

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = ONE_WETH
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(
          lenderVault.address,
          collSendAmount,
          expectedTransferFee,
          onChainQuote,
          quoteTupleIdx,
          callbackAddr,
          callbackData
        )
      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    })

    it('Should update and delete on-chain quota successfully', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()
      
      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(20).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          borrower: ZERO_ADDRESS,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuote')

      quoteTuples[0].loanPerCollUnitOrLtv = ONE_USDC.mul(900)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuote')

      await expect(quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, onChainQuote))
        .to.emit(quoteHandler, 'OnChainQuote')
    })
  })
})
