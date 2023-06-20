import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { LenderVaultImpl, MyERC20 } from '../../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { payloadScheme } from './helpers/abi'
import { setupBorrowerWhitelist } from './helpers/misc'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG } from '../../hardhat.config'

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
  whitelistAuthority = ZERO_ADDRESS,
  weth,
  usdc,
  offChainQuoteBodyInfo = {},
  generalQuoteInfo = {},
  customSignatures = [],
  earliestRepayTenor = 0,
  minLoan = ONE_USDC.mul(1000),
  maxLoan = MAX_UINT256
}: {
  lenderVault: LenderVaultImpl
  lender: SignerWithAddress
  whitelistAuthority?: any
  weth: MyERC20
  usdc: MyERC20
  offChainQuoteBodyInfo?: any
  generalQuoteInfo?: any
  customSignatures?: any[]
  earliestRepayTenor?: any
  minLoan?: any
  maxLoan?: any
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
    },
    {
      loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
      interestRatePctInBase: 0,
      upfrontFeePctInBase: BASE,
      tenor: 1 // invalid for upfront fee = 100%
    },
    {
      loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
      interestRatePctInBase: 0,
      upfrontFeePctInBase: BASE.div(10),
      tenor: 0 // invalid for upfront fee < 100%
    },
    {
      loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
      interestRatePctInBase: 0,
      upfrontFeePctInBase: BASE,
      tenor: 0 // valid swap quote
    },
    {
      loanPerCollUnitOrLtv: ONE_USDC.mul(1000),
      interestRatePctInBase: 0,
      upfrontFeePctInBase: BASE.add(1), // invalid swap quote
      tenor: 0
    },
    {
      loanPerCollUnitOrLtv: 0, // invalid quote with zero loan amount
      interestRatePctInBase: 0,
      upfrontFeePctInBase: 0,
      tenor: ONE_DAY.mul(90)
    }
  ]
  const quoteTuplesTree = StandardMerkleTree.of(
    quoteTuples.map(quoteTuple => Object.values(quoteTuple)),
    ['uint256', 'uint256', 'uint256', 'uint256']
  )
  const quoteTuplesRoot = quoteTuplesTree.root
  let offChainQuote = {
    generalQuoteInfo: {
      collToken: weth.address,
      loanToken: usdc.address,
      oracleAddr: ZERO_ADDRESS,
      minLoan: minLoan,
      maxLoan: maxLoan,
      validUntil: timestamp + 60,
      earliestRepayTenor: earliestRepayTenor,
      borrowerCompartmentImplementation: ZERO_ADDRESS,
      isSingleUse: false,
      whitelistAddr: whitelistAuthority == ZERO_ADDRESS ? ZERO_ADDRESS : whitelistAuthority.address,
      isWhitelistAddrSingleBorrower: false,
      ...generalQuoteInfo
    },
    quoteTuplesRoot: quoteTuplesRoot,
    salt: ZERO_BYTES32,
    nonce: 0,
    compactSigs: [],
    ...offChainQuoteBodyInfo
  }

  const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
    offChainQuote.generalQuoteInfo,
    offChainQuote.quoteTuplesRoot,
    offChainQuote.salt,
    offChainQuote.nonce,
    lenderVault.address,
    HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId
  ])

  const payloadHash = ethers.utils.keccak256(payload)
  const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
  const sig = ethers.utils.splitSignature(signature)
  const compactSig = sig.compact

  const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
  expect(recoveredAddr).to.equal(lender.address)

  // add signer
  await lenderVault.connect(lender).addSigners([lender.address])

  // lender add sig to quote and pass to borrower
  offChainQuote.compactSigs = customSignatures.length != 0 ? customSignatures : [compactSig]
  return { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash }
}

