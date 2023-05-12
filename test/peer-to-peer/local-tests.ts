import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { LenderVaultImpl, MyERC20 } from '../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { payloadScheme } from './helpers/abi'
import { setupBorrowerWhitelist } from './helpers/misc'

// test config vars
let snapshotId: String // use snapshot id to reset state before each test

// constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_DAY = ethers.BigNumber.from(60 * 60 * 24)
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

async function generateOffChainQuote({
  lenderVault,
  lender,
  whitelistAuthority,
  weth,
  usdc,
  offChainQuoteBodyInfo = {},
  generalQuoteInfo = {},
  customSignature = {},
  earliestRepayTenor = 0
}: {
  lenderVault: LenderVaultImpl
  lender: SignerWithAddress
  whitelistAuthority: SignerWithAddress
  weth: MyERC20
  usdc: MyERC20
  offChainQuoteBodyInfo?: any
  generalQuoteInfo?: any
  customSignature?: any
  earliestRepayTenor?: any
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
  const chainId = (await ethers.getDefaultProvider().getNetwork()).chainId
  let offChainQuote = {
    generalQuoteInfo: {
      whitelistAuthority: whitelistAuthority.address,
      collToken: weth.address,
      loanToken: usdc.address,
      oracleAddr: ZERO_ADDRESS,
      minLoan: ONE_USDC.mul(1000),
      maxLoan: MAX_UINT256,
      validUntil: timestamp + 60,
      earliestRepayTenor: earliestRepayTenor,
      borrowerCompartmentImplementation: ZERO_ADDRESS,
      isSingleUse: false,
      ...generalQuoteInfo
    },
    quoteTuplesRoot: quoteTuplesRoot,
    salt: ZERO_BYTES32,
    nonce: 0,
    v: [0],
    r: [ZERO_BYTES32],
    s: [ZERO_BYTES32],
    ...offChainQuoteBodyInfo
  }

  const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
    offChainQuote.generalQuoteInfo,
    offChainQuote.quoteTuplesRoot,
    offChainQuote.salt,
    offChainQuote.nonce,
    lenderVault.address,
    chainId
  ])

  const payloadHash = ethers.utils.keccak256(payload)
  const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
  const sig = ethers.utils.splitSignature(signature)
  const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
  expect(recoveredAddr).to.equal(lender.address)

  // add signer
  await lenderVault.connect(lender).addSigners([lender.address])

  // lender add sig to quote and pass to borrower
  offChainQuote.v = customSignature.v || [sig.v]
  offChainQuote.r = customSignature.r || [sig.r]
  offChainQuote.s = customSignature.s || [sig.s]

  return { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash }
}

