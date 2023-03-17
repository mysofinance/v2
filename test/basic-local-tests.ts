import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { LenderVaultImpl, MyERC20 } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const payloanScheme = [
  {
    components: [
      {
        internalType: 'address',
        name: 'borrower',
        type: 'address'
      },
      {
        internalType: 'address',
        name: 'collToken',
        type: 'address'
      },
      {
        internalType: 'address',
        name: 'loanToken',
        type: 'address'
      },
      {
        internalType: 'address',
        name: 'oracleAddr',
        type: 'address'
      },
      {
        internalType: 'uint256',
        name: 'minLoan',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'maxLoan',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'validUntil',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'earliestRepayTenor',
        type: 'uint256'
      },
      {
        internalType: 'address',
        name: 'borrowerCompartmentImplementation',
        type: 'address'
      },
      {
        internalType: 'bool',
        name: 'isSingleUse',
        type: 'bool'
      }
    ],
    internalType: 'struct DataTypes.GeneralQuoteInfo',
    name: 'generalQuoteInfo',
    type: 'tuple'
  },
  {
    internalType: 'bytes32',
    name: 'quoteTuplesRoot',
    type: 'bytes32'
  },
  {
    internalType: 'bytes32',
    name: 'salt',
    type: 'bytes32'
  },
  {
    internalType: 'uint256',
    name: 'nonce',
    type: 'uint256'
  },
  {
    internalType: 'uint256',
    name: 'chainId',
    type: 'uint256'
  }
]