describe('Peer-to-Peer: Local Tests', function () {
  before(async () => {
    console.log('Note: Running local tests with the following hardhat chain id config:')
    console.log(HARDHAT_CHAIN_ID_AND_FORKING_CONFIG)
    if (HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId !== 31337) {
      throw new Error(
        `Invalid hardhat forking config! Expected 'HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId' to be 31337 but it is '${HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId}'!`
      )
    }
  })

  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  async function setupTest() {
    const [lender, borrower, team, whitelistAuthority, addr1, addr2, addr3] = await ethers.getSigners()
    /* ************************************ */
    /* DEPLOYMENT OF SYSTEM CONTRACTS START */
    /* ************************************ */

    // deploy address registry
    const AddressRegistry = await ethers.getContractFactory('AddressRegistry')
    const addressRegistry = await AddressRegistry.connect(team).deploy()
    await addressRegistry.deployed()

    // deploy borrower gateway
    const BorrowerGateway = await ethers.getContractFactory('BorrowerGateway')
    // reverts if zero address is passed as address registry
    await expect(BorrowerGateway.connect(team).deploy(ZERO_ADDRESS)).to.be.revertedWithCustomError(
      BorrowerGateway,
      'InvalidAddress'
    )
    const borrowerGateway = await BorrowerGateway.connect(team).deploy(addressRegistry.address)
    await borrowerGateway.deployed()

    // deploy quote handler
    const QuoteHandler = await ethers.getContractFactory('QuoteHandler')
    // reverts if zero address is passed as address registry
    await expect(QuoteHandler.connect(team).deploy(ZERO_ADDRESS)).to.be.revertedWithCustomError(
      QuoteHandler,
      'InvalidAddress'
    )
    const quoteHandler = await QuoteHandler.connect(team).deploy(addressRegistry.address)
    await quoteHandler.deployed()

    // deploy lender vault implementation
    const LenderVaultImplementation = await ethers.getContractFactory('LenderVaultImpl')
    const lenderVaultImplementation = await LenderVaultImplementation.connect(team).deploy()
    await lenderVaultImplementation.deployed()

    // deploy LenderVaultFactory
    const LenderVaultFactory = await ethers.getContractFactory('LenderVaultFactory')
    // reverts if zero address is passed as address registry or lender vault implementation
    await expect(
      LenderVaultFactory.connect(team).deploy(ZERO_ADDRESS, lenderVaultImplementation.address)
    ).to.be.revertedWithCustomError(LenderVaultFactory, 'InvalidAddress')
    await expect(
      LenderVaultFactory.connect(team).deploy(addressRegistry.address, ZERO_ADDRESS)
    ).to.be.revertedWithCustomError(LenderVaultFactory, 'InvalidAddress')
    // correct deployment
    const lenderVaultFactory = await LenderVaultFactory.connect(team).deploy(
      addressRegistry.address,
      lenderVaultImplementation.address
    )
    await lenderVaultFactory.deployed()

    // deploy wrapped ERC721 Implementation
    const WrappedERC721Implementation = await ethers.getContractFactory('WrappedERC721Impl')
    const wrappedERC721Implementation = await WrappedERC721Implementation.connect(team).deploy()
    await wrappedERC721Implementation.deployed()
    await expect(
      wrappedERC721Implementation.initialize(team.address, [{ tokenAddr: ZERO_ADDRESS, tokenIds: [0] }], '', '')
    ).to.be.revertedWith('Initializable: contract is already initialized')

    // deploy ERC721 wrapper
    const ERC721Wrapper = await ethers.getContractFactory('ERC721Wrapper')
    const erc721Wrapper = await ERC721Wrapper.connect(team).deploy(
      addressRegistry.address,
      wrappedERC721Implementation.address
    )
    await erc721Wrapper.deployed()

    const erc721WrapperWithoutRegistry = await ERC721Wrapper.connect(team).deploy(
      ZERO_ADDRESS,
      wrappedERC721Implementation.address
    )
    await erc721WrapperWithoutRegistry.deployed()

    // should revert on zero address in implementation
    await expect(ERC721Wrapper.connect(team).deploy(addressRegistry.address, ZERO_ADDRESS)).to.be.revertedWithCustomError(
      erc721Wrapper,
      'InvalidAddress'
    )

    // deploy token basket wrapper implementation
    const WrappedERC20Impl = await ethers.getContractFactory('WrappedERC20Impl')
    const wrappedERC20Impl = await WrappedERC20Impl.connect(team).deploy()
    await wrappedERC20Impl.deployed()

    // deploy token basket wrapper
    const ERC20Wrapper = await ethers.getContractFactory('ERC20Wrapper')
    const erc20Wrapper = await ERC20Wrapper.connect(team).deploy(addressRegistry.address, wrappedERC20Impl.address)
    await erc20Wrapper.deployed()

    // deploy token basket wrapper without registry
    const tokenBasketWrapperWithoutRegistry = await ERC20Wrapper.connect(team).deploy(ZERO_ADDRESS, wrappedERC20Impl.address)
    await tokenBasketWrapperWithoutRegistry.deployed()

    // should revert on zero address in implementation
    await expect(ERC20Wrapper.connect(team).deploy(addressRegistry.address, ZERO_ADDRESS)).to.be.revertedWithCustomError(
      erc20Wrapper,
      'InvalidAddress'
    )

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

    // test erc721 wrapper whitelisting
    let whitelistState
    let erc721WrapperAddr

    // reverts if trying to set zero address as ERC721 wrapper contract
    await expect(addressRegistry.connect(team).setWhitelistState([ZERO_ADDRESS], 7)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidAddress'
    )

    // successfully set some ERC721 wrapper contract
    await addressRegistry.connect(team).setWhitelistState([team.address], 7)
    erc721WrapperAddr = await addressRegistry.erc721Wrapper()
    expect(erc721WrapperAddr).to.be.equal(team.address)
    whitelistState = await addressRegistry.whitelistState(team.address)
    expect(whitelistState).to.be.equal(7)
    // reverts if trying to set same ERC721 wrapper contract
    await expect(addressRegistry.connect(team).setWhitelistState([team.address], 7)).to.be.revertedWithCustomError(
      addressRegistry,
      'StateAlreadySet'
    )

    // successfully unset ERC721 wrapper contract
    await addressRegistry.connect(team).setWhitelistState([team.address], 0)
    erc721WrapperAddr = await addressRegistry.erc721Wrapper()
    expect(erc721WrapperAddr).to.be.equal(ZERO_ADDRESS)
    whitelistState = await addressRegistry.whitelistState(team.address)
    expect(whitelistState).to.be.equal(0)

    // test ERC20 wrapper whitelisting
    let erc20WrapperAddr

    // reverts if trying to set zero address as ERC20 wrapper contract
    await expect(addressRegistry.connect(team).setWhitelistState([ZERO_ADDRESS], 8)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidAddress'
    )

    // successfully set some ERC20 wrapper contract
    await addressRegistry.connect(team).setWhitelistState([team.address], 8)
    erc20WrapperAddr = await addressRegistry.erc20Wrapper()
    expect(erc20WrapperAddr).to.be.equal(team.address)
    whitelistState = await addressRegistry.whitelistState(team.address)
    expect(whitelistState).to.be.equal(8)
    // reverts if trying to set same ERC20 wrapper contract
    await expect(addressRegistry.connect(team).setWhitelistState([team.address], 8)).to.be.revertedWithCustomError(
      addressRegistry,
      'StateAlreadySet'
    )

    // successfully unset ERC20 wrapper contract
    await addressRegistry.connect(team).setWhitelistState([team.address], 0)
    erc20WrapperAddr = await addressRegistry.erc20Wrapper()
    expect(erc20WrapperAddr).to.be.equal(ZERO_ADDRESS)
    whitelistState = await addressRegistry.whitelistState(team.address)
    expect(whitelistState).to.be.equal(0)

    // test myso token manager whitelisting
    let mysoTokenManagerAddr

    // reverts if trying to set zero address as myso token manager
    await expect(addressRegistry.connect(team).setWhitelistState([ZERO_ADDRESS], 9)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidAddress'
    )

    // successfully set some myso token manager
    await addressRegistry.connect(team).setWhitelistState([team.address], 9)
    mysoTokenManagerAddr = await addressRegistry.mysoTokenManager()
    expect(mysoTokenManagerAddr).to.be.equal(team.address)
    whitelistState = await addressRegistry.whitelistState(team.address)
    expect(whitelistState).to.be.equal(9)
    // reverts if trying to set same myso token manager
    await expect(addressRegistry.connect(team).setWhitelistState([team.address], 9)).to.be.revertedWithCustomError(
      addressRegistry,
      'StateAlreadySet'
    )

    // successfully unset myso token manager contract
    await addressRegistry.connect(team).setWhitelistState([team.address], 0)
    mysoTokenManagerAddr = await addressRegistry.mysoTokenManager()
    expect(mysoTokenManagerAddr).to.be.equal(ZERO_ADDRESS)
    whitelistState = await addressRegistry.whitelistState(team.address)
    expect(whitelistState).to.be.equal(0)

    // successfully set some myso token manager
    await addressRegistry.connect(team).setWhitelistState([team.address], 9)
    // check that updating to non-singleton state resets myso token manager to zero
    await addressRegistry.connect(team).setWhitelistState([team.address], 1)
    mysoTokenManagerAddr = await addressRegistry.mysoTokenManager()
    expect(mysoTokenManagerAddr).to.be.equal(ZERO_ADDRESS)
    // reset address whitelist state
    await addressRegistry.connect(team).setWhitelistState([team.address], 0)

    // successfully set some myso token manager
    await addressRegistry.connect(team).setWhitelistState([team.address], 9)
    // check that updating to a different singleton state resets myso token manager to zero
    await addressRegistry.connect(team).setWhitelistState([team.address], 8)
    mysoTokenManagerAddr = await addressRegistry.mysoTokenManager()
    expect(mysoTokenManagerAddr).to.be.equal(ZERO_ADDRESS)
    // reset address whitelist state
    await addressRegistry.connect(team).setWhitelistState([team.address], 0)

    // check that 2 addresses cannot have the same singleton state
    await addressRegistry.connect(team).setWhitelistState([team.address], 9)
    await expect(addressRegistry.connect(team).setWhitelistState([lender.address], 9)).to.be.revertedWithCustomError(
      addressRegistry,
      'StateAlreadySet'
    )
    // reset address whitelist state
    await addressRegistry.connect(team).setWhitelistState([team.address], 0)

    // reverts if nft wrapper contract address is zero
    await expect(
      addressRegistry.connect(team).createWrappedTokenForERC721s([{ tokenAddr: ZERO_ADDRESS, tokenIds: [1] }], '', '')
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidAddress')

    // reverts if token basket wrapper contract address is zero
    await expect(
      addressRegistry.connect(team).createWrappedTokenForERC20s([{ tokenAddr: ZERO_ADDRESS, tokenAmount: 1000 }], '', '')
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidAddress')

    await addressRegistry.connect(team).setWhitelistState([borrower.address], 4)
    await addressRegistry.connect(team).setWhitelistState([borrower.address], 0)

    // add testnet token manager
    const TestnetTokenManager = await ethers.getContractFactory('TestnetTokenManager')
    const testnetTokenManager = await TestnetTokenManager.deploy()
    await testnetTokenManager.deployed()
    await addressRegistry.connect(team).setWhitelistState([testnetTokenManager.address], 9)

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
    const MyERC721 = await ethers.getContractFactory('MyERC721')

    const USDC = await MyERC20.connect(team)
    const usdc = await USDC.deploy('USDC', 'USDC', 6)
    await usdc.deployed()

    const WETH = await MyERC20.connect(team)
    const weth = await WETH.deploy('WETH', 'WETH', 18)
    await weth.deployed()

    const MyFirstNFT = await MyERC721.connect(team)
    const myFirstNFT = await MyFirstNFT.deploy('MyFirstNFT', 'MFNFT')
    await myFirstNFT.deployed()

    const MySecondNFT = await MyERC721.connect(team)
    const mySecondNFT = await MySecondNFT.deploy('MySecondNFT', 'MSNFT')
    await mySecondNFT.deployed()

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

    const sortedAddrs = [addr1, addr2, addr3].sort((a, b) => (ethers.BigNumber.from(a.address).lt(b.address) ? -1 : 1))

    return {
      addressRegistry,
      borrowerGateway,
      quoteHandler,
      lender,
      borrower,
      team,
      whitelistAuthority,
      signer1: sortedAddrs[0],
      signer2: sortedAddrs[1],
      signer3: sortedAddrs[2],
      usdc,
      weth,
      lenderVault,
      wrappedERC721Implementation,
      erc721Wrapper,
      erc721WrapperWithoutRegistry,
      wrappedERC20Impl,
      erc20Wrapper,
      tokenBasketWrapperWithoutRegistry,
      myFirstNFT,
      mySecondNFT,
      testnetTokenManager
    }
  }

  describe('Address Registry', function () {
    it('Should handle borrower whitelist correctly', async function () {
      const { addressRegistry, team, lender, borrower, whitelistAuthority } = await setupTest()

      // define whitelistedUntil
      let blocknum = await ethers.provider.getBlockNumber()
      let timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil1 = Number(timestamp.toString()) + 60 * 60 * 365

      // get salt
      const salt = ZERO_BYTES32

      // construct payload and sign
      let payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'bytes32'],
        [addressRegistry.address, borrower.address, whitelistedUntil1, HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId, salt]
      )
      let payloadHash = ethers.utils.keccak256(payload)
      const signature1 = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash))
      const sig1 = ethers.utils.splitSignature(signature1)
      const compactSig1 = sig1.compact
      let recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig1)
      expect(recoveredAddr).to.equal(whitelistAuthority.address)

      // revert if non-authorized borrower tries to claim status
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false
      await expect(
        addressRegistry
          .connect(team)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, compactSig1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSignature')
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false

      // revert if trying to claim whitelist with whitelist authority being zero address
      await expect(
        addressRegistry.connect(team).claimBorrowerWhitelistStatus(ZERO_ADDRESS, whitelistedUntil1, compactSig1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSignature')

      // move forward past valid until timestamp
      await ethers.provider.send('evm_mine', [whitelistedUntil1 + 1])

      // revert if whitelistedUntil is before than current block time
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, compactSig1, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'CannotClaimOutdatedStatus')
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, team.address)).to.be.false

      // do new sig
      blocknum = await ethers.provider.getBlockNumber()
      timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil2 = Number(timestamp.toString()) + 60 * 60 * 365
      payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'bytes32'],
        [addressRegistry.address, borrower.address, whitelistedUntil2, HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId, salt]
      )
      payloadHash = ethers.utils.keccak256(payload)
      const signature2 = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash))
      const sig2 = ethers.utils.splitSignature(signature2)
      const compactSig2 = sig2.compact
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig2)

      // have borrower claim whitelist status
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, borrower.address)).to.be.false
      await addressRegistry
        .connect(borrower)
        .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil2, compactSig2, salt)
      expect(await addressRegistry.isWhitelistedBorrower(whitelistAuthority.address, borrower.address)).to.be.true

      // revert if trying to claim again
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil2, compactSig2, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSignature')

      // revert if trying to claim previous sig with outdated whitelistedUntil timestamp
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, compactSig1, salt)
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

      // check that user can't backrun dewhitelisting
      await expect(
        addressRegistry
          .connect(borrower)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil1, compactSig2, salt)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidSignature')

      // whitelist user again
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

      // check that you can't re-submit same new owner proposal
      await expect(lenderVault.connect(lender).proposeNewOwner(team.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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

    it('Should not process with insufficient vault funds', async function () {
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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
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
    it('Should not process with bigger fee than max fee', async function () {
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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
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

    it('Should not process off-chain quote with invalid min/max loan amount (1/2)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lender produces invalid quote off-chain
      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        weth,
        usdc,
        minLoan: 2,
        maxLoan: 1
      })

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 0
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)
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

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // reverts if trying to borrow with quote that would result in zero loan amount
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should not process off-chain quote with invalid min/max loan amount (2/2)', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lender produces invalid quote off-chain
      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        weth,
        usdc,
        minLoan: 0,
        maxLoan: 0
      })

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 0
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)
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

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // reverts if trying to borrow with quote that would result in zero loan amount
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })

    it('Should not process zero loan amounts', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lenderVault owner gives quote that results in zero loan amount
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp

      let onChainQuote = {
        generalQuoteInfo: {
          whitelistAuthority: ZERO_ADDRESS,
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: 0,
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: [
          {
            loanPerCollUnitOrLtv: 0, // invalid value
            interestRatePctInBase: BASE.mul(20).div(100),
            upfrontFeePctInBase: 0,
            tenor: ONE_DAY.mul(365).mul(20)
          }
        ],
        salt: ZERO_BYTES32
      }

      // check invalid on-chain quote cannot bet added
      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // lender produces invalid quote off-chain
      const { offChainQuote, quoteTuples, quoteTuplesTree, payloadHash } = await generateOffChainQuote({
        lenderVault,
        lender,
        weth,
        usdc,
        minLoan: 0
      })

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 6
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)
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

      // reverts if trying to borrow with quote that would result in zero loan amount
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(lenderVault, 'TooSmallLoanAmount')
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidEarliestRepay')
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        team,
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      // generate off chain quote with bad signature
      const payloadHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('some payload'))
      const someSignature = await team.signMessage(ethers.utils.arrayify(payloadHash))
      const someSig = ethers.utils.splitSignature(someSignature)
      const someCompactSig = someSig.compact
      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        whitelistAuthority,
        weth,
        usdc,
        customSignatures: [someCompactSig]
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
      const payload = ethers.utils.defaultAbiCoder.encode(payloadScheme as any, [
        offChainQuote.generalQuoteInfo,
        offChainQuote.quoteTuplesRoot,
        offChainQuote.salt,
        offChainQuote.nonce,
        lenderVault.address,
        HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId
      ])
      const payloadHash = ethers.utils.keccak256(payload)

      // signer1, signer2, signer3
      const signature1 = await signer1.signMessage(ethers.utils.arrayify(payloadHash))
      const sig1 = ethers.utils.splitSignature(signature1)
      const compactSig1 = sig1.compact
      let recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig1)
      expect(recoveredAddr).to.equal(signer1.address)
      const signature2 = await signer2.signMessage(ethers.utils.arrayify(payloadHash))
      const sig2 = ethers.utils.splitSignature(signature2)
      const compactSig2 = sig2.compact
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig2)
      expect(recoveredAddr).to.equal(signer2.address)
      const signature3 = await signer3.signMessage(ethers.utils.arrayify(payloadHash))
      const sig3 = ethers.utils.splitSignature(signature3)
      const compactSig3 = sig3.compact
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
      offChainQuote.compactSigs = [compactSig1, compactSig2, compactSig1]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on redundant sigs
      offChainQuote.compactSigs = [compactSig1, compactSig2, compactSig2]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on redundant sigs
      offChainQuote.compactSigs = [compactSig1, compactSig1, compactSig2]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on unauthorized sigs
      const signature4 = await lender.signMessage(ethers.utils.arrayify(payloadHash))
      const sig4 = ethers.utils.splitSignature(signature4)
      const compactSig4 = sig4.compact
      recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig4)
      expect(recoveredAddr).to.equal(lender.address)
      offChainQuote.compactSigs = [compactSig1, compactSig2, compactSig4]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on too few sigs
      offChainQuote.compactSigs = [compactSig1, compactSig2]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on too few sigs
      offChainQuote.compactSigs = [compactSig1, compactSig3]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert on too few sigs
      offChainQuote.compactSigs = [compactSig2, compactSig3]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check revert if correct number of valid sigs but wrong order
      offChainQuote.compactSigs = [compactSig2, compactSig1, compactSig3]
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidOffChainSignature')

      // check borrow tx successful if correct number of valid sigs
      offChainQuote.compactSigs = [compactSig1, compactSig2, compactSig3]
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

      let offChainQuoteWithBadTuples = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
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
        HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId
      ])

      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await lender.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const compactSig = sig.compact
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      expect(recoveredAddr).to.equal(lender.address)

      // add signer
      await lenderVault.connect(lender).addSigners([lender.address])

      // lender add sig to quote and pass to borrower
      offChainQuoteWithBadTuples.compactSigs = [compactSig]

      // borrower obtains proof for quote tuple idx 0
      let quoteTupleIdx = 0
      let selectedQuoteTuple = badQuoteTuples[quoteTupleIdx]
      let proof = badQuoteTuplesTree.getProof(quoteTupleIdx)
      // get borrower whitelisted
      const whitelistedUntil = Number(timestamp.toString()) + 60 * 60 * 365
      await setupBorrowerWhitelist({
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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
        lenderVault,
        testnetTokenManager
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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
      })

      // check balance pre borrow
      const borrowerWethBalPre = await weth.balanceOf(borrower.address)
      const borrowerUsdcBalPre = await usdc.balanceOf(borrower.address)
      const borrowerMysoTokenBalPre = await testnetTokenManager.balanceOf(borrower.address)
      const vaultWethBalPre = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPre = await usdc.balanceOf(lenderVault.address)
      const vaultMysoTokenBalPre = await testnetTokenManager.balanceOf(lenderVault.address)
      expect(borrowerMysoTokenBalPre).to.be.equal(0)
      expect(vaultMysoTokenBalPre).to.be.equal(ONE_WETH) // from initial vault creation

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
      const borrowerMysoTokenBalPost = await testnetTokenManager.balanceOf(borrower.address)
      const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
      const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
      const vaultMysoTokenBalPost = await testnetTokenManager.balanceOf(lenderVault.address)

      expect(borrowerMysoTokenBalPost).to.be.equal(ONE_WETH)
      expect(vaultMysoTokenBalPost).to.be.equal(ONE_WETH.add(ONE_WETH))
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
      ).to.be.revertedWithCustomError(borrowerGateway, 'OutsideValidRepayWindow')

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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: ONE_USDC.mul(2000),
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY.mul(360),
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: true,
          whitelistAddr: whitelistAuthority.address,
          isWhitelistAddrSingleBorrower: false
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
        addressRegistry: addressRegistry,
        borrower: borrower,
        whitelistAuthority: whitelistAuthority,
        chainId: HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
        whitelistedUntil: whitelistedUntil
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

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

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

    it('Should process collateralized if compartment status correctly', async function () {
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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: ONE_USDC.mul(2000),
          validUntil: timestamp + 60,
          earliestRepayTenor: ONE_DAY.mul(360),
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: true,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      // set earliest repay back to value that is consistent with tenors
      onChainQuote.generalQuoteInfo.earliestRepayTenor = ethers.BigNumber.from(0)

      // set loan and coll token whitelist states
      await addressRegistry.connect(team).setWhitelistState([weth.address], 5)

      // quote cannot be added with coll token must be compartmentalized and no compartment
      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'CollateralMustBeCompartmentalized')

      // update coll token whitelist state
      await addressRegistry.connect(team).setWhitelistState([weth.address], 1)

      // add valid onchain quote
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

      await addressRegistry.connect(team).setWhitelistState([weth.address, usdc.address], 0)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([weth.address], 5)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedToken')

      await addressRegistry.connect(team).setWhitelistState([usdc.address], 5)

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(quoteHandler, 'CollateralMustBeCompartmentalized')

      // create aave staking implementation
      const AaveStakingCompartmentImplementation = await ethers.getContractFactory('AaveStakingCompartment')
      AaveStakingCompartmentImplementation.connect(team)
      const aaveStakingCompartmentImplementation = await AaveStakingCompartmentImplementation.deploy()
      await aaveStakingCompartmentImplementation.deployed()

      onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation = aaveStakingCompartmentImplementation.address

      await addressRegistry.connect(team).setWhitelistState([aaveStakingCompartmentImplementation.address], 3)
      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [weth.address], true)

      // add new valid onchain quote with compartment
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // execute valid borrow
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
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
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
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

  describe('Wrapped ERC721 Testing', function () {
    it('Should handle wrapping and redeeming of nfts correctly', async function () {
      const { addressRegistry, borrower, team, erc721Wrapper, erc721WrapperWithoutRegistry, myFirstNFT, mySecondNFT } =
        await setupTest()

      // should revert if minter is zero address
      await expect(
        erc721Wrapper
          .connect(borrower)
          .createWrappedToken(ZERO_ADDRESS, [{ tokenAddr: mySecondNFT.address, tokenIds: [1, 2] }], '', '')
      ).to.be.revertedWithCustomError(erc721Wrapper, 'InvalidAddress')

      // should revert if tokenInfo array has length 0
      await expect(erc721Wrapper.connect(team).createWrappedToken(team.address, [], '', '')).to.be.revertedWithCustomError(
        erc721Wrapper,
        'InvalidArrayLength'
      )

      // should revert if tokenIds array has length 0
      await expect(
        erc721Wrapper
          .connect(team)
          .createWrappedToken(team.address, [{ tokenAddr: mySecondNFT.address, tokenIds: [] }], '', '')
      ).to.be.revertedWithCustomError(erc721Wrapper, 'InvalidArrayLength')

      // should revert if address registry is non-zero and token is not whitelisted
      await expect(
        erc721Wrapper
          .connect(team)
          .createWrappedToken(team.address, [{ tokenAddr: mySecondNFT.address, tokenIds: [1, 2] }], '', '')
      ).to.be.revertedWithCustomError(erc721Wrapper, 'NonWhitelistedToken')

      // should pass through all the way until transfer, where it will revert
      await expect(
        erc721WrapperWithoutRegistry
          .connect(team)
          .createWrappedToken(team.address, [{ tokenAddr: mySecondNFT.address, tokenIds: [1, 2] }], '', '')
      ).to.be.revertedWithCustomError(erc721WrapperWithoutRegistry, 'TransferToWrappedTokenFailed')

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc721Wrapper.address], 7)
      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([myFirstNFT.address, mySecondNFT.address], 6)
      // mint tokens
      await myFirstNFT.connect(team).safeMint(borrower.address, 1)
      await myFirstNFT.connect(team).safeMint(borrower.address, 2)
      await mySecondNFT.connect(team).safeMint(borrower.address, 1)
      await mySecondNFT.connect(team).safeMint(borrower.address, 2)
      // check owner is borrower
      const ownerOFMyFirstNFT = await myFirstNFT.ownerOf(1)
      const ownerOFMySecondNFT = await mySecondNFT.ownerOf(1)
      expect(ownerOFMyFirstNFT).to.equal(borrower.address)
      expect(ownerOFMySecondNFT).to.equal(borrower.address)
      const ownerSecondOfMyFirstNFT = await myFirstNFT.ownerOf(2)
      const ownerSecondOfMySecondNFT = await mySecondNFT.ownerOf(2)
      expect(ownerSecondOfMyFirstNFT).to.equal(borrower.address)
      expect(ownerSecondOfMySecondNFT).to.equal(borrower.address)
      // set approval for wrapper contract
      await myFirstNFT.connect(borrower).setApprovalForAll(erc721Wrapper.address, true)
      await mySecondNFT.connect(borrower).setApprovalForAll(erc721Wrapper.address, true)

      // sort ERC721_TOKEN token addresses
      const sortedNFTAddrs = [myFirstNFT.address, mySecondNFT.address].sort((a, b) =>
        ethers.BigNumber.from(a).lte(b) ? -1 : 1
      )

      // check approvals
      const isApprovedForAll = await myFirstNFT.isApprovedForAll(borrower.address, erc721Wrapper.address)
      expect(isApprovedForAll).to.equal(true)
      const isApprovedForAll2 = await mySecondNFT.isApprovedForAll(borrower.address, erc721Wrapper.address)
      expect(isApprovedForAll2).to.equal(true)

      // should revert with token address array out of order
      await expect(
        erc721Wrapper.connect(borrower).createWrappedToken(
          borrower.address,
          [
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] },
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc721Wrapper, 'NonIncreasingTokenAddrs')

      // should revert with token id array out of order
      await expect(
        erc721Wrapper.connect(borrower).createWrappedToken(
          borrower.address,
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [2, 1] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc721Wrapper, 'NonIncreasingNonFungibleTokenIds')

      // create wrapped token
      await addressRegistry.connect(borrower).createWrappedTokenForERC721s(
        [
          { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
          { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
        ],
        'testName',
        'testSymbol'
      )

      const newWrappedTokenAddr = await erc721Wrapper.tokensCreated(0)

      const wrappedToken = await ethers.getContractAt('WrappedERC721Impl', newWrappedTokenAddr)

      const whitelistTokenState = await addressRegistry.whitelistState(newWrappedTokenAddr)

      // new token should be whitelisted as ERC20_TOKEN
      expect(whitelistTokenState).to.equal(1)

      // check borrower has balance of 1
      const borrowerWrappedTokenBalance = await wrappedToken.balanceOf(borrower.address)

      expect(borrowerWrappedTokenBalance).to.equal(1)

      // check total supply is 1
      const totalSupply = await wrappedToken.totalSupply()

      expect(totalSupply).to.equal(1)

      // check wrapped token name, symbol and decimal overrides
      const wrappedTokenName = await wrappedToken.name()
      const wrappedTokenSymbol = await wrappedToken.symbol()
      const wrappedTokenDecimals = await wrappedToken.decimals()
      expect(wrappedTokenName).to.equal('testName')
      expect(wrappedTokenSymbol).to.equal('testSymbol')
      expect(wrappedTokenDecimals).to.equal(0)

      const wrappedTokensInfo = await wrappedToken.getWrappedTokensInfo()
      expect(wrappedTokensInfo.length).to.equal(2)

      // check ownership of all NFTs has shifted to new wrapped token
      const currOwnerFirstNFTIdx1 = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2 = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1 = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2 = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1).to.equal(wrappedToken.address)
      expect(currOwnerFirstNFTIdx2).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx1).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx2).to.equal(wrappedToken.address)

      // should revert if not owner of wrapped token
      await expect(wrappedToken.connect(team).redeem()).to.be.revertedWithCustomError(wrappedToken, 'InvalidSender')

      await wrappedToken.connect(borrower).redeem()

      // check ownership of all NFTs has shifted back to borrower
      const currOwnerFirstNFTIdx1PostRedeem = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2PostRedeem = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1PostRedeem = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2PostRedeem = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1PostRedeem).to.equal(borrower.address)
      expect(currOwnerFirstNFTIdx2PostRedeem).to.equal(borrower.address)
      expect(currOwnerSecondNFTIdx1PostRedeem).to.equal(borrower.address)
      expect(currOwnerSecondNFTIdx2PostRedeem).to.equal(borrower.address)

      // check borrower has balance of 0
      const borrowerWrappedTokenBalancePostRedeem = await wrappedToken.balanceOf(borrower.address)
      expect(borrowerWrappedTokenBalancePostRedeem).to.equal(0)

      // check total supply is 0
      const totalSupplyPostRedeem = await wrappedToken.totalSupply()
      expect(totalSupplyPostRedeem).to.equal(0)
    })

    it('Should handle wrapping and borrowing of nfts correctly', async function () {
      const {
        addressRegistry,
        borrower,
        team,
        usdc,
        lender,
        erc721Wrapper,
        myFirstNFT,
        mySecondNFT,
        lenderVault,
        quoteHandler,
        borrowerGateway
      } = await setupTest()

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc721Wrapper.address], 7)
      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([myFirstNFT.address, mySecondNFT.address], 6)
      // mint tokens
      await myFirstNFT.connect(team).safeMint(borrower.address, 1)
      await myFirstNFT.connect(team).safeMint(borrower.address, 2)
      await mySecondNFT.connect(team).safeMint(borrower.address, 1)
      await mySecondNFT.connect(team).safeMint(borrower.address, 2)
      // check owner is borrower
      const ownerOFMyFirstNFT = await myFirstNFT.ownerOf(1)
      const ownerOFMySecondNFT = await mySecondNFT.ownerOf(1)
      expect(ownerOFMyFirstNFT).to.equal(borrower.address)
      expect(ownerOFMySecondNFT).to.equal(borrower.address)
      const ownerSecondOfMyFirstNFT = await myFirstNFT.ownerOf(2)
      const ownerSecondOfMySecondNFT = await mySecondNFT.ownerOf(2)
      expect(ownerSecondOfMyFirstNFT).to.equal(borrower.address)
      expect(ownerSecondOfMySecondNFT).to.equal(borrower.address)
      // set approval for wrapper contract
      await myFirstNFT.connect(borrower).setApprovalForAll(erc721Wrapper.address, true)
      await mySecondNFT.connect(borrower).setApprovalForAll(erc721Wrapper.address, true)

      // sort ERC721_TOKEN token addresses
      const sortedNFTAddrs = [myFirstNFT.address, mySecondNFT.address].sort((a, b) =>
        ethers.BigNumber.from(a).lte(b) ? -1 : 1
      )

      // check approvals
      const isApprovedForAll = await myFirstNFT.isApprovedForAll(borrower.address, erc721Wrapper.address)
      expect(isApprovedForAll).to.equal(true)
      const isApprovedForAll2 = await mySecondNFT.isApprovedForAll(borrower.address, erc721Wrapper.address)
      expect(isApprovedForAll2).to.equal(true)

      // create wrapped token
      await addressRegistry.connect(borrower).createWrappedTokenForERC721s(
        [
          { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
          { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
        ],
        'testName',
        'testSymbol'
      )

      const newWrappedTokenAddr = await erc721Wrapper.tokensCreated(0)

      const wrappedToken = await ethers.getContractAt('WrappedERC721Impl', newWrappedTokenAddr)

      const whitelistTokenState = await addressRegistry.whitelistState(newWrappedTokenAddr)

      // new token should be whitelisted as ERC20_TOKEN
      expect(whitelistTokenState).to.equal(1)

      // check borrower has balance of 1
      const borrowerWrappedTokenBalance = await wrappedToken.balanceOf(borrower.address)

      expect(borrowerWrappedTokenBalance).to.equal(1)

      // check total supply is 1
      const totalSupply = await wrappedToken.totalSupply()

      expect(totalSupply).to.equal(1)

      // check wrapped token name, symbol and decimal overrides
      const wrappedTokenName = await wrappedToken.name()
      const wrappedTokenSymbol = await wrappedToken.symbol()
      const wrappedTokenDecimals = await wrappedToken.decimals()
      expect(wrappedTokenName).to.equal('testName')
      expect(wrappedTokenSymbol).to.equal('testSymbol')
      expect(wrappedTokenDecimals).to.equal(0)

      const wrappedTokensInfo = await wrappedToken.getWrappedTokensInfo()
      expect(wrappedTokensInfo.length).to.equal(2)

      // check ownership of all NFTs has shifted to new wrapped token
      const currOwnerFirstNFTIdx1 = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2 = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1 = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2 = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1).to.equal(wrappedToken.address)
      expect(currOwnerFirstNFTIdx2).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx1).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx2).to.equal(wrappedToken.address)

      // prepare borrow, lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const depositAmount = ONE_USDC.mul(10000)
      await usdc.connect(lender).transfer(lenderVault.address, depositAmount)
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
          collToken: wrappedToken.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: ONE_USDC.mul(1000),
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves gateway and executes quote
      await wrappedToken.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount = 1
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
      const expectedLoanAmount = quoteTuples[0].loanPerCollUnitOrLtv
      const expectedReclaimableAmount = collSendAmount

      // check pre/post amounts on borrow
      let preLockedWrappedTokenAmounts = await lenderVault.lockedAmounts(wrappedToken.address)
      let preLockedUsdcAmounts = await lenderVault.lockedAmounts(usdc.address)
      let preVaultWrappedTokenBal = await wrappedToken.balanceOf(lenderVault.address)
      let preBorrowerWrappedTokenBal = await wrappedToken.balanceOf(borrower.address)
      let preVaultUsdcBal = await usdc.balanceOf(lenderVault.address)
      let preBorrowerUsdcBal = await usdc.balanceOf(borrower.address)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      let postLockedWrappedTokenAmounts = await lenderVault.lockedAmounts(wrappedToken.address)
      let postLockedUsdcAmounts = await lenderVault.lockedAmounts(usdc.address)
      let postVaultWrappedTokenBal = await wrappedToken.balanceOf(lenderVault.address)
      let postBorrowerWrappedTokenBal = await wrappedToken.balanceOf(borrower.address)
      let postVaultUsdcBal = await usdc.balanceOf(lenderVault.address)
      let postBorrowerUsdcBal = await usdc.balanceOf(borrower.address)

      expect(postLockedWrappedTokenAmounts).to.equal(preLockedWrappedTokenAmounts.add(collSendAmount))
      expect(postLockedUsdcAmounts).to.equal(preLockedUsdcAmounts)
      expect(postVaultWrappedTokenBal).to.equal(preVaultWrappedTokenBal.add(collSendAmount))
      expect(postBorrowerWrappedTokenBal).to.equal(preBorrowerWrappedTokenBal.sub(collSendAmount))
      expect(postVaultUsdcBal).to.equal(preVaultUsdcBal.sub(expectedLoanAmount))
      expect(postBorrowerUsdcBal).to.equal(preBorrowerUsdcBal.add(expectedLoanAmount))

      // check ownership of all NFTs is still wrapped Token
      const currOwnerFirstNFTIdx1PostBorrow = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2PostBorrow = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1PostBorrow = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2PostBorrow = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1PostBorrow).to.equal(wrappedToken.address)
      expect(currOwnerFirstNFTIdx2PostBorrow).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx1PostBorrow).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx2PostBorrow).to.equal(wrappedToken.address)

      await usdc.connect(lender).transfer(borrower.address, ONE_USDC.mul(1000))

      const loanId = 0
      const loanInfo = await lenderVault.loan(loanId)
      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: loanInfo.initRepayAmount.div(2),
            expectedTransferFee: 0
          },
          lenderVault.address,
          callbackAddr,
          callbackData
        )
      ).to.be.revertedWithCustomError(borrowerGateway, 'ReclaimAmountIsZero')

      await usdc.connect(borrower).approve(borrowerGateway.address, ONE_USDC.mul(10000))

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
      ).to.emit(borrowerGateway, 'Repaid')

      await wrappedToken.connect(borrower).redeem()

      // check ownership of all NFTs has shifted back to borrower
      const currOwnerFirstNFTIdx1PostRedeem = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2PostRedeem = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1PostRedeem = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2PostRedeem = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1PostRedeem).to.equal(borrower.address)
      expect(currOwnerFirstNFTIdx2PostRedeem).to.equal(borrower.address)
      expect(currOwnerSecondNFTIdx1PostRedeem).to.equal(borrower.address)
      expect(currOwnerSecondNFTIdx2PostRedeem).to.equal(borrower.address)

      // check borrower has balance of 0
      const borrowerWrappedTokenBalancePostRedeem = await wrappedToken.balanceOf(borrower.address)
      expect(borrowerWrappedTokenBalancePostRedeem).to.equal(0)

      // check total supply is 0
      const totalSupplyPostRedeem = await wrappedToken.totalSupply()
      expect(totalSupplyPostRedeem).to.equal(0)
    })
  })

  describe('Wrapped Token Basket Testing', function () {
    it('Should handle wrapping and redeeming of token basket correctly', async function () {
      const { addressRegistry, borrower, team, usdc, weth, erc20Wrapper, tokenBasketWrapperWithoutRegistry } =
        await setupTest()

      // should revert if minter is zero address
      await expect(
        erc20Wrapper.connect(borrower).createWrappedToken(
          ZERO_ADDRESS,
          [
            { tokenAddr: weth.address, tokenAmount: ONE_WETH },
            { tokenAddr: usdc.address, tokenAmount: ONE_USDC }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidAddress')

      // should revert if address registry is non-zero and token is not whitelisted
      await expect(
        erc20Wrapper.connect(team).createWrappedToken(
          team.address,
          [
            { tokenAddr: team.address, tokenAmount: ONE_WETH },
            { tokenAddr: usdc.address, tokenAmount: ONE_USDC }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'NonWhitelistedToken')

      // should pass through all the way until transfer, where it will revert because of no approval
      await expect(
        tokenBasketWrapperWithoutRegistry
          .connect(team)
          .createWrappedToken(team.address, [{ tokenAddr: weth.address, tokenAmount: ONE_WETH }], '', '')
      ).to.be.revertedWith('ERC20: insufficient allowance')

      const wrappedUsdcAmount = ONE_USDC.mul(876)
      const wrappedEthAmount = ONE_WETH.mul(8)
      await usdc.mint(borrower.address, wrappedUsdcAmount)
      await weth.mint(borrower.address, wrappedEthAmount)
      await usdc.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)
      await weth.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)

      const sortedTokenInfo = [
        { tokenAddr: weth.address, tokenAmount: wrappedEthAmount },
        { tokenAddr: usdc.address, tokenAmount: wrappedUsdcAmount }
      ].sort((a, b) => (ethers.BigNumber.from(a.tokenAddr).lte(b.tokenAddr) ? -1 : 1))

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address], 8)

      // should revert if token addrs are out of order
      await expect(
        erc20Wrapper.connect(borrower).createWrappedToken(
          borrower.address,
          [
            { tokenAddr: sortedTokenInfo[1].tokenAddr, tokenAmount: 1 },
            { tokenAddr: sortedTokenInfo[0].tokenAddr, tokenAmount: 1 }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'NonIncreasingTokenAddrs')

      // should revert if any token amount is equal to 0
      await expect(
        erc20Wrapper.connect(borrower).createWrappedToken(
          borrower.address,
          [
            { tokenAddr: sortedTokenInfo[1].tokenAddr, tokenAmount: 0 },
            { tokenAddr: sortedTokenInfo[0].tokenAddr, tokenAmount: 1 }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidSendAmount')
      await expect(
        erc20Wrapper.connect(borrower).createWrappedToken(
          borrower.address,
          [
            { tokenAddr: sortedTokenInfo[0].tokenAddr, tokenAmount: 1 },
            { tokenAddr: sortedTokenInfo[1].tokenAddr, tokenAmount: 0 }
          ],
          '',
          ''
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidSendAmount')

      // create wrapped token basket
      await addressRegistry.connect(borrower).createWrappedTokenForERC20s(
        [
          {
            tokenAddr: sortedTokenInfo[0].tokenAddr,
            tokenAmount: sortedTokenInfo[0].tokenAmount
          },
          {
            tokenAddr: sortedTokenInfo[1].tokenAddr,
            tokenAmount: sortedTokenInfo[1].tokenAmount
          }
        ],
        'testName',
        'testSymbol'
      )

      const newWrappedTokenAddr = await erc20Wrapper.tokensCreated(0)
      const wrappedToken = await ethers.getContractAt('WrappedERC20Impl', newWrappedTokenAddr)
      const whitelistTokenState = await addressRegistry.whitelistState(newWrappedTokenAddr)
      const isIOU = await wrappedToken.isIOU()

      // check name, symbol, and decimal overrides
      const wrappedTokenName = await wrappedToken.name()
      const wrappedTokenSymbol = await wrappedToken.symbol()
      const wrappedTokenDecimals = await wrappedToken.decimals()
      expect(wrappedTokenName).to.equal('testName')
      expect(wrappedTokenSymbol).to.equal('testSymbol')
      expect(wrappedTokenDecimals).to.equal(6)
      expect(whitelistTokenState).to.equal(1)
      expect(isIOU).to.equal(false)

      // check that tokens were stored in instance storage correctly
      const tokenAddrs = await wrappedToken.getWrappedTokensInfo()

      expect(tokenAddrs[0].tokenAddr).to.equal(sortedTokenInfo[0].tokenAddr)
      expect(tokenAddrs[1].tokenAddr).to.equal(sortedTokenInfo[1].tokenAddr)

      // new token should be whitelisted as ERC20_TOKEN
      expect(whitelistTokenState).to.equal(1)

      // check borrower has balance of minimum of two amounts, but no more than 10 ** 6
      const borrowerWrappedTokenBalance = await wrappedToken.balanceOf(borrower.address)
      const wrappedTokenSupplyCap = ethers.BigNumber.from(1000000)
      const minOfWrappedUsdcAndEthAmounts = wrappedUsdcAmount.lt(wrappedEthAmount) ? wrappedUsdcAmount : wrappedEthAmount
      const expectedWrappedTokenBalance = minOfWrappedUsdcAndEthAmounts.lt(wrappedTokenSupplyCap)
        ? minOfWrappedUsdcAndEthAmounts
        : wrappedTokenSupplyCap
      expect(borrowerWrappedTokenBalance).to.equal(expectedWrappedTokenBalance)

      // check total supply
      const totalSupply = await wrappedToken.totalSupply()
      expect(totalSupply).to.equal(expectedWrappedTokenBalance)

      // check ownership of all tokens has shifted to new wrapped token
      const usdcBalanceOfWrappedToken = await usdc.balanceOf(wrappedToken.address)
      const wethBalanceOfWrappedToken = await weth.balanceOf(wrappedToken.address)

      expect(usdcBalanceOfWrappedToken).to.equal(wrappedUsdcAmount)
      expect(wethBalanceOfWrappedToken).to.equal(wrappedEthAmount)

      const preRedeemUsdcBalance = await usdc.balanceOf(borrower.address)
      const preRedeemWethBalance = await weth.balanceOf(borrower.address)

      // should revert if redeem more than balance
      await expect(wrappedToken.connect(borrower).redeem(borrowerWrappedTokenBalance.add(1))).to.be.revertedWithCustomError(
        wrappedToken,
        'InvalidSendAmount'
      )
      await expect(wrappedToken.connect(team).redeem(0)).to.be.revertedWithCustomError(wrappedToken, 'InvalidSendAmount')

      // redeem half the balance
      await wrappedToken.connect(borrower).redeem(totalSupply.div(2))

      // check half of supply is burned
      const postPartialRedeemTotalSupply = await wrappedToken.totalSupply()
      expect(postPartialRedeemTotalSupply).to.equal(totalSupply.div(2))

      // check balance of borrower is half of original
      const postPartialRedeemBorrowerBalance = await wrappedToken.balanceOf(borrower.address)
      expect(postPartialRedeemBorrowerBalance).to.equal(borrowerWrappedTokenBalance.div(2))

      const postRedeemUsdcBalance = await usdc.balanceOf(borrower.address)
      const postRedeemWethBalance = await weth.balanceOf(borrower.address)

      expect(postRedeemUsdcBalance.sub(preRedeemUsdcBalance)).to.equal(usdcBalanceOfWrappedToken.div(2))
      expect(postRedeemWethBalance.sub(preRedeemWethBalance)).to.equal(wethBalanceOfWrappedToken.div(2))

      // redeem remaining balance
      await wrappedToken.connect(borrower).redeem(totalSupply.div(2))

      // check total supply is 0
      const postFullRedeemTotalSupply = await wrappedToken.totalSupply()
      expect(postFullRedeemTotalSupply).to.equal(0)

      // check balance of borrower is 0
      const postFullRedeemBorrowerBalance = await wrappedToken.balanceOf(borrower.address)
      expect(postFullRedeemBorrowerBalance).to.equal(0)

      // create wrapped placeholder token basket
      await addressRegistry.connect(borrower).createWrappedTokenForERC20s([], 'testPlaceholderName', 'testPlaceholderSymbol')

      const newPlaceholderWrappedTokenAddr = await erc20Wrapper.tokensCreated(1)
      const wrappedPlaceholderToken = await ethers.getContractAt('WrappedERC20Impl', newPlaceholderWrappedTokenAddr)
      const whitelistPlaceholderTokenState = await addressRegistry.whitelistState(newPlaceholderWrappedTokenAddr)

      // check name, symbol, and decimal overrides
      const wrappedPlaceholderTokenName = await wrappedPlaceholderToken.name()
      const wrappedPlaceholderTokenSymbol = await wrappedPlaceholderToken.symbol()
      const wrappedPlaceholderTokenDecimals = await wrappedPlaceholderToken.decimals()
      expect(wrappedPlaceholderTokenName).to.equal('testPlaceholderName')
      expect(wrappedPlaceholderTokenSymbol).to.equal('testPlaceholderSymbol')
      expect(wrappedPlaceholderTokenDecimals).to.equal(6)
      expect(whitelistPlaceholderTokenState).to.equal(1)
      expect(await wrappedPlaceholderToken.isIOU()).to.equal(true)

      const totalPlaceHolderSupply = await wrappedPlaceholderToken.totalSupply()
      expect(totalPlaceHolderSupply).to.equal(10 ** 6)
    })
  })

  describe('Edge Case Testing', function () {
    it('Should handle case correctly where borrower partially repays "almost" full loan amount', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, lender, borrower, team, usdc, lenderVault } = await setupTest()

      // deploy & whitelist test token
      const MyERC20 = await ethers.getContractFactory('MyERC20')
      const collToken = await MyERC20.deploy('COLL', 'COLL', 6)
      await collToken.deployed()
      await addressRegistry.connect(team).setWhitelistState([collToken.address], 1)

      // lenderVault owner deposits usdc
      await usdc.mint(lenderVault.address, ONE_USDC.mul(1000000000))

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: ONE_USDC.mul(1000000),
          interestRatePctInBase: 0,
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: collToken.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: 0,
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // prepare borrow params
      const collTokenSendAmount = ONE_USDC.mul(1000)
      const expectedTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount: collTokenSendAmount,
        expectedTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData
      }
      // mint coll tokens, approve gateway and execute quote
      await collToken.mint(borrower.address, collTokenSendAmount)
      await collToken.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // approve loan token
      await usdc.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      // check amountReclaimedSoFar on loan pre repay
      let loan = await lenderVault.loan(0)
      expect(loan.amountReclaimedSoFar).to.be.equal(0)

      // do partial repay of close to full loan amount
      const repayAmount1 = ONE_USDC.mul(1000000000).sub(999999)
      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: 0,
          targetRepayAmount: repayAmount1,
          expectedTransferFee: 0
        },
        lenderVault.address,
        callbackAddr,
        callbackData
      )

      // check amountReclaimedSoFar on loan after 1st repay
      loan = await lenderVault.loan(0)
      expect(loan.amountReclaimedSoFar).to.be.equal(999999999)

      // do partial repay of close to full loan amount
      const repayAmount2 = 999999
      await borrowerGateway.connect(borrower).repay(
        {
          targetLoanId: 0,
          targetRepayAmount: repayAmount2,
          expectedTransferFee: 0
        },
        lenderVault.address,
        callbackAddr,
        callbackData
      )

      // check amountReclaimedSoFar on loan after final repay
      loan = await lenderVault.loan(0)
      expect(loan.amountReclaimedSoFar).to.be.equal(1000000000)
    })

    it('Should handle repayment amount calculation with potential rounding error correctly', async function () {
      const { addressRegistry, borrowerGateway, quoteHandler, team, lender, borrower, lenderVault } = await setupTest()

      // test tokens
      const MyERC20 = await ethers.getContractFactory('MyERC20')
      const collToken = await MyERC20.deploy('COLL', 'COLL', 6)
      await collToken.deployed()
      const loanToken = await MyERC20.deploy('LOAN', 'LOAN', 0)
      await loanToken.deployed()
      await addressRegistry.connect(team).setWhitelistState([collToken.address, loanToken.address], 1)

      // lenderVault owner deposits usdc
      await loanToken.mint(lenderVault.address, MAX_UINT256)

      // lenderVault owner gives quote
      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      let quoteTuples = [
        {
          loanPerCollUnitOrLtv: 10,
          interestRatePctInBase: BASE.mul(30).div(100),
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(90)
        }
      ]
      let onChainQuote = {
        generalQuoteInfo: {
          collToken: collToken.address,
          loanToken: loanToken.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: 0,
          maxLoan: MAX_UINT256,
          validUntil: timestamp + 60,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // prepare borrow params
      const collTokenSendAmount = 692308
      const quoteTupleIdx = 0
      const borrowInstructions = {
        collSendAmount: collTokenSendAmount,
        expectedTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32
      }
      // mint coll tokens, approve gateway and execute quote
      await collToken.mint(borrower.address, collTokenSendAmount)
      await collToken.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)

      // get loan info
      const loan = await lenderVault.loan(0)
      expect(loan.initLoanAmount).to.be.equal(6)
      expect(loan.initRepayAmount).to.be.equal(9)
    })

    describe('Swap Testing (Edge Case for Loans with upfrontfee=100% and tenor=0)', function () {
      it('Should handle on-chain swap quotes correctly (1/2)', async function () {
        const { borrowerGateway, quoteHandler, lender, borrower, usdc, weth, lenderVault } = await setupTest()

        // lenderVault owner deposits usdc
        await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

        // lenderVault owner gives quote
        const blocknum = await ethers.provider.getBlockNumber()
        const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
        const buyPricePerCollToken = ONE_USDC.mul(1869)
        let quoteTuples = [
          {
            loanPerCollUnitOrLtv: buyPricePerCollToken,
            interestRatePctInBase: 0,
            upfrontFeePctInBase: BASE,
            tenor: 0
          }
        ]
        let onChainQuote = {
          generalQuoteInfo: {
            collToken: weth.address,
            loanToken: usdc.address,
            oracleAddr: ZERO_ADDRESS,
            minLoan: ONE_USDC.mul(1000),
            maxLoan: MAX_UINT256,
            validUntil: timestamp + 60,
            earliestRepayTenor: 0,
            borrowerCompartmentImplementation: ZERO_ADDRESS,
            isSingleUse: false,
            whitelistAddr: ZERO_ADDRESS,
            isWhitelistAddrSingleBorrower: false
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
        const numLoansPre = await lenderVault.totalNumLoans()
        const lockedAmountsWethPre = await lenderVault.lockedAmounts(weth.address)
        const lockedAmountsUsdcPre = await lenderVault.lockedAmounts(usdc.address)

        // borrower approves gateway and executes quote
        await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
        const sellAmountOfCollToken = ONE_WETH
        const expectedTransferFee = 0
        const quoteTupleIdx = 0
        const callbackAddr = ZERO_ADDRESS
        const callbackData = ZERO_BYTES32
        const borrowInstructions = {
          collSendAmount: sellAmountOfCollToken,
          expectedTransferFee,
          deadline: MAX_UINT256,
          minLoanAmount: 0,
          callbackAddr,
          callbackData
        }
        await borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
        const borrowerWethBalPost = await weth.balanceOf(borrower.address)
        const borrowerUsdcBalPost = await usdc.balanceOf(borrower.address)
        const vaultWethBalPost = await weth.balanceOf(lenderVault.address)
        const vaultUsdcBalPost = await usdc.balanceOf(lenderVault.address)
        const numLoansPost = await lenderVault.totalNumLoans()
        const lockedAmountsWethPost = await lenderVault.lockedAmounts(weth.address)
        const lockedAmountsUsdcPost = await lenderVault.lockedAmounts(usdc.address)

        // check balance post borrow
        expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(vaultWethBalPost.sub(vaultWethBalPre))
        expect(vaultWethBalPost.sub(vaultWethBalPre)).to.equal(sellAmountOfCollToken)
        expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(vaultUsdcBalPre.sub(vaultUsdcBalPost))
        expect(borrowerUsdcBalPost.sub(borrowerUsdcBalPre)).to.equal(
          buyPricePerCollToken.mul(sellAmountOfCollToken).div(ONE_WETH)
        )

        // check no change in locked amounts
        expect(lockedAmountsWethPost).to.equal(lockedAmountsWethPre)
        expect(lockedAmountsWethPost).to.equal(0)
        expect(lockedAmountsUsdcPost).to.equal(lockedAmountsUsdcPre)
        expect(lockedAmountsUsdcPost).to.equal(0)

        // check no loan was pushed
        expect(numLoansPost).to.equal(numLoansPre)
        expect(numLoansPost).to.equal(0)

        // check no repay possible
        await expect(
          borrowerGateway.connect(borrower).repay(
            {
              targetLoanId: 0,
              targetRepayAmount: buyPricePerCollToken,
              expectedTransferFee: 0
            },
            lenderVault.address,
            callbackAddr,
            callbackData
          )
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidArrayIndex')

        // check lender can unlock swapped amount (=upfront fee) immediately
        const userWethBalPreWithdraw = await weth.balanceOf(lender.address)
        const vaultWethBalPreWithdraw = await weth.balanceOf(lenderVault.address)
        await lenderVault.connect(lender).withdraw(weth.address, sellAmountOfCollToken)
        const userWethBalPostWithdraw = await weth.balanceOf(lender.address)
        const vaultWethBalPostWithdraw = await weth.balanceOf(lenderVault.address)
        expect(userWethBalPostWithdraw.sub(userWethBalPreWithdraw)).to.be.equal(
          vaultWethBalPreWithdraw.sub(vaultWethBalPostWithdraw)
        )
        expect(userWethBalPostWithdraw.sub(userWethBalPreWithdraw)).to.be.equal(sellAmountOfCollToken)
      })

      it('Should handle on-chain swap quotes correctly (2/2)', async function () {
        const { borrowerGateway, addressRegistry, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } =
          await setupTest()

        // lenderVault owner deposits usdc
        await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

        // lenderVault owner gives quote
        const blocknum = await ethers.provider.getBlockNumber()
        const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
        const buyPricePerCollToken = ONE_USDC.mul(1869)
        let quoteTuples = [
          {
            loanPerCollUnitOrLtv: buyPricePerCollToken,
            interestRatePctInBase: 0,
            upfrontFeePctInBase: BASE,
            tenor: 0
          }
        ]
        let onChainQuote = {
          generalQuoteInfo: {
            collToken: weth.address,
            loanToken: usdc.address,
            oracleAddr: ZERO_ADDRESS,
            minLoan: ONE_USDC.mul(1000),
            maxLoan: MAX_UINT256,
            validUntil: timestamp + 60,
            earliestRepayTenor: 0,
            borrowerCompartmentImplementation: ZERO_ADDRESS,
            isSingleUse: false,
            whitelistAddr: ZERO_ADDRESS,
            isWhitelistAddrSingleBorrower: false
          },
          quoteTuples: quoteTuples,
          salt: ZERO_BYTES32
        }

        // should revert with bad swap on-chain quote (tenor != 0)
        onChainQuote.quoteTuples[0].tenor = 1
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert with bad swap on-chain quote (earliest repay != 0)
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 1
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert with bad swap on-chain quote (tenor and earliest repay != 0)
        onChainQuote.quoteTuples[0].tenor = 1
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 1
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert with bad swap on-chain quote (upfrontfee < 100%)
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE.mul(0)
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert with bad swap on-chain quote (upfrontfee < 100%)
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE.div(10)
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert with bad swap on-chain quote (upfrontfee > 100%)
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE.add(1)
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert with bad swap on-chain quote (compartment address != 0x)
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE
        onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation = team.address
        // set dummy compartment to test revert when trying to add swap-quote with compartment
        await addressRegistry.connect(team).setWhitelistState([team.address], 3)
        await addressRegistry.connect(team).setAllowedTokensForCompartment(team.address, [weth.address], true)
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
        await addressRegistry.connect(team).setWhitelistState([team.address], 0)
        await addressRegistry.connect(team).setAllowedTokensForCompartment(team.address, [weth.address], false)

        // should revert if trying to add "mixed" quote tuples, where some correspond to loans and some to swaps
        // with potentially incompatible compartment requirements
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE
        onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation = ZERO_ADDRESS
        onChainQuote.quoteTuples.push({
          loanPerCollUnitOrLtv: buyPricePerCollToken,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: BASE.sub(1),
          tenor: Number(ONE_DAY.toString())
        })
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should revert if trying to add multiple swap quotes (no need to have multiple
        // swap quotes with different prices because takers would always take the cheaper one)
        onChainQuote.quoteTuples.pop()
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE
        onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation = ZERO_ADDRESS
        onChainQuote.quoteTuples.push({
          loanPerCollUnitOrLtv: buyPricePerCollToken.sub(1),
          interestRatePctInBase: 0,
          upfrontFeePctInBase: BASE,
          tenor: 0
        })
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // should pass with valid swap on-chain quote
        onChainQuote.quoteTuples.pop()
        onChainQuote.quoteTuples[0].tenor = 0
        onChainQuote.generalQuoteInfo.earliestRepayTenor = 0
        onChainQuote.quoteTuples[0].upfrontFeePctInBase = BASE
        onChainQuote.generalQuoteInfo.borrowerCompartmentImplementation = ZERO_ADDRESS
        await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
        const sellAmountOfCollToken = ONE_WETH
        const expectedTransferFee = 0
        const quoteTupleIdx = 0
        const callbackAddr = ZERO_ADDRESS
        const callbackData = ZERO_BYTES32
        const borrowInstructions = {
          collSendAmount: sellAmountOfCollToken,
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
        ).to.emit(lenderVault, 'QuoteProcessed')
      })

      it('Should handle off-chain swap quotes correctly (1/2)', async function () {
        const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

        // lenderVault owner deposits usdc
        await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

        // lender produces template off-chain quote (incl swap quote tuples)
        const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
          lenderVault,
          lender,
          whitelistAuthority: ZERO_ADDRESS,
          weth,
          usdc
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

        // borrower obtains proof for invalid quote tuple (tuple idx 2 has upfrontfee = 100% but tenor != 0)
        let quoteTupleIdx = 2
        let selectedQuoteTuple = quoteTuples[quoteTupleIdx]
        let proof = quoteTuplesTree.getProof(quoteTupleIdx)
        // should revert with invalid quote
        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidSwap')

        // borrower obtains proof for another invalid quote tuple (tuple idx 3 has upfrontfee < 100% but tenor = 0)
        quoteTupleIdx = 3
        selectedQuoteTuple = quoteTuples[quoteTupleIdx]
        proof = quoteTuplesTree.getProof(quoteTupleIdx)
        // should revert with invalid quote
        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidEarliestRepay')

        // borrower obtains proof for valid quote tuple (upfront fee = 100% and tenor = 0 and earliest repay = 0)
        quoteTupleIdx = 4
        selectedQuoteTuple = quoteTuples[quoteTupleIdx]
        proof = quoteTuplesTree.getProof(quoteTupleIdx)
        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
        ).to.emit(lenderVault, 'QuoteProcessed')

        // borrower obtains proof for invalid quote tuple (tuple idx 5 has upfrontfee > 100%)
        quoteTupleIdx = 5
        selectedQuoteTuple = quoteTuples[quoteTupleIdx]
        proof = quoteTuplesTree.getProof(quoteTupleIdx)
        // should revert with invalid quote
        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
        ).to.be.revertedWithCustomError(lenderVault, 'InsufficientSendAmount')
      })

      it('Should handle off-chain swap quotes correctly (2/2)', async function () {
        const { borrowerGateway, lender, borrower, usdc, weth, lenderVault } = await setupTest()

        // lenderVault owner deposits usdc
        await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

        // lender produces quote with earliest repay != 0
        const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
          lenderVault,
          lender,
          whitelistAuthority: ZERO_ADDRESS,
          weth,
          usdc,
          earliestRepayTenor: 1
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
        // borrower obtains proof for invalid quote tuple (tuple idx 2 has upfrontfee = 100% but tenor != 0 and earliestRepayTenor != 0)
        let quoteTupleIdx = 2
        let selectedQuoteTuple = quoteTuples[quoteTupleIdx]
        let proof = quoteTuplesTree.getProof(quoteTupleIdx)
        // should revert with invalid quote
        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidSwap')

        // borrower obtains proof for another invalid quote tuple (tuple idx 3 has upfrontfee < 100% but tenor = 0 and earliestRepayTenor != 0)
        quoteTupleIdx = 3
        selectedQuoteTuple = quoteTuples[quoteTupleIdx]
        proof = quoteTuplesTree.getProof(quoteTupleIdx)
        // should revert with invalid quote
        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidEarliestRepay')
      })
    })

    it('It should handle potential compartment callback reentrancy on withdraw correctly', async function () {
      const { quoteHandler, addressRegistry, borrowerGateway, lender, borrower, team, usdc, weth, lenderVault } =
        await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // step 1: lender owner gives regular quote
      const loanPerCollUnit = ONE_USDC.mul(1000)
      let quoteTuples1 = [
        {
          loanPerCollUnitOrLtv: loanPerCollUnit,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(30)
        }
      ]
      let onChainQuote1 = {
        generalQuoteInfo: {
          collToken: weth.address,
          loanToken: usdc.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: 0,
          maxLoan: MAX_UINT256,
          validUntil: MAX_UINT256,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: ZERO_ADDRESS,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples1,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote1)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // step 2: borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const collSendAmount1 = ONE_WETH
      const quoteTupleIdx1 = 0
      const borrowInstructions1 = {
        collSendAmount: collSendAmount1,
        expectedTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32
      }
      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions1, onChainQuote1, quoteTupleIdx1)

      // step 3: deploy malicious owner callback contract
      const MaliciousOwnerContract = await ethers.getContractFactory('MaliciousOwnerContract')
      MaliciousOwnerContract.connect(lender)
      const maliciousOwnerContract = await MaliciousOwnerContract.deploy()
      await maliciousOwnerContract.deployed()
      await weth.connect(lender).mint(lenderVault.address, ONE_WETH) // mint some coll token to vault to process quote

      // step 4: malicious compartment is added to the system
      const MaliciousCompartment = await ethers.getContractFactory('MaliciousCompartment')
      MaliciousCompartment.connect(lender)
      const maliciousCompartment = await MaliciousCompartment.deploy(weth.address, maliciousOwnerContract.address)
      await maliciousCompartment.deployed()
      await addressRegistry.connect(team).setWhitelistState([maliciousCompartment.address], 3)
      await addressRegistry.connect(team).setAllowedTokensForCompartment(maliciousCompartment.address, [usdc.address], true)

      // step 4: lender quotes with malicious compartment
      const loanPerCollUnit2 = ONE_WETH
      let quoteTuples2 = [
        {
          loanPerCollUnitOrLtv: loanPerCollUnit2,
          interestRatePctInBase: 0,
          upfrontFeePctInBase: 0,
          tenor: ONE_DAY.mul(30)
        }
      ]
      let onChainQuote2 = {
        generalQuoteInfo: {
          collToken: usdc.address,
          loanToken: weth.address,
          oracleAddr: ZERO_ADDRESS,
          minLoan: 0,
          maxLoan: MAX_UINT256,
          validUntil: MAX_UINT256,
          earliestRepayTenor: 0,
          borrowerCompartmentImplementation: maliciousCompartment.address,
          isSingleUse: false,
          whitelistAddr: ZERO_ADDRESS,
          isWhitelistAddrSingleBorrower: false
        },
        quoteTuples: quoteTuples2,
        salt: ZERO_BYTES32
      }

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote2)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // step 5: lender transfers vault ownership to malicious callback contract that gets called on
      // compartment initialize
      await lenderVault.connect(lender).proposeNewOwner(maliciousOwnerContract.address)
      await maliciousOwnerContract.connect(lender).claimVaultOwnership(lenderVault.address)
      expect(await lenderVault.owner()).to.be.equal(maliciousOwnerContract.address)

      // step 6: lender consumes own quote with malicious compartment
      await usdc.connect(lender).mint(lender.address, ONE_USDC)
      await usdc.connect(lender).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount2 = ONE_USDC
      const quoteTupleIdx2 = 0
      const borrowInstructions2 = {
        collSendAmount: collSendAmount2,
        expectedTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32
      }
      await expect(
        borrowerGateway
          .connect(lender)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions2, onChainQuote2, quoteTupleIdx2)
      ).to.be.revertedWithCustomError(lenderVault, 'InsufficientVaultFunds')

      // check locked amounts and balances
      const vaultLockedWeth = await lenderVault.lockedAmounts(weth.address)
      const vaultBalWeth = await weth.balanceOf(lenderVault.address)
      expect(vaultLockedWeth).to.be.lte(vaultBalWeth)
    })
  })
})