describe('Peer-to-Peer: Local Tests', function () {
  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  async function setupTest() {
    const [lender, borrower, team, whitelistAuthority, signer1, signer2, signer3] = await ethers.getSigners()
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
    // reverts if zero address is passed as address registry or lender vault implementation
    await expect(LenderVaultFactory.connect(team).deploy(ZERO_ADDRESS, lenderVaultImplementation.address)).to.be.revertedWithCustomError(
      LenderVaultFactory,
      'InvalidAddress'
    )
    await expect(LenderVaultFactory.connect(team).deploy(addressRegistry.address, ZERO_ADDRESS)).to.be.revertedWithCustomError(
      LenderVaultFactory,
      'InvalidAddress'
    )
    // correct deployment
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // reverts if user tries to create vault before initialized because address registry doesn't have lender vault factory set yet
    await expect(lenderVaultFactory.connect(lender).createVault()).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidSender'
    )

    // reverts if trying to set whitelist state to tokens (=1) before address registry is initialized
    await expect(addressRegistry.connect(team).setWhitelistState([team.address], 1)).to.be.revertedWithCustomError(
      addressRegistry,
      'Uninitialized'
    )

    // initialize address registry
    await expect(
      addressRegistry.connect(lender).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSender')
    await expect(
      addressRegistry.connect(team).initialize(ZERO_ADDRESS, borrowerGateway.address, quoteHandler.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidAddress')
    await expect(
      addressRegistry.connect(team).initialize(lenderVaultFactory.address, ZERO_ADDRESS, quoteHandler.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidAddress')
    await expect(
      addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, ZERO_ADDRESS)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidAddress')
    await expect(
      addressRegistry.connect(team).initialize(lenderVaultFactory.address, lenderVaultFactory.address, quoteHandler.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'DuplicateAddresses')
    await expect(
      addressRegistry
        .connect(team)
        .initialize(lenderVaultFactory.address, borrowerGateway.address, lenderVaultFactory.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'DuplicateAddresses')
    await expect(
      addressRegistry.connect(team).initialize(lenderVaultFactory.address, quoteHandler.address, quoteHandler.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'DuplicateAddresses')
    await addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
    await expect(
      addressRegistry.connect(team).initialize(team.address, borrower.address, lender.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'AlreadyInitialized')
    await expect(
      addressRegistry.connect(lender).initialize(team.address, borrower.address, lender.address)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSender')

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault()
    const lenderVaultAddrs = await addressRegistry.registeredVaults()
    const lenderVaultAddr = lenderVaultAddrs[0]
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // reverts if trying to initialize base contract
    await expect(lenderVault.connect(lender).initialize(lender.address, addressRegistry.address)).to.be.revertedWith(
      'Initializable: contract is already initialized'
    )

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
    await expect(addressRegistry.connect(lender).setWhitelistState([weth.address], 1)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidSender'
    )
    await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 1)
    await expect(addressRegistry.connect(team).setWhitelistState([ZERO_ADDRESS], 1)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidAddress'
    )
    expect(await addressRegistry.whitelistState(ZERO_ADDRESS)).to.be.equal(0)
    expect(await addressRegistry.whitelistState(weth.address)).to.be.equal(1)
    expect(await addressRegistry.whitelistState(usdc.address)).to.be.equal(1)

    // reverts if trying to manually add lenderVault
    await expect(addressRegistry.connect(team).addLenderVault(lenderVaultAddr)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidSender'
    )

    return {
      addressRegistry,
      borrowerGateway,
      quoteHandler,
      lender,
      borrower,
      team,
      whitelistAuthority,
      signer1,
      signer2,
      signer3,
      usdc,
      weth,
      lenderVault
    }
  }

  describe('Address Registry', function () {
    it('Should handle borrower whitelist correctly', async function () {
      const { addressRegistry, team, lender, borrower, whitelistAuthority } = await setupTest()

      // define whitelistedUntil
      let blocknum = await ethers.provider.getBlockNumber()
      let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil1 = Number(timestamp.toString()) + 60 * 60 * 365

      // get chain id
      const chainId = (await ethers.getDefaultProvider().getNetwork()).chainId

      // get salt
      const salt = ZERO_BYTES32

      // construct payload and sign
      let payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'bytes32'],
        [borrower.address, whitelistedUntil1, chainId, salt]
      )
      let payloadHash = ethers.utils.keccak256(payload)
      const signature1 = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash))
      const sig1 = ethers.utils.splitSignature(signature1)
      let recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig1)
      expect(recoveredAddr).to.equal(whitelistAuthority.address)

      // revert if non-authorized borrower tries to claim status
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false
      await expect(
        addressRegistry
          .connect(team)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, signature1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSignature')
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false

      // revert if trying to claim whitelist with whitelist authority being zero address
      await expect(
        addressRegistry.connect(team).claimBorrowerWhitelistStatus(ZERO_ADDRESS, whitelistedUntil1, signature1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSignature')

      // move forward past valid until timestamp
      await ethers.provider.send('evm_mine', [whitelistedUntil1 + 1])

      // revert if whitelistedUntil is before than current block time
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, signature1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'CannotClaimOutdatedStatus')
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false

      // do new sig
      blocknum = await ethers.provider.getBlockNumber()
      timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil2 = Number(timestamp.toString()) + 60 * 60 * 365
      payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'bytes32'],
        [borrower.address, whitelistedUntil2, chainId, salt]
      )
      payloadHash = ethers.utils.keccak256(payload)
      const signature2 = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash))
      const sig2 = ethers.utils.splitSignature(signature2)
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig2)

      // have borrower claim whitelist status
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, borrower.address)).to.be.false
      await addressRegistry
        .connect(borrower)
        .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil2, signature2, salt)
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, borrower.address)).to.be.true

      // revert if trying to claim again
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil2, signature2, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'CannotClaimOutdatedStatus')

      // revert if trying to claim previous sig with outdated whitelistedUntil timestamp
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, signature1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'CannotClaimOutdatedStatus')

      // revert if whitelist authority tries to set same whitelistedUntil on borrower
      await expect(
        addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([borrower.address], whitelistedUntil2)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidUpdate')

      // revert if whitelist authority tries to whitelist zero address
      await expect(
        addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([ZERO_ADDRESS], whitelistedUntil2)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidUpdate')

      // check that whitelist authority can overwrite whitelistedUntil
      await addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([borrower.address], 0)
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, borrower.address)).to.be.false
      await addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([borrower.address], MAX_UINT256)
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, borrower.address)).to.be.true
    })
  })

  describe('Lender Vault', function () {
    it('Should handle ownership transfer correctly', async function () {
      const { lender, team, borrower, lenderVault } = await setupTest()

      // check that only owner can propose new owner
      await expect(lenderVault.connect(team).proposeNewOwner(team.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

      // check that new owner can't be zero address
      await expect(lenderVault.connect(lender).proposeNewOwner(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // check that new owner can't be lender vault address itself
      await expect(lenderVault.connect(lender).proposeNewOwner(lenderVault.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // add signer
      await lenderVault.connect(lender).addSigners([borrower.address])

      // check that new owner can't be a signer
      await expect(lenderVault.connect(lender).proposeNewOwner(borrower.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // make valid owner proposal
      await expect(lenderVault.connect(lender).proposeNewOwner(team.address)).to.emit(lenderVault, 'NewOwnerProposed')

      // claim ownership
      await expect(lenderVault.connect(team).claimOwnership()).to.emit(lenderVault, 'ClaimedOwnership')

      // check that old owner can't propose new owner anymore
      await expect(lenderVault.connect(lender).proposeNewOwner(borrower.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )
    })

    it('Should handle deposits and withdrawals correctly (1/2)', async function () {
      const { addressRegistry, team, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      let depositAmount
      let withdrawAmount
      let preLenderBal
      let preVaultBal
      let postLenderBal
      let postVaultBal

      // lenderVault owner deposits usdc
      depositAmount = ONE_USDC.mul(100000)
      preLenderBal = await usdc.balanceOf(lender.address)
      preVaultBal = await usdc.balanceOf(lenderVault.address)
      await usdc.connect(lender).transfer(lenderVault.address, depositAmount)
      postLenderBal = await usdc.balanceOf(lender.address)
      postVaultBal = await usdc.balanceOf(lenderVault.address)
      expect(postVaultBal.sub(preVaultBal)).to.be.equal(preLenderBal.sub(postLenderBal))

      // reverts if non-owner tries to withdraw
      withdrawAmount = depositAmount.div(3)
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

      // reverts if non-owner tries to withdraw invalid amount
      withdrawAmount = 0
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )
      withdrawAmount = depositAmount.add(1)
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

      // reverts if owner tries to withdraw invalid token
      withdrawAmount = depositAmount
      await expect(lenderVault.connect(lender).withdraw(weth.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )

      // reverts if owner tries to withdraw invalid amount
      withdrawAmount = depositAmount.add(1)
      await expect(lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )
      withdrawAmount = 0
      await expect(lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )

      // whitelisting shouldn't affect withdrawability
      await addressRegistry.connect(team).setWhitelistState([usdc.address], 1)

      // lender can withdraw valid token and amount
      withdrawAmount = depositAmount.div(3)
      preLenderBal = await usdc.balanceOf(lender.address)
      preVaultBal = await usdc.balanceOf(lenderVault.address)
      await lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)
      postLenderBal = await usdc.balanceOf(lender.address)
      postVaultBal = await usdc.balanceOf(lenderVault.address)
      expect(postLenderBal.sub(preLenderBal)).to.be.equal(preVaultBal.sub(postVaultBal))

      // de-whitelisting shouldn't affect withdrawability
      await addressRegistry.connect(team).setWhitelistState([usdc.address], 0)

      // transfer ownership to new vault owner
      await lenderVault.connect(lender).proposeNewOwner(team.address)
      await lenderVault.connect(team).claimOwnership()

      // reverts if old owner tries to withdraw
      await expect(lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

      // new owner can withdraw
      withdrawAmount = postVaultBal
      preLenderBal = await usdc.balanceOf(team.address)
      preVaultBal = await usdc.balanceOf(lenderVault.address)
      await lenderVault.connect(team).withdraw(usdc.address, withdrawAmount)
      postLenderBal = await usdc.balanceOf(team.address)
      postVaultBal = await usdc.balanceOf(lenderVault.address)
      expect(postLenderBal.sub(preLenderBal)).to.be.equal(preVaultBal.sub(postVaultBal))
    })

    it('Should handle deposits and withdrawals correctly (2/2)', async function () {
      const {
        addressRegistry,
        quoteHandler,
        borrowerGateway,
        team,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      let depositAmount
      let withdrawAmount
      let preLenderBal
      let preVaultBal
      let postLenderBal
      let postVaultBal

      // lenderVault owner deposits usdc
      depositAmount = ONE_USDC.mul(100000)
      preLenderBal = await usdc.balanceOf(lender.address)
      preVaultBal = await usdc.balanceOf(lenderVault.address)
      await usdc.connect(lender).transfer(lenderVault.address, depositAmount)
      postLenderBal = await usdc.balanceOf(lender.address)
      postVaultBal = await usdc.balanceOf(lenderVault.address)
      expect(postVaultBal.sub(preVaultBal)).to.be.equal(preLenderBal.sub(postLenderBal))

      // lenderVault owner deposits weth
      depositAmount = ONE_WETH.mul(1000)
      await weth.mint(lender.address, depositAmount)
      preLenderBal = await weth.balanceOf(lender.address)
      preVaultBal = await weth.balanceOf(lenderVault.address)
      await weth.connect(lender).transfer(lenderVault.address, depositAmount)
      postLenderBal = await weth.balanceOf(lender.address)
      postVaultBal = await weth.balanceOf(lenderVault.address)
      expect(postVaultBal.sub(preVaultBal)).to.be.equal(preLenderBal.sub(postLenderBal))

      // reverts if non-owner tries to withdraw
      withdrawAmount = usdc.balanceOf(lenderVault.address)
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )
      withdrawAmount = weth.balanceOf(lenderVault.address)
      await expect(lenderVault.connect(borrower).withdraw(weth.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

      // reverts if owner tries to withdraw invalid amount
      withdrawAmount = (await usdc.balanceOf(lenderVault.address)).add(1)
      await expect(lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )
      withdrawAmount = (await weth.balanceOf(lenderVault.address)).add(1)
      await expect(lenderVault.connect(lender).withdraw(weth.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )

      // prepare borrow, lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(10).div(100),
          upfrontFeePctInBase: BASE.mul(1).div(100),
          tenor: ONE_DAY.mul(90)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          whitelistAuthority: whitelistAuthority.address,
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

      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

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
      const expectedLoanAmount = quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmount).div(ONE_WETH)
      const expectedReclaimableAmount = collSendAmount.sub(collSendAmount.mul(quoteTuples[0].upfrontFeePctInBase).div(BASE))

      // check pre/post amounts on borrow
      let preLockedWethAmounts = await lenderVault.lockedAmounts(weth.address)
      let preLockedUsdcAmounts = await lenderVault.lockedAmounts(usdc.address)
      let preVaultWethBal = await weth.balanceOf(lenderVault.address)
      let preBorrowerWethBal = await weth.balanceOf(borrower.address)
      let preVaultUsdcBal = await usdc.balanceOf(lenderVault.address)
      let preBorrowerUsdcBal = await usdc.balanceOf(borrower.address)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      let postLockedWethAmounts = await lenderVault.lockedAmounts(weth.address)
      let postLockedUsdcAmounts = await lenderVault.lockedAmounts(usdc.address)
      let postVaultWethBal = await weth.balanceOf(lenderVault.address)
      let postBorrowerWethBal = await weth.balanceOf(borrower.address)
      let postVaultUsdcBal = await usdc.balanceOf(lenderVault.address)
      let postBorrowerUsdcBal = await usdc.balanceOf(borrower.address)

      // check collateral amount diffs
      expect(postVaultWethBal.sub(preVaultWethBal)).to.be.equal(preBorrowerWethBal.sub(postBorrowerWethBal))
      // check loan amount diffs
      expect(preVaultUsdcBal.sub(postVaultUsdcBal)).to.be.equal(postBorrowerUsdcBal.sub(preBorrowerUsdcBal))
      expect(expectedLoanAmount).to.be.equal(postBorrowerUsdcBal.sub(preBorrowerUsdcBal))
      // check locked amounts
      expect(preLockedWethAmounts).to.be.equal(0)
      expect(preLockedUsdcAmounts).to.be.equal(0)
      expect(postLockedUsdcAmounts).to.be.equal(0)
      expect(postLockedWethAmounts).to.be.equal(expectedReclaimableAmount)

      // de-whitelisting shouldn't affect withdrawability
      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 0)

      // de-whitelisting should affect new borrows
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      // should revert when trying to withdraw whole lender vault balance, which also incl locked amounts
      withdrawAmount = await weth.balanceOf(lenderVault.address)
      await expect(lenderVault.connect(lender).withdraw(weth.address, withdrawAmount)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidWithdrawAmount'
      )

      // do valid withdrawals (1/2)
      withdrawAmount = (await weth.balanceOf(lenderVault.address)).sub(expectedReclaimableAmount)
      preLenderBal = await weth.balanceOf(lender.address)
      preVaultBal = await weth.balanceOf(lenderVault.address)
      await lenderVault.connect(lender).withdraw(weth.address, withdrawAmount)
      postLenderBal = await weth.balanceOf(lender.address)
      postVaultBal = await weth.balanceOf(lenderVault.address)
      expect(postLenderBal.sub(preLenderBal)).to.be.equal(preVaultBal.sub(postVaultBal))

      // do valid withdrawals (2/2)
      withdrawAmount = await usdc.balanceOf(lenderVault.address)
      preLenderBal = await usdc.balanceOf(lender.address)
      preVaultBal = await usdc.balanceOf(lenderVault.address)
      await lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)
      postLenderBal = await usdc.balanceOf(lender.address)
      postVaultBal = await usdc.balanceOf(lenderVault.address)
      expect(postLenderBal.sub(preLenderBal)).to.be.equal(preVaultBal.sub(postVaultBal))
    })

    it('Should not proccess with insufficient vault funds', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // check that only owner can propose new owner
      await expect(lenderVault.connect(borrower).proposeNewOwner(borrower.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

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
          whitelistAuthority: ZERO_ADDRESS,
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
      ).to.be.revertedWithCustomError(lenderVault, 'InsufficientVaultFunds')

      // allow for transfer of vault ownership
      await lenderVault.connect(lender).proposeNewOwner(borrower.address)
      // only new proposed owner can claim vault
      await expect(lenderVault.connect(lender).claimOwnership()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')
      await lenderVault.connect(borrower).claimOwnership()
    })
  })

  describe('Borrow Gateway', function () {
    it('Should not proccess with bigger fee than max fee', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      await expect(borrowerGateway.connect(lender).setProtocolFee(0)).to.be.revertedWithCustomError(
        borrowerGateway,
        'InvalidSender'
      )
      await expect(borrowerGateway.connect(team).setProtocolFee(BASE)).to.be.revertedWithCustomError(
        borrowerGateway,
        'InvalidFee'
      )

      // set max protocol fee p.a.
      await borrowerGateway.connect(team).setProtocolFee(BASE.mul(5).div(100))

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote with very long tenor, which leads to protocol fee being larger than pledge
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let onChainQuote = {
        generalQuoteInfo: {
          whitelistAuthority: ZERO_ADDRESS,
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
        quoteTuples: [
          {
            loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
            interestRatePctInBase: BASE.mul(20).div(100),
            upfrontFeePctInBase: 0,
            tenor: ONE_DAY.mul(365).mul(20)
          }
        ],
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

      // reverts if trying to borrow with quote where protocol fee would exceed pledge amount
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(borrowerGateway, 'InvalidSendAmount')
    })
  })

  describe('Off-Chain Quote Testing', function () {
    it('Should process off-chain quote correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // test add, remove, set min signer functionality
      await expect(lenderVault.addSigners([lender.address, lender.address])).to.be.revertedWithCustomError(
        lenderVault,
        'AlreadySigner'
      )
      await expect(lenderVault.addSigners([ZERO_ADDRESS])).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')
      await expect(lenderVault.setMinNumOfSigners(0)).to.be.revertedWithCustomError(lenderVault, 'InvalidNewMinNumOfSigners')
      await lenderVault.connect(lender).setMinNumOfSigners(4)
      await expect(lenderVault.setMinNumOfSigners(4)).to.be.revertedWithCustomError(lenderVault, 'InvalidNewMinNumOfSigners')
      const minNumSigners = await lenderVault.minNumOfSigners()
      expect(minNumSigners).to.be.equal(4)
      await lenderVault.connect(lender).setMinNumOfSigners(1)
      await lenderVault.connect(lender).addSigners([team.address, borrower.address])
      // errors in handling signers
      await expect(lenderVault.connect(lender).removeSigner(borrower.address, 2)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidArrayIndex'
      )
      await expect(lenderVault.connect(lender).removeSigner(borrower.address, 2)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidArrayIndex'
      )
      await expect(lenderVault.connect(lender).removeSigner(weth.address, 0)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSignerRemoveInfo'
      )
      await expect(lenderVault.connect(lender).removeSigner(borrower.address, 0)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSignerRemoveInfo'
      )
      // valid remove
      await lenderVault.connect(lender).removeSigner(borrower.address, 1)

      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })
      // generate off chain quote
      const { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
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
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidBorrower')

      // if deadline passed, reverts
      await expect(
        borrowerGateway
          .connect(team)
          .borrowWithOffChainQuote(
            lenderVault.address,
            { ...borrowInstructions, deadline: 10 },
            offChainQuote,
            selectedQuoteTuple,
            proof
          )
      ).to.be.revertedWithCustomError(borrowerGateway, 'DeadlinePassed')

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
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidBorrower')

      // check balance post borrow
      const borrowerWethBalPost = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)

      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
      expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))

      // borrower executes valid off chain quote
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // invalidate off chain quote
      await expect(
        quoteHandler.connect(lender).invalidateOffChainQuote(borrower.address, payloadHash)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')
      await expect(
        quoteHandler.connect(borrower).invalidateOffChainQuote(lenderVault.address, payloadHash)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')

      await expect(quoteHandler.connect(lender).invalidateOffChainQuote(lenderVault.address, payloadHash)).to.emit(
        quoteHandler,
        'OffChainQuoteInvalidated'
      )

      await expect(
        borrowerGateway
          .connect(team)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidBorrower')
    })

    it('Should handle off-chain quote nonce correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      // lender produces quote
      const { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
        weth,
        usdc
      })

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 0
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)

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

      // borrower executes valid off chain quote
      await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      // lender increments off chain quote nonce to invalidate older quotes
      await quoteHandler.connect(lender).incrementOffChainQuoteNonce(lenderVault.address)

      // reverts if nonce is outdated
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should validate off-chain validUntil quote correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
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

      // move forward past valid until timestamp
      await ethers.provider.send('evm_mine', [Number(offChainQuote.generalQuoteInfo.validUntil.toString()) + 1])

      // reverts if trying to borrow with outdated quote
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'OutdatedQuote')
    })

    it('Should validate off-chain validUntil quote correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
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
      ).to.be.revertedWithCustomError(quoteHandler, 'OutdatedQuote')
    })

    it('Should validate off-chain singleUse quote correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
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
        return x.event === 'Borrowed'
      })

      expect(borrowEvent).not.be.undefined

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'OffChainQuoteHasBeenInvalidated')
    })

    it('Should validate off-chain earliest repay correctly', async function () {
      const { addressRegistry, borrowerGateway, lender, borrower, whitelistAuthority, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      // generate offchain quote where earliest repay is after loan expiry/tenor
      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
        weth,
        usdc,
        generalQuoteInfo: {
          isSingleUse: true
        },
        earliestRepayTenor: ONE_DAY.mul(360)
      })

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 0
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)

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

      // reverts if trying to borrow with offchain quote that would lead to a loan that cannot be repaid as earliest repay is after expiry
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(lenderVault, 'ExpiresBeforeRepayAllowed')
    })

    it('Should validate off-chain MerkleProof correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
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
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainMerkleProof')
    })

    it('Should validate off-chain wrong signature correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
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
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')
    })

    it('Should handle case of multiple signers correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault,
        signer1,
        signer2,
        signer3
      } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))
      // set borrower whitelist
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
        weth,
        usdc
      })

      // define signer setup without lender
      await lenderVault.connect(lender).removeSigner(lender.address, 0)
      await lenderVault.connect(lender).addSigners([signer1.address, signer2.address, signer3.address])
      await lenderVault.connect(lender).setMinNumOfSigners(3)

      // prepare signatures
      const chainId = (await ethers.getDefaultProvider().getNetwork()).chainId
      const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
        offChainQuote.generalQuoteInfo,
        offChainQuote.quoteTuplesRoot,
        offChainQuote.salt,
        offChainQuote.nonce,
        lenderVault.address,
        chainId
      ])
      const payloadHash = ethers.utils.keccak256(payload)

      // signer1, signer2, signer3
      const signature1 = await signer1.signMessage(ethers.utils.arrayify(payloadHash))
      const sig1 = ethers.utils.splitSignature(signature1)
      let recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig1)
      expect(recoveredAddr).to.equal(signer1.address)
      const signature2 = await signer2.signMessage(ethers.utils.arrayify(payloadHash))
      const sig2 = ethers.utils.splitSignature(signature2)
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig2)
      expect(recoveredAddr).to.equal(signer2.address)
      const signature3 = await signer3.signMessage(ethers.utils.arrayify(payloadHash))
      const sig3 = ethers.utils.splitSignature(signature3)
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig3)
      expect(recoveredAddr).to.equal(signer3.address)

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 0
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)

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

      // check revert on redundant sigs
      offChainQuote.v = [sig1.v, sig2.v, sig1.v]
      offChainQuote.r = [sig1.r, sig2.r, sig1.r]
      offChainQuote.s = [sig1.s, sig2.s, sig1.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on redundant sigs
      offChainQuote.v = [sig1.v, sig2.v, sig2.v]
      offChainQuote.r = [sig1.r, sig2.r, sig2.r]
      offChainQuote.s = [sig1.s, sig2.s, sig2.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on redundant sigs
      offChainQuote.v = [sig1.v, sig1.v, sig2.v]
      offChainQuote.r = [sig1.r, sig1.r, sig2.r]
      offChainQuote.s = [sig1.s, sig1.s, sig2.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on unauthorized sigs
      const signature4 = await lender.signMessage(ethers.utils.arrayify(payloadHash))
      const sig4 = ethers.utils.splitSignature(signature4)
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig4)
      expect(recoveredAddr).to.equal(lender.address)
      offChainQuote.v = [sig1.v, sig2.v, sig4.v]
      offChainQuote.r = [sig1.r, sig2.r, sig4.r]
      offChainQuote.s = [sig1.s, sig2.s, sig4.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on too few sigs
      offChainQuote.v = [sig1.v, sig2.v]
      offChainQuote.r = [sig1.r, sig2.r]
      offChainQuote.s = [sig1.s, sig2.s]

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on too few sigs
      offChainQuote.v = [sig1.v, sig3.v]
      offChainQuote.r = [sig1.r, sig3.r]
      offChainQuote.s = [sig1.s, sig3.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on too few sigs
      offChainQuote.v = [sig2.v, sig3.v]
      offChainQuote.r = [sig2.r, sig3.r]
      offChainQuote.s = [sig2.s, sig3.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert if signature arrays unequal length
      offChainQuote.v = [sig1.v, sig2.v, sig3.v]
      offChainQuote.r = [sig2.r, sig3.r]
      offChainQuote.s = [sig1.s, sig2.s, sig3.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert if signature arrays unequal length
      offChainQuote.v = [sig1.v, sig2.v, sig3.v]
      offChainQuote.r = [sig1.r, sig2.r, sig3.r]
      offChainQuote.s = [sig2.s, sig3.s]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check borrow tx successful if correct number of valid sigs
      offChainQuote.v = [sig1.v, sig2.v, sig3.v]
      offChainQuote.r = [sig1.r, sig2.r, sig3.r]
      offChainQuote.s = [sig1.s, sig2.s, sig3.s]
      const borrowWithOffChainQuoteTransaction = await borrowerGateway
        .connect(borrower)
        .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)

      const borrowWithOnChainQuoteReceipt = await borrowWithOffChainQuoteTransaction.wait()

      const borrowEvent = borrowWithOnChainQuoteReceipt.events?.find(x => {
        return x.event === 'Borrowed'
      })

      expect(borrowEvent).not.be.undefined
    })

    it('Should validate correctly the wrong incrementOffChainQuoteNonce', async function () {
      const { quoteHandler, borrower, lender, lenderVault } = await setupTest()

      const offChainQuoteNoncePre = await quoteHandler.connect(lender).offChainQuoteNonce(lenderVault.address)

      await expect(quoteHandler.connect(lender).incrementOffChainQuoteNonce(lender.address)).to.be.revertedWithCustomError(
        quoteHandler,
        'UnregisteredVault'
      )
      await expect(
        quoteHandler.connect(borrower).incrementOffChainQuoteNonce(lenderVault.address)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')

      await expect(quoteHandler.connect(lender).incrementOffChainQuoteNonce(lenderVault.address))

      const offChainQuoteNoncePost = await quoteHandler.connect(lender).offChainQuoteNonce(lenderVault.address)

      expect(offChainQuoteNoncePre.toNumber() + 1).to.equal(offChainQuoteNoncePost)
    })

    it('Should process off-chain quote with zero or negative interest rate factor correctly', async function () {
      const { addressRegistry, borrowerGateway, lender, borrower, team, whitelistAuthority, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      await lenderVault.connect(lender).addSigners([team.address])

      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

      let badQuoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.sub(BASE.mul(3)),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(180)
        },
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
          interestRatePctInBase: BASE.mul(-1),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(365)
        }
      ]

      const badQuoteTuplesTree = StandardMerkleTree.of(
        badQuoteTuples.map(quoteTuple => Object.values(quoteTuple)),
        ['uint256', 'int256', 'uint256', 'uint256']
      )
      const badQuoteTuplesRoot = badQuoteTuplesTree.root
      const chainId = (await ethers.getDefaultProvider().getNetwork()).chainId

      let offChainQuoteWithBadTuples = {
        generalQuoteInfo: {
          whitelistAuthority: whitelistAuthority.address,
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
        quoteTuplesRoot: badQuoteTuplesRoot,
        salt: ZERO_BYTES32,
        nonce: 0,
        v: [0],
        r: [ZERO_BYTES32],
        s: [ZERO_BYTES32]
      }

      const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
        offChainQuoteWithBadTuples.generalQuoteInfo,
        offChainQuoteWithBadTuples.quoteTuplesRoot,
        offChainQuoteWithBadTuples.salt,
        offChainQuoteWithBadTuples.nonce,
        lenderVault.address,
        chainId
      ])

      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      expect(recoveredAddr).to.equal(lender.address)

      // add signer
      await lenderVault.connect(lender).addSigners([lender.address])

      // lender add sig to quote and pass to borrower
      offChainQuoteWithBadTuples.v = [sig.v]
      offChainQuoteWithBadTuples.r = [sig.r]
      offChainQuoteWithBadTuples.s = [sig.s]

      // borrower obtains proof for quote tuple idx 0
      let quoteTupleIdx = 0
      let selectedQuoteTuple = badQuoteTuples[quoteTupleIdx]
      let proof = badQuoteTuplesTree.getProof(quoteTupleIdx)
      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

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

      // check revert if negative interest rate factor
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(
            lenderVault.address,
            borrowInstructions,
            offChainQuoteWithBadTuples,
            selectedQuoteTuple,
            proof
          )
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidInterestRateFactor')

      // borrower obtains proof for quote tuple idx 1
      quoteTupleIdx = 1
      selectedQuoteTuple = badQuoteTuples[quoteTupleIdx]
      proof = badQuoteTuplesTree.getProof(quoteTupleIdx)

      // check revert if zero interest rate factor
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(
            lenderVault.address,
            borrowInstructions,
            offChainQuoteWithBadTuples,
            selectedQuoteTuple,
            proof
          )
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidInterestRateFactor')
    })
  })

  describe('On-Chain Quote Testing', function () {
    it('Should process on-chain quote correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

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
          whitelistAuthority: whitelistAuthority.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY,
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
      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

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

      // revert if trying to repay before earliest repay
      const loanId = 0
      const loanInfo = await lenderVault.loan(loanId)
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: loanInfo.initRepayAmount,
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackData
        )
      ).to.be.revertedWithCustomError(lenderVault, 'OutsideValidRepayWindow')

      // move forward past valid until timestamp
      await ethers.provider.send('evm_mine', [Number(onChainQuote.generalQuoteInfo.validUntil.toString()) + 1])

      // revert if trying to execute quote after valid until
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'OutdatedQuote')
    })

    it('Should process on-chain single use quote correctly', async function () {
      const {
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault,
        addressRegistry
      } = await setupTest()

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
          whitelistAuthority: whitelistAuthority.address,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: ONE_USDC.mul(2000),
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY.mul(360),
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: true
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      // reverts if trying to add quote where earliest repay is after loan expiry
      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

      // set earliest repay back to value that is consistent with tenors
      onChainQuote.generalQuoteInfo.earliestRepayTenor = ethers.BigNumber.from(0)

      // add valid onchain quote
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )
      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry,
        borrower,
        whitelistAuthority,
        whitelistedUntil
      })

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
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')

      await expect(
        quoteHandler
          .connect(lender)
          .checkAndRegisterOnChainQuote(borrower.address, borrower.address, quoteTupleIdx, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')

      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 0)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([weth.address], 0)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 0)
      await addressRegistry.connect(team).setWhitelistState([weth.address], 1)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 1)

      onChainQuote.generalQuoteInfo.collToken = usdc.address

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

      onChainQuote.generalQuoteInfo.collToken = weth.address

      // revert if coll send amount would result in loan larger than lender specified max loan amount
      borrowInstructions.collSendAmount = ONE_WETH.mul(10)
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidSendAmount')

      // update coll send amount back to smaller valid amount
      borrowInstructions.collSendAmount = ONE_WETH

      // execute valid borrow
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // retrieve valid loan info
      const loan = await lenderVault.loan(0)

      // revert if trying to retrieve non-existent loan
      await expect(lenderVault.loan(1)).to.be.revertedWithCustomError(lenderVault, 'InvalidArrayIndex')

      // revert if trying to execute same single-use quote again
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnknownOnChainQuote')
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
          whitelistAuthority: ZERO_ADDRESS,
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