async function generateOffChainQuote({
  lenderVault,
  lender,
  borrower,
  weth,
  usdc,
  offChainQuoteBodyInfo = {},
  generalQuoteInfo = {},
  customSignature = {}
}: {
  lenderVault: LenderVaultImpl
  lender: SignerWithAddress
  borrower: SignerWithAddress
  weth: MyERC20
  usdc: MyERC20
  offChainQuoteBodyInfo?: any
  generalQuoteInfo?: any
  customSignature?: any
}) {
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
  const quoteTuplesTree = StandardMerkleTree.of(
    quoteTuples.map(quoteTuple => Object.values(quoteTuple)),
    ['uint256', 'uint256', 'uint256', 'uint256']
  )
  const quoteTuplesRoot = quoteTuplesTree.root
  console.log('quoteTuplesTree:', quoteTuplesTree)
  console.log('quoteTuplesRoot:', quoteTuplesRoot)
  const chainId = (await ethers.getDefaultProvider().getNetwork()).chainId
  console.log('chainId:', chainId)
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
      ...generalQuoteInfo
    },
    quoteTuplesRoot: quoteTuplesRoot,
    salt: ZERO_BYTES32,
    nonce: 0,
    chainId: chainId,
    v: [0],
    r: [ZERO_BYTES32],
    s: [ZERO_BYTES32],
    ...offChainQuoteBodyInfo
  }

  const payload = ethers.utils.defaultAbiCoder.encode(payloanScheme as any, [
    offChainQuote.generalQuoteInfo,
    offChainQuote.quoteTuplesRoot,
    offChainQuote.salt,
    offChainQuote.nonce,
    offChainQuote.chainId
  ])

  const payloadHash = ethers.utils.keccak256(payload)
  const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
  const sig = ethers.utils.splitSignature(signature)
  const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
  expect(recoveredAddr).to.equal(lender.address)

  // add signer
  lenderVault.connect(lender).addSigners([lender.address])

  // lender add sig to quote and pass to borrower
  offChainQuote.v = customSignature.v || [sig.v]
  offChainQuote.r = customSignature.r || [sig.r]
  offChainQuote.s = customSignature.s || [sig.s]

  return { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash }
}

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
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(team).deploy()
    await lenderVaultImplementation.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // initialize address registry
    await expect(
      addressRegistry.connect(lender).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
    ).to.be.reverted
    await expect(addressRegistry.connect(team).initialize(ZERO_ADDRESS, borrowerGateway.address, quoteHandler.address)).to.be
      .reverted
    await expect(addressRegistry.connect(team).initialize(lenderVaultFactory.address, ZERO_ADDRESS, quoteHandler.address)).to
      .be.reverted
    await expect(addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, ZERO_ADDRESS))
      .to.be.reverted
    await expect(
      addressRegistry.connect(team).initialize(lenderVaultFactory.address, lenderVaultFactory.address, quoteHandler.address)
    ).to.be.reverted
    await expect(
      addressRegistry
        .connect(team)
        .initialize(lenderVaultFactory.address, borrowerGateway.address, lenderVaultFactory.address)
    ).to.be.reverted
    await expect(
      addressRegistry.connect(team).initialize(lenderVaultFactory.address, quoteHandler.address, quoteHandler.address)
    ).to.be.reverted
    await addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
    await expect(addressRegistry.connect(team).initialize(team.address, borrower.address, lender.address)).to.be.reverted
    await expect(addressRegistry.connect(lender).initialize(team.address, borrower.address, lender.address)).to.be.reverted

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
    await expect(addressRegistry.connect(lender).toggleTokens([weth.address], true)).to.be.reverted
    await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], true)
    await addressRegistry.connect(team).toggleTokens([ZERO_ADDRESS], true)
    expect(await addressRegistry.isWhitelistedToken(ZERO_ADDRESS)).to.be.false

    //test lenderVault check works
    await expect(addressRegistry.connect(team).addLenderVault(lenderVaultAddr)).to.be.reverted

    return { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault }
  }

  describe('Lender Vault', function () {
    it('Should not proccess with insufficient vault funds', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // check that only owner can propose new owner
      await expect(lenderVault.connect(borrower).proposeNewOwner(borrower.address)).to.be.revertedWithCustomError(lenderVault, "InvalidSender")

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
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const collSendAmount = ONE_WETH
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted

      // allow for transfer of vault ownership
    await lenderVault.connect(lender).proposeNewOwner(borrower.address)
    // only new proposed owner can claim vault
    await expect(lenderVault.connect(lender).claimOwnership()).to.be.revertedWithCustomError(lenderVault, "InvalidSender")
    await lenderVault.connect(borrower).claimOwnership()
    })
  })

  describe('Borrow Gateway', function () {
    it('Should not proccess with bigger fee than max fee', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      await expect(borrowerGateway.connect(lender).setNewProtocolFee(0)).to.be.reverted
      await expect(borrowerGateway.connect(team).setNewProtocolFee(BASE)).to.be.reverted
    })
  })

  describe('Off-Chain Quote Testing', function () {
    it('Should process off-chain quote correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash } = await generateOffChainQuote({
        lenderVault,
        lender,
        borrower,
        weth,
        usdc
      })

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      // unregistered vault address reverts
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lender.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(borrowerGateway, 'UnregisteredVault')

      // if borrower is not msg.sender, reverts
      await expect(
        borrowerGateway
          .connect(team)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.reverted

      // if quote tuple that's not part of tree, reverts
      const unregisteredQuoteTuple = {
        loanPerCollUnitOrLtv: ONE_USDC.mul(1000000),
        interestRatePctInBase: 0,
        upfrontFeePctInBase: 0,
        tenor: ONE_DAY.mul(360)
      }
      await expect(
        borrowerGateway
          .connect(team)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, unregisteredQuoteTuple, proof)
      ).to.be.reverted

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // invalidate off chain quote
      await expect(quoteHandler.connect(lender).invalidateOffChainQuote(borrower.address, payloadHash)).to.reverted
      await expect(quoteHandler.connect(borrower).invalidateOffChainQuote(lenderVault.address, payloadHash)).to.reverted

      await expect(quoteHandler.connect(lender).invalidateOffChainQuote(lenderVault.address, payloadHash)).to.emit(
        quoteHandler,
        'OffChainQuoteInvalidated'
      )

      await expect(
        borrowerGateway
          .connect(team)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.reverted
    })

    it('Should validate off-chain validUntil quote correctly', async function () {
      const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        borrower,
        weth,
        usdc,
        offChainQuoteBodyInfo: {
          nonce: BASE
        }
      })

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.rejected
    })

    it('Should validate off-chain validUntil quote correctly', async function () {
      const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        borrower,
        weth,
        usdc,
        generalQuoteInfo: {
          validUntil: 10
        }
      })

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.rejected
    })

    it('Should validate off-chain singleUse quote correctly', async function () {
      const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        borrower,
        weth,
        usdc,
        generalQuoteInfo: {
          isSingleUse: true
        }
      })

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      const borrowWithOffChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      const borrowWithOnChainQuoteReceipt = await borrowWithOffChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrow'
      })

      expect(borrowEvent).not.be.undefined

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.rejected
    })

    it('Should validate off-chain MerkleProof correctly', async function () {
      const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        borrower,
        weth,
        usdc,
        offChainQuoteBodyInfo: {
          salt: ethers.utils.formatBytes32String('somethingwrong')
        }
      })

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(
            lenderVault.address,
            borrowInstructions,
            offChainQuote,
            selectedQuoteTuple,
            proof.slice(2)
          )
      ).to.be.rejected
    })

    it('Should validate off-chain wrong signature correctly', async function () {
      const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        borrower,
        weth,
        usdc,
        customSignature: {
          v: [0, 1, 2, 3]
        }
      })

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.rejected
    })

    it('Should validate correctly the wrong incrementOffChainQuoteNonce', async function () {
      const { quoteHandler, borrower, lender, lenderVault } = await setupTest()

      const offChainQuoteNoncePre = await quoteHandler.connect(lender).offChainQuoteNonce(lenderVault.address)

      await expect(quoteHandler.connect(lender).incrementOffChainQuoteNonce(lender.address)).to.be.reverted
      await expect(quoteHandler.connect(borrower).incrementOffChainQuoteNonce(lenderVault.address)).to.be.reverted

      await expect(quoteHandler.connect(lender).incrementOffChainQuoteNonce(lenderVault.address))

      const offChainQuoteNoncePost = await quoteHandler.connect(lender).offChainQuoteNonce(lenderVault.address)

      expect(offChainQuoteNoncePre.toNumber() + 1).to.equal(offChainQuoteNoncePost)
    })
  })

  describe('On-Chain Quote Testing', function () {
    it('Should process on-chain quote correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

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
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

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
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
    })

    it('Should process on-chain single use quote correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault, addressRegistry } =
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
          isSingleUse: true
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = ONE_WETH
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(borrower.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted

      await expect(
        quoteHandler.connect(lender).checkAndRegisterOnChainQuote(borrower.address, borrower.address, onChainQuote)
      ).to.be.reverted

      await addressRegistry.connect(team).toggleTokens([weth.address, usdc.address], false)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted

      await addressRegistry.connect(team).toggleTokens([weth.address], true)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted

      await addressRegistry.connect(team).toggleTokens([usdc.address], true)
      await addressRegistry.connect(team).toggleTokens([weth.address], false)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted

      await addressRegistry.connect(team).toggleTokens([weth.address], true)

      onChainQuote.generalQuoteInfo.collToken = usdc.address

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted

      onChainQuote.generalQuoteInfo.collToken = weth.address

      borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.reverted
    })

    it('Should update and delete on-chain quota successfully', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

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
          isSingleUse: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      quoteTuples[0].loanPerCollUnitOrLtv = ONE_USDC.mul(900)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      await expect(quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteDeleted'
      )
    })
  })
})
