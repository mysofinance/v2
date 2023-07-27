import { expect } from 'chai'
import { ethers } from 'hardhat'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { LenderVaultImpl, MyERC20 } from '../../typechain-types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { payloadScheme } from './helpers/abi'
import { setupBorrowerWhitelist, getSlot, findBalanceSlot } from './helpers/misc'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG } from '../../hardhat.config'
import { erc20 } from '../../typechain-types/@openzeppelin/contracts/token'

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
const SINGLE_WRAPPER_MIN_MINT = ethers.BigNumber.from(1000)

async function generateOffChainQuote({
  lenderVault,
  lender,
  signer,
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
  signer: SignerWithAddress
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
  const signature = await signer.signMessage(ethers.utils.arrayify(payloadHash))
  const sig = ethers.utils.splitSignature(signature)
  const compactSig = sig.compact

  const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
  expect(recoveredAddr).to.equal(signer.address)

  // add signer
  const preNumSigners = await lenderVault.totalNumSigners()
  await lenderVault.connect(lender).addSigners([signer.address])
  const postNumSigners = await lenderVault.totalNumSigners()
  expect(postNumSigners.sub(preNumSigners)).to.be.equal(1)

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
    const [lender, signer, borrower, team, circuitBreaker, delegateOnChainQuoting, whitelistAuthority, addr1, addr2, addr3] =
      await ethers.getSigners()
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
    const WrappedERC721Impl = await ethers.getContractFactory('WrappedERC721Impl')
    const wrappedERC721Impl = await WrappedERC721Impl.connect(team).deploy()
    await wrappedERC721Impl.deployed()
    await expect(
      wrappedERC721Impl.initialize(team.address, [{ tokenAddr: ZERO_ADDRESS, tokenIds: [0] }], '', '')
    ).to.be.revertedWith('Initializable: contract is already initialized')

    // deploy ERC721 wrapper
    const ERC721Wrapper = await ethers.getContractFactory('ERC721Wrapper')
    // should revert if registry is address 0
    await expect(ERC721Wrapper.connect(team).deploy(ZERO_ADDRESS, wrappedERC721Impl.address)).to.be.revertedWithCustomError(
      ERC721Wrapper,
      'InvalidAddress'
    )
    await expect(ERC721Wrapper.connect(team).deploy(addressRegistry.address, ZERO_ADDRESS)).to.be.revertedWithCustomError(
      ERC721Wrapper,
      'InvalidAddress'
    )
    // deploy with valid constructor args
    const erc721Wrapper = await ERC721Wrapper.connect(team).deploy(addressRegistry.address, wrappedERC721Impl.address)
    await erc721Wrapper.deployed()

    // deploy token basket wrapper implementation
    const WrappedERC20Impl = await ethers.getContractFactory('WrappedERC20Impl')
    const wrappedERC20Impl = await WrappedERC20Impl.connect(team).deploy()
    await wrappedERC20Impl.deployed()

    // deploy token basket wrapper
    const ERC20Wrapper = await ethers.getContractFactory('ERC20Wrapper')
    // should revert if registry is address 0
    await expect(ERC20Wrapper.connect(team).deploy(ZERO_ADDRESS, wrappedERC20Impl.address)).to.be.revertedWithCustomError(
      ERC20Wrapper,
      'InvalidAddress'
    )
    await expect(ERC20Wrapper.connect(team).deploy(addressRegistry.address, ZERO_ADDRESS)).to.be.revertedWithCustomError(
      ERC20Wrapper,
      'InvalidAddress'
    )
    // deploy with valid constructor args
    const erc20Wrapper = await ERC20Wrapper.connect(team).deploy(addressRegistry.address, wrappedERC20Impl.address)
    await erc20Wrapper.deployed()

    // reverts if user tries to create vault before address registry has been initialized (otherwise couldn't keep track of registered vaults)
    await expect(lenderVaultFactory.connect(lender).createVault(ZERO_BYTES32)).to.be.revertedWithCustomError(
      addressRegistry,
      'Uninitialized'
    )

    // check reverts on invalid initialization
    await expect(
      addressRegistry.connect(lender).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)
    ).to.be.revertedWith('Ownable: caller is not the owner')
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

    // reverts if trying to set whitelist state to tokens (=1) before address registry is initialized
    await expect(addressRegistry.connect(team).setWhitelistState([team.address], 1)).to.be.revertedWithCustomError(
      addressRegistry,
      'Uninitialized'
    )

    // valid initialization
    await addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)

    // check revert when trying to initialize again
    await expect(
      addressRegistry.connect(team).initialize(team.address, borrower.address, lender.address)
    ).to.be.revertedWith('Initializable: contract is already initialized')
    await expect(
      addressRegistry.connect(lender).initialize(team.address, borrower.address, lender.address)
    ).to.be.revertedWith('Initializable: contract is already initialized')

    // reverts if trying to set whitelist state while uninitialized
    await expect(addressRegistry.connect(team).setWhitelistState([], 1)).to.be.revertedWithCustomError(
      addressRegistry,
      'InvalidArrayLength'
    )

    // check revert when trying to set singleton address (wrappers and myso token manager) with array length > 1
    await expect(
      addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address, team.address], 7)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidArrayLength')
    await expect(
      addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address, team.address], 8)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidArrayLength')
    await expect(
      addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address, team.address], 9)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidArrayLength')

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
      addressRegistry
        .connect(team)
        .createWrappedTokenForERC721s([{ tokenAddr: ZERO_ADDRESS, tokenIds: [1] }], '', '', ZERO_BYTES32)
    ).to.be.revertedWithCustomError(addressRegistry, 'InvalidAddress')

    // reverts if token basket wrapper contract address is zero
    await expect(
      addressRegistry
        .connect(team)
        .createWrappedTokenForERC20s([{ tokenAddr: ZERO_ADDRESS, tokenAmount: 1000 }], '', '', ZERO_BYTES32)
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
    const numVaultsPre = await addressRegistry.numRegisteredVaults()
    expect(numVaultsPre).to.be.equal(0)
    await lenderVaultFactory.connect(lender).createVault(ZERO_BYTES32)
    const numVaultsPost = await addressRegistry.numRegisteredVaults()
    expect(numVaultsPost).to.be.equal(1)
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
    await expect(addressRegistry.connect(lender).setWhitelistState([weth.address], 1)).to.be.revertedWith(
      'Ownable: caller is not the owner'
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
      signer,
      borrower,
      team,
      whitelistAuthority,
      signer1: sortedAddrs[0],
      signer2: sortedAddrs[1],
      signer3: sortedAddrs[2],
      circuitBreaker,
      delegateOnChainQuoting,
      usdc,
      weth,
      lenderVault,
      wrappedERC721Impl,
      erc721Wrapper,
      wrappedERC20Impl,
      erc20Wrapper,
      myFirstNFT,
      mySecondNFT,
      testnetTokenManager,
      addr1,
      addr2,
      addr3,
      lenderVaultFactory
    }
  }

  describe('Lender Vault Factory', function () {
    it('Should handle vault creation correctly', async function () {
      const { addressRegistry, lenderVaultFactory, team, addr1, addr2, addr3 } = await setupTest()

      // initially one vault in existence from setupTests
      let numVaultsPre = await addressRegistry.numRegisteredVaults()
      expect(numVaultsPre).to.be.equal(1)

      // check user can create vault
      await lenderVaultFactory.connect(team).createVault(ZERO_BYTES32)
      numVaultsPre = await addressRegistry.numRegisteredVaults()
      expect(numVaultsPre).to.be.equal(2)

      // reverts if same user tries to create new vault with same salt
      await expect(lenderVaultFactory.connect(team).createVault(ZERO_BYTES32)).to.be.revertedWith('ERC1167: create2 failed')

      // check user can create vaults with different salts
      await lenderVaultFactory.connect(team).createVault(ethers.utils.formatBytes32String('1'))
      numVaultsPre = await addressRegistry.numRegisteredVaults()
      expect(numVaultsPre).to.be.equal(3)

      // check different users can create multiple vaults
      await lenderVaultFactory.connect(addr1).createVault(ZERO_BYTES32)
      await expect(lenderVaultFactory.connect(addr1).createVault(ZERO_BYTES32)).to.be.revertedWith('ERC1167: create2 failed')
      await lenderVaultFactory.connect(addr1).createVault(ethers.utils.formatBytes32String('1'))
      await lenderVaultFactory.connect(addr1).createVault(ethers.utils.formatBytes32String('2'))
      numVaultsPre = await addressRegistry.numRegisteredVaults()
      expect(numVaultsPre).to.be.equal(6)

      await lenderVaultFactory.connect(addr2).createVault(ZERO_BYTES32)
      await expect(lenderVaultFactory.connect(addr2).createVault(ZERO_BYTES32)).to.be.revertedWith('ERC1167: create2 failed')
      await lenderVaultFactory.connect(addr1).createVault(ethers.utils.formatBytes32String('3'))
      numVaultsPre = await addressRegistry.numRegisteredVaults()
      expect(numVaultsPre).to.be.equal(8)

      await lenderVaultFactory.connect(addr3).createVault(ZERO_BYTES32)
      await expect(lenderVaultFactory.connect(addr3).createVault(ZERO_BYTES32)).to.be.revertedWith('ERC1167: create2 failed')
      await lenderVaultFactory.connect(addr1).createVault(ethers.utils.formatBytes32String('4'))
      numVaultsPre = await addressRegistry.numRegisteredVaults()
      expect(numVaultsPre).to.be.equal(10)
    })
  })

  describe('Address Registry', function () {
    it('Should handle singleton state updates correctly', async function () {
      const { addressRegistry, team, testnetTokenManager, addr1, addr2, addr3 } = await setupTest()
      // reset testnet token manager
      await addressRegistry.connect(team).setWhitelistState([testnetTokenManager.address], 0)

      // check that initially all singleton states are zero/not set
      expect(await addressRegistry.erc721Wrapper()).to.be.equal(ZERO_ADDRESS)
      expect(await addressRegistry.erc20Wrapper()).to.be.equal(ZERO_ADDRESS)
      expect(await addressRegistry.mysoTokenManager()).to.be.equal(ZERO_ADDRESS)

      // 1) add ERC721 wrapper (state=7)
      await addressRegistry.connect(team).setWhitelistState([addr1.address], 7)

      // 2) add ERC20 wrapper (state=8)
      await addressRegistry.connect(team).setWhitelistState([addr2.address], 8)

      // 3) add testnet token manager (state=9)
      await addressRegistry.connect(team).setWhitelistState([addr3.address], 9)

      // check revert when trying to overwrite singleton state with other singleton address
      await expect(addressRegistry.connect(team).setWhitelistState([addr3.address], 7)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )
      await expect(addressRegistry.connect(team).setWhitelistState([addr2.address], 8)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )
      await expect(addressRegistry.connect(team).setWhitelistState([addr1.address], 9)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )

      // check revert when trying to overwrite singleton state with non-singleton address
      await expect(addressRegistry.connect(team).setWhitelistState([team.address], 7)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )
      await expect(addressRegistry.connect(team).setWhitelistState([team.address], 8)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )
      await expect(addressRegistry.connect(team).setWhitelistState([team.address], 9)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )

      // check that singleton states can be reset/deleted
      await addressRegistry.connect(team).setWhitelistState([addr1.address], 0)
      await addressRegistry.connect(team).setWhitelistState([addr2.address], 0)
      await addressRegistry.connect(team).setWhitelistState([addr3.address], 0)

      // check that singleton states can be set again with different values
      await addressRegistry.connect(team).setWhitelistState([addr3.address], 7)
      await addressRegistry.connect(team).setWhitelistState([addr2.address], 8)
      await addressRegistry.connect(team).setWhitelistState([addr1.address], 9)
    })

    it('Should handle borrower whitelist correctly (1/2)', async function () {
      const { addressRegistry, team, borrower, whitelistAuthority } = await setupTest()

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

    it('Should handle borrower whitelist correctly (2/2)', async function () {
      const { addressRegistry, whitelistAuthority, lender } = await setupTest()
      // should revert when trying to update lender whitelist with empty array
      await expect(addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([], 1)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidArrayLength'
      )

      // valid whitelisting
      await addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([lender.address], 1)

      const blocknum = await ethers.provider.getBlockNumber()
      const timestamp = (await ethers.provider.getBlock(blocknum)).timestamp
      const whitelistedUntil = timestamp + 10

      // construct payload and signature
      const payload = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'bytes32'],
        [
          addressRegistry.address,
          lender.address,
          whitelistedUntil,
          HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
          ZERO_BYTES32
        ]
      )
      const payloadHash = ethers.utils.keccak256(payload)
      const signature = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const compactSig = sig.compact
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      expect(recoveredAddr).to.equal(whitelistAuthority.address)

      // claim whitelist status
      await addressRegistry
        .connect(lender)
        .claimBorrowerWhitelistStatus(whitelistAuthority.address, whitelistedUntil, compactSig, ZERO_BYTES32)

      // should revert when trying to update lender whitelist with same value
      await expect(
        addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([lender.address], whitelistedUntil)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidUpdate')

      // should revert when trying to update lender whitelist with zero address
      await expect(
        addressRegistry.connect(whitelistAuthority).updateBorrowerWhitelist([ZERO_ADDRESS], whitelistedUntil)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidUpdate')

      // construct 2nd payload with outdated "whitelisted until" and sign
      const outdatedWhitelistedUntil = whitelistedUntil - 1
      const payload2 = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'bytes32'],
        [
          addressRegistry.address,
          lender.address,
          outdatedWhitelistedUntil,
          HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId,
          ZERO_BYTES32
        ]
      )
      const payloadHash2 = ethers.utils.keccak256(payload2)
      const signature2 = await whitelistAuthority.signMessage(ethers.utils.arrayify(payloadHash2))
      const sig2 = ethers.utils.splitSignature(signature2)
      const compactSig2 = sig2.compact
      const recoveredAddr2 = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash2), sig2)
      expect(recoveredAddr2).to.equal(whitelistAuthority.address)

      // should revert when trying to update lender whitelist with same value
      await expect(
        addressRegistry
          .connect(lender)
          .claimBorrowerWhitelistStatus(whitelistAuthority.address, outdatedWhitelistedUntil, compactSig2, ZERO_BYTES32)
      ).to.be.revertedWithCustomError(addressRegistry, 'CannotClaimOutdatedStatus')
    })

    it('Should handle ownership transfers correctly', async function () {
      const { addressRegistry, team, lender, borrower } = await setupTest()
      const currOwner = await addressRegistry.owner()
      expect(currOwner).to.be.equal(team.address)
      expect(await addressRegistry.pendingOwner()).to.be.equal(ZERO_ADDRESS)

      // revert if unauthorized party tries to claim ownership
      await expect(addressRegistry.connect(borrower).transferOwnership(borrower.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(addressRegistry.connect(lender).transferOwnership(borrower.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // check revert on invalid new owner proposals
      await expect(addressRegistry.connect(team).transferOwnership(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )
      await expect(addressRegistry.connect(team).transferOwnership(addressRegistry.address)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )
      await expect(addressRegistry.connect(team).transferOwnership(team.address)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )

      // propose valid new owner
      await addressRegistry.connect(team).transferOwnership(lender.address)
      const newOwnerProposal = await addressRegistry.pendingOwner()
      expect(newOwnerProposal).to.be.equal(lender.address)

      // check revert when trying to propose already currently pending new owner
      await expect(addressRegistry.connect(team).transferOwnership(lender.address)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )

      // revert if unauthorized party tries to claim ownership
      await expect(addressRegistry.connect(borrower).acceptOwnership()).to.be.revertedWith(
        'Ownable2Step: caller is not the new owner'
      )

      // claim ownership
      await addressRegistry.connect(lender).acceptOwnership()
      const newOwner = await addressRegistry.owner()
      expect(newOwner).to.be.equal(lender.address)

      // check renouncing ownership is disabled
      await expect(addressRegistry.connect(newOwner).renounceOwnership()).to.be.revertedWithCustomError(
        addressRegistry,
        'Disabled'
      )
    })
  })

  describe('Lender Vault', function () {
    it('Should handle ownership transfers correctly', async function () {
      const { lender, team, lenderVault, signer } = await setupTest()

      const currOwner = await lenderVault.owner()
      expect(currOwner).to.be.equal(lender.address)
      expect(await lenderVault.pendingOwner()).to.be.equal(ZERO_ADDRESS)

      // check that only owner can propose new owner
      await expect(lenderVault.connect(team).transferOwnership(team.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // check that new owner can't be zero address
      await expect(lenderVault.connect(lender).transferOwnership(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // check that new owner can't be lender vault address itself
      await expect(lenderVault.connect(lender).transferOwnership(lenderVault.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // check that new owner can't be current owner
      await expect(lenderVault.connect(lender).transferOwnership(currOwner)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // add signer
      await lenderVault.connect(lender).addSigners([signer.address])

      // check that new owner can't be a signer
      await expect(lenderVault.connect(lender).transferOwnership(signer.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // make valid owner proposal
      await expect(lenderVault.connect(lender).transferOwnership(team.address)).to.emit(
        lenderVault,
        'OwnershipTransferStarted'
      )

      // check that you can't re-submit same new owner proposal
      await expect(lenderVault.connect(lender).transferOwnership(team.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidNewOwnerProposal'
      )

      // claim ownership
      await expect(lenderVault.connect(team).acceptOwnership()).to.emit(lenderVault, 'OwnershipTransferred')
      const newOwner = await lenderVault.owner()
      expect(newOwner).to.be.equal(team.address)

      // check that old owner can't propose new owner anymore
      await expect(lenderVault.connect(lender).transferOwnership(lender.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // check renouncing ownership is disabled
      await expect(lenderVault.connect(lender).renounceOwnership()).to.be.revertedWithCustomError(lenderVault, 'Disabled')
    })

    it('Should handle address registry ownership transferrals correctly', async function () {
      const { addressRegistry, team, lender, borrower } = await setupTest()
      const currOwner = await addressRegistry.owner()
      expect(currOwner).to.be.equal(team.address)
      expect(await addressRegistry.pendingOwner()).to.be.equal(ZERO_ADDRESS)

      // revert if unauthorized party tries to claim ownership
      await expect(addressRegistry.connect(borrower).transferOwnership(borrower.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(addressRegistry.connect(lender).transferOwnership(borrower.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // check revert on invalid new owner proposals
      await expect(addressRegistry.connect(team).transferOwnership(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )
      await expect(addressRegistry.connect(team).transferOwnership(addressRegistry.address)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )
      await expect(addressRegistry.connect(team).transferOwnership(team.address)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )

      // propose valid new owner
      await addressRegistry.connect(team).transferOwnership(lender.address)
      const newOwnerProposal = await addressRegistry.pendingOwner()
      expect(newOwnerProposal).to.be.equal(lender.address)

      // check revert when trying to propose already currently pending new owner
      await expect(addressRegistry.connect(team).transferOwnership(lender.address)).to.be.revertedWithCustomError(
        addressRegistry,
        'InvalidNewOwnerProposal'
      )

      // revert if unauthorized party tries to claim ownership
      await expect(addressRegistry.connect(borrower).acceptOwnership()).to.be.revertedWith(
        'Ownable2Step: caller is not the new owner'
      )

      // claim ownership
      await addressRegistry.connect(lender).acceptOwnership()
      const newOwner = await addressRegistry.owner()
      expect(newOwner).to.be.equal(lender.address)

      // check renouncing ownership is disabled
      await expect(addressRegistry.connect(newOwner).renounceOwnership()).to.be.revertedWithCustomError(
        addressRegistry,
        'Disabled'
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
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // reverts if non-owner tries to withdraw invalid amount
      withdrawAmount = 0
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      withdrawAmount = depositAmount.add(1)
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
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
      await lenderVault.connect(lender).transferOwnership(team.address)
      await lenderVault.connect(team).acceptOwnership()

      // reverts if old owner tries to withdraw
      await expect(lenderVault.connect(lender).withdraw(usdc.address, withdrawAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
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
        circuitBreaker,
        delegateOnChainQuoting,
        usdc,
        weth,
        lenderVault,
        signer
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
      await expect(lenderVault.connect(borrower).withdraw(usdc.address, withdrawAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      withdrawAmount = weth.balanceOf(lenderVault.address)
      await expect(lenderVault.connect(borrower).withdraw(weth.address, withdrawAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }
      const expectedLoanAmount = quoteTuples[0].loanPerCollUnitOrLtv.mul(collSendAmount).div(ONE_WETH)
      const expectedReclaimableAmount = collSendAmount.sub(collSendAmount.mul(quoteTuples[0].upfrontFeePctInBase).div(BASE))

      // reverts when trying to borrow with out-of-bounds quote tuple idx
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx + 1)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidArrayIndex')

      // check pre/post amounts on borrow
      let preLockedWethAmounts = await lenderVault.lockedAmounts(weth.address)
      let preLockedUsdcAmounts = await lenderVault.lockedAmounts(usdc.address)
      let preVaultWethBal = await weth.balanceOf(lenderVault.address)
      let preBorrowerWethBal = await weth.balanceOf(borrower.address)
      let preVaultUsdcBal = await usdc.balanceOf(lenderVault.address)
      let preBorrowerUsdcBal = await usdc.balanceOf(borrower.address)

      // if no compartment, then a compartment transfer fee should revert
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(
            lenderVault.address,
            { ...borrowInstructions, collSendAmount: ONE_WETH.add(1), expectedCompartmentTransferFee: 1 },
            onChainQuote,
            quoteTupleIdx
          )
      ).to.be.revertedWithCustomError(lenderVault, 'InconsistentExpTransferFee')

      // should revert when trying to set invalid circuit breaker address
      await expect(lenderVault.connect(lender).setCircuitBreaker(lender.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      // should revert when trying to set invalid reverse circuit breaker address
      await expect(lenderVault.connect(lender).setReverseCircuitBreaker(lender.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      // should revert when trying to set invalid reverse circuit breaker address
      await lenderVault.addSigners([signer.address])
      await expect(lenderVault.connect(lender).setReverseCircuitBreaker(signer.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      // only owner can set approved quote handler
      await expect(lenderVault.connect(borrower).setDelegateOnChainQuoting(lender.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      // should revert when trying to set invalid quote handler address (owner address)
      await expect(lenderVault.connect(lender).setDelegateOnChainQuoting(lender.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      // set valid approved quote handler
      await lenderVault.connect(lender).setDelegateOnChainQuoting(delegateOnChainQuoting.address)

      // should revert if new handler same as old one
      await expect(
        lenderVault.connect(lender).setDelegateOnChainQuoting(delegateOnChainQuoting.address)
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')

      // set valid circuit breaker
      await lenderVault.connect(lender).setCircuitBreaker(circuitBreaker.address)

      // check revert on unauthorized pause calls
      await expect(lenderVault.connect(team).pauseQuotes()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')
      await expect(lenderVault.connect(borrower).pauseQuotes()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')

      // check that circuit breaker can pause
      await lenderVault.connect(circuitBreaker).pauseQuotes()

      // check revert that circuit breaker cannot unpause if not explicitly set as reverse circuit breaker
      await expect(lenderVault.connect(circuitBreaker).unpauseQuotes()).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSender'
      )

      // check that vault owner can unpause
      await lenderVault.connect(lender).unpauseQuotes()

      // check that vault owner can pause
      await lenderVault.connect(lender).pauseQuotes()

      // trying to execute borrow should revert
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWith('Pausable: paused')

      // authorize circuit breaker also for reverse circuit breaker role
      await lenderVault.connect(lender).setReverseCircuitBreaker(circuitBreaker.address)

      // should revert when trying to set same address again
      await expect(
        lenderVault.connect(lender).setReverseCircuitBreaker(circuitBreaker.address)
      ).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')

      // should allow setting circuit breaker to zero address
      await lenderVault.connect(lender).setCircuitBreaker(ZERO_ADDRESS)

      // check revert when circuit breaker or any other unauthorized party tries to unpause
      await expect(lenderVault.connect(borrower).unpauseQuotes()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')

      // circuit breaker can now unpause because it is also authorized as reverse circuit breaker
      await lenderVault.connect(circuitBreaker).unpauseQuotes()

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
      await expect(lenderVault.connect(borrower).transferOwnership(borrower.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.be.revertedWithCustomError(lenderVault, 'InsufficientVaultFunds')

      // allow for transfer of vault ownership
      await lenderVault.connect(lender).transferOwnership(borrower.address)
      // only new proposed owner can claim vault
      await expect(lenderVault.connect(lender).acceptOwnership()).to.be.revertedWith(
        'Ownable2Step: caller is not the new owner'
      )
      await lenderVault.connect(borrower).acceptOwnership()
    })
  })

  describe('Borrow Gateway', function () {
    it('Should not process with bigger fee than max fee', async function () {
      const { borrowerGateway, quoteHandler, lender, borrower, team, usdc, weth, lenderVault } = await setupTest()

      await expect(borrowerGateway.connect(lender).setProtocolFeeParams([0, 0])).to.be.revertedWithCustomError(
        borrowerGateway,
        'InvalidSender'
      )
      await expect(borrowerGateway.connect(team).setProtocolFeeParams([0, BASE])).to.be.revertedWithCustomError(
        borrowerGateway,
        'InvalidFee'
      )
      await expect(borrowerGateway.connect(team).setProtocolFeeParams([BASE, 0])).to.be.revertedWithCustomError(
        borrowerGateway,
        'InvalidFee'
      )

      // set max protocol fee p.a.
      await borrowerGateway.connect(team).setProtocolFeeParams([0, BASE.mul(5).div(100)])

      await expect(
        borrowerGateway.connect(team).setProtocolFeeParams([BASE, BASE.mul(5).div(100)])
      ).to.be.revertedWithCustomError(borrowerGateway, 'InvalidFee')

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
      // check on-chain quote with non-whitelisted oracle cannot be added
      onChainQuote.generalQuoteInfo.oracleAddr = lenderVault.address
      await expect(
        quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
      ).to.be.revertedWithCustomError(quoteHandler, 'NonWhitelistedOracle')
      onChainQuote.generalQuoteInfo.oracleAddr = ZERO_ADDRESS

      // check valid add
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const collSendAmount = ONE_WETH.mul(2)
      const expectedProtocolAndVaultTransferFee = ONE_WETH.mul(2).mul(5).div(100)
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // should process even for very long tenors now that protocolFee max time is capped at 180 days
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
      ).to.emit(borrowerGateway, 'Borrowed')
    })

    it('Should not process off-chain quote with invalid min/max loan amount (1/2)', async function () {
      const { borrowerGateway, quoteHandler, lender, signer, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lender produces invalid quote off-chain
      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      const { borrowerGateway, quoteHandler, lender, signer, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lender produces invalid quote off-chain
      const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
        lenderVault,
        lender,
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      const { borrowerGateway, quoteHandler, lender, signer, borrower, usdc, weth, lenderVault } = await setupTest()

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
          minLoan: 1,
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
        signer,
        weth,
        usdc,
        minLoan: 0
      })

      // borrower obtains proof for chosen quote tuple
      const quoteTupleIdx = 6
      const selectedQuoteTuple = quoteTuples[quoteTupleIdx]
      const proof = quoteTuplesTree.getProof(quoteTupleIdx)
      const collSendAmount = ONE_WETH
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // reverts if trying to borrow with quote that would result in zero loan amount
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
    })
  })

  describe('Off-Chain Quote Testing', function () {
    it('Should process off-chain quote correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        signer,
        signer1,
        signer2,
        signer3,
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
      await expect(lenderVault.addSigners([lender.address])).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')
      await expect(lenderVault.addSigners([ZERO_ADDRESS])).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')
      await expect(lenderVault.addSigners([])).to.be.revertedWithCustomError(lenderVault, 'InvalidArrayLength')
      await expect(lenderVault.setMinNumOfSigners(0)).to.be.revertedWithCustomError(lenderVault, 'InvalidNewMinNumOfSigners')
      await lenderVault.connect(lender).setMinNumOfSigners(4)
      await expect(lenderVault.setMinNumOfSigners(4)).to.be.revertedWithCustomError(lenderVault, 'InvalidNewMinNumOfSigners')
      const minNumSigners = await lenderVault.minNumOfSigners()
      expect(minNumSigners).to.be.equal(4)
      await lenderVault.connect(lender).setMinNumOfSigners(1)
      await expect(lenderVault.addSigners([lender.address])).to.be.revertedWithCustomError(lenderVault, 'InvalidAddress')
      await lenderVault
        .connect(lender)
        .addSigners([signer.address, signer1.address, signer2.address, signer3.address, team.address, borrower.address])
      // errors in handling signers
      await expect(lenderVault.connect(lender).addSigners([borrower.address])).to.be.revertedWithCustomError(
        lenderVault,
        'AlreadySigner'
      )

      // reverts when trying to remove with signer idx that is out-of-bounds
      let numSigners = Number((await lenderVault.numSigners()).toString())
      await expect(lenderVault.connect(lender).removeSigner(borrower.address, numSigners)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidArrayIndex'
      )

      // reverts when trying to remove unknown signer address
      await expect(lenderVault.connect(lender).removeSigner(weth.address, 0)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSignerRemoveInfo'
      )

      // reverts when trying to remove signer but with non-matching idx
      const signerAddr = await lenderVault.signers(0)
      await expect(lenderVault.connect(lender).removeSigner(signerAddr, 1)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidSignerRemoveInfo'
      )

      // valid remove
      await lenderVault.connect(lender).removeSigner(signerAddr, 0)

      // remove all signers (always remove last one to test edge case handling)
      numSigners = Number((await lenderVault.numSigners()).toString())
      for (let i = 0; i < numSigners; i++) {
        const lastSignerAddr = await lenderVault.signers(numSigners - i - 1)
        await lenderVault.connect(lender).removeSigner(lastSignerAddr, numSigners - i - 1)
      }

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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
        signer,
        borrower,
        team,
        whitelistAuthority,
        circuitBreaker,
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
      }

      // should revert when trying to set invalid circuit breaker address
      await expect(lenderVault.connect(lender).setCircuitBreaker(lender.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      // should revert when trying to set invalid reverse circuit breaker address
      await expect(lenderVault.connect(lender).setCircuitBreaker(lender.address)).to.be.revertedWithCustomError(
        lenderVault,
        'InvalidAddress'
      )

      // set valid circuit breaker
      await lenderVault.connect(lender).setCircuitBreaker(circuitBreaker.address)

      // check revert on unauthorized pause calls
      await expect(lenderVault.connect(team).pauseQuotes()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')
      await expect(lenderVault.connect(borrower).pauseQuotes()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')

      // check that circuit breaker can pause
      await lenderVault.connect(circuitBreaker).pauseQuotes()

      // check that vault owner can unpause
      await lenderVault.connect(lender).unpauseQuotes()

      // check that vault owner can pause
      await lenderVault.connect(lender).pauseQuotes()

      // trying to execute borrow should revert
      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOffChainQuote(lenderVault.address, borrowInstructions, offChainQuote, selectedQuoteTuple, proof)
      ).to.be.revertedWith('Pausable: paused')

      // set valid reverse circuit breaker
      await lenderVault.connect(lender).setReverseCircuitBreaker(team.address)

      // check revert when circuit breaker or any other unauthorized party tries to unpause
      await expect(lenderVault.connect(borrower).unpauseQuotes()).to.be.revertedWithCustomError(lenderVault, 'InvalidSender')

      // check that reverse circuit breaker can unpause
      await lenderVault.connect(team).unpauseQuotes()

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
        signer,
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
        signer,
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
        signer,
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      const { addressRegistry, borrowerGateway, lender, signer, borrower, whitelistAuthority, usdc, weth, lenderVault } =
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
        signer,
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
        signer,
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
        signer,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
        signer,
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
        signer,
        whitelistAuthority,
        weth,
        usdc
      })

      // define signer setup without lender
      await lenderVault.connect(lender).removeSigner(signer.address, 0)
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      const {
        addressRegistry,
        borrowerGateway,
        lender,
        signer,
        borrower,
        team,
        whitelistAuthority,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

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
      const signature = await signer.signMessage(ethers.utils.arrayify(payloadHash))
      const sig = ethers.utils.splitSignature(signature)
      const compactSig = sig.compact
      const recoveredAddr = ethers.utils.verifyMessage(ethers.utils.arrayify(payloadHash), sig)
      expect(recoveredAddr).to.equal(signer.address)

      // add signer
      await lenderVault.connect(lender).addSigners([signer.address])

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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      await expect(
        addressRegistry.connect(team).setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [], true)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidArrayLength')

      await addressRegistry
        .connect(team)
        .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [weth.address], true)

      // should revert when trying to set same state again
      await expect(
        addressRegistry
          .connect(team)
          .setAllowedTokensForCompartment(aaveStakingCompartmentImplementation.address, [weth.address], true)
      ).to.be.revertedWithCustomError(addressRegistry, 'InvalidUpdate')

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

      expect(await quoteHandler.getOnChainQuoteHistoryLength(lenderVault.address)).to.equal(0)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      quoteTuples[0].loanPerCollUnitOrLtv = ONE_USDC.mul(900)
      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      const quoteHashAndValidUntilArr = await quoteHandler.getFullOnChainQuoteHistory(lenderVault.address)
      const historyLen = await quoteHandler.getOnChainQuoteHistoryLength(lenderVault.address)

      expect(quoteHashAndValidUntilArr.length).to.equal(2)
      expect(quoteHashAndValidUntilArr.length).to.equal(historyLen)

      await expect(
        quoteHandler.connect(lender).deleteOnChainQuote(lenderVault.address, quoteHashAndValidUntilArr[0].quoteHash)
      ).to.emit(quoteHandler, 'OnChainQuoteDeleted')
    })
  })

  describe('ERC721 Wrapper Testing', function () {
    it('Should handle wrapping and redeeming of nfts correctly', async function () {
      const { addressRegistry, borrower, team, erc721Wrapper, myFirstNFT, mySecondNFT } = await setupTest()

      // should revert if not called through address registry
      await expect(
        erc721Wrapper
          .connect(borrower)
          .createWrappedToken(ZERO_ADDRESS, [{ tokenAddr: mySecondNFT.address, tokenIds: [1, 2] }], '', '')
      ).to.be.revertedWithCustomError(erc721Wrapper, 'InvalidSender')

      // should revert if wrapper not whitelisted
      await expect(
        addressRegistry
          .connect(borrower)
          .createWrappedTokenForERC721s([{ tokenAddr: mySecondNFT.address, tokenIds: [1, 2] }], '', '', ZERO_BYTES32)
      ).to.be.revertedWithCustomError(erc721Wrapper, 'InvalidAddress')

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc721Wrapper.address], 7)

      // should revert when trying to set same state again
      await expect(
        addressRegistry.connect(team).setWhitelistState([erc721Wrapper.address], 7)
      ).to.be.revertedWithCustomError(addressRegistry, 'StateAlreadySet')
      await expect(addressRegistry.connect(team).setWhitelistState([team.address], 7)).to.be.revertedWithCustomError(
        addressRegistry,
        'StateAlreadySet'
      )

      // should revert if token is not whitelisted
      await expect(
        addressRegistry
          .connect(team)
          .createWrappedTokenForERC721s([{ tokenAddr: mySecondNFT.address, tokenIds: [1, 2] }], '', '', ZERO_BYTES32)
      ).to.be.revertedWithCustomError(erc721Wrapper, 'NonWhitelistedToken')

      // should revert if tokenInfo array has length 0
      await expect(
        addressRegistry.connect(team).createWrappedTokenForERC721s([], '', '', ZERO_BYTES32)
      ).to.be.revertedWithCustomError(erc721Wrapper, 'InvalidArrayLength')

      // should revert if tokenIds array has length 0
      await expect(
        addressRegistry
          .connect(team)
          .createWrappedTokenForERC721s([{ tokenAddr: mySecondNFT.address, tokenIds: [] }], '', '', ZERO_BYTES32)
      ).to.be.revertedWithCustomError(erc721Wrapper, 'InvalidArrayLength')

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
        addressRegistry.connect(borrower).createWrappedTokenForERC721s(
          [
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] },
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc721Wrapper, 'NonIncreasingTokenAddrs')

      // should revert with token id array out of order
      await expect(
        addressRegistry.connect(borrower).createWrappedTokenForERC721s(
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [2, 1] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc721Wrapper, 'NonIncreasingNonFungibleTokenIds')

      // create wrapped token
      expect(await erc721Wrapper.numTokensCreated()).to.be.equal(0)
      await addressRegistry.connect(borrower).createWrappedTokenForERC721s(
        [
          { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
          { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
        ],
        'testName',
        'testSymbol',
        ZERO_BYTES32
      )
      expect(await erc721Wrapper.numTokensCreated()).to.be.equal(1)

      const newWrappedTokenAddr1 = await erc721Wrapper.tokensCreated(0)
      const wrappedToken = await ethers.getContractAt('WrappedERC721Impl', newWrappedTokenAddr1)
      const whitelistTokenState = await addressRegistry.whitelistState(newWrappedTokenAddr1)

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

      // should revert if insufficient balance / not owner of wrapped token
      await expect(wrappedToken.connect(team).redeem(team.address, team.address)).to.be.revertedWith(
        'ERC20: burn amount exceeds balance'
      )
      await expect(wrappedToken.connect(team).redeem(borrower.address, team.address)).to.be.revertedWith(
        'ERC20: insufficient allowance'
      )

      // revert when recipient is zero address
      await expect(wrappedToken.connect(borrower).redeem(borrower.address, ZERO_ADDRESS)).to.be.revertedWithCustomError(
        wrappedToken,
        'InvalidAddress'
      )

      await wrappedToken.connect(borrower).redeem(borrower.address, borrower.address)

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

      // create another wrapped token
      await myFirstNFT.connect(team).safeMint(borrower.address, 3)
      await myFirstNFT.connect(team).safeMint(borrower.address, 4)
      await myFirstNFT.connect(team).safeMint(borrower.address, 5)
      await myFirstNFT.connect(team).safeMint(borrower.address, 6)
      expect(await myFirstNFT.ownerOf(3)).to.be.equal(borrower.address)
      expect(await myFirstNFT.ownerOf(4)).to.be.equal(borrower.address)
      expect(await myFirstNFT.ownerOf(5)).to.be.equal(borrower.address)
      expect(await myFirstNFT.ownerOf(6)).to.be.equal(borrower.address)
      await addressRegistry
        .connect(borrower)
        .createWrappedTokenForERC721s(
          [{ tokenAddr: myFirstNFT.address, tokenIds: [3, 4, 5, 6] }],
          'testName',
          'testSymbol',
          ZERO_BYTES32
        )
      expect(await erc721Wrapper.numTokensCreated()).to.be.equal(2)
      const newWrappedTokenAddr2 = await erc721Wrapper.tokensCreated(1)
      const wrappedToken2 = await ethers.getContractAt('WrappedERC721Impl', newWrappedTokenAddr2)

      // approve 3rd party to redeem
      await wrappedToken2.connect(borrower).approve(team.address, 1)
      await wrappedToken2.connect(team).redeem(borrower.address, team.address)
      expect(await myFirstNFT.ownerOf(3)).to.be.equal(team.address)
      expect(await myFirstNFT.ownerOf(4)).to.be.equal(team.address)
      expect(await myFirstNFT.ownerOf(5)).to.be.equal(team.address)
      expect(await myFirstNFT.ownerOf(6)).to.be.equal(team.address)
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
        'testSymbol',
        ZERO_BYTES32
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      ).to.be.revertedWithCustomError(borrowerGateway, 'ReclaimAmountIsZero')

      await usdc.connect(borrower).approve(borrowerGateway.address, ONE_USDC.mul(10000))

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: loanInfo.initRepayAmount,
            expectedTransferFee: 0,
            deadline: 0,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      ).to.be.revertedWithCustomError(borrowerGateway, 'DeadlinePassed')

      await expect(
        borrowerGateway.connect(borrower).repay(
          {
            targetLoanId: loanId,
            targetRepayAmount: loanInfo.initRepayAmount,
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
        )
      ).to.emit(borrowerGateway, 'Repaid')

      await wrappedToken.connect(borrower).redeem(borrower.address, borrower.address)

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

    it('Should handle sweeping and redeeming of blocked nfts correctly', async function () {
      const { addressRegistry, borrower, team, erc721Wrapper, myFirstNFT, mySecondNFT } = await setupTest()

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc721Wrapper.address], 7)

      // whitelist tokens
      await addressRegistry.connect(team).setWhitelistState([myFirstNFT.address, mySecondNFT.address], 6)

      // mint tokens
      await myFirstNFT.connect(team).safeMint(borrower.address, 1)
      await myFirstNFT.connect(team).safeMint(borrower.address, 2)
      await mySecondNFT.connect(team).safeMint(borrower.address, 1)
      await mySecondNFT.connect(team).safeMint(borrower.address, 2)

      // set approval for wrapper contract
      await myFirstNFT.connect(borrower).setApprovalForAll(erc721Wrapper.address, true)
      await mySecondNFT.connect(borrower).setApprovalForAll(erc721Wrapper.address, true)

      // sort ERC721_TOKEN token addresses
      const sortedNFTAddrs = [myFirstNFT.address, mySecondNFT.address].sort((a, b) =>
        ethers.BigNumber.from(a).lte(b) ? -1 : 1
      )

      // create wrapped token
      expect(await erc721Wrapper.numTokensCreated()).to.be.equal(0)
      await addressRegistry.connect(borrower).createWrappedTokenForERC721s(
        [
          { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
          { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
        ],
        'testName',
        'testSymbol',
        ZERO_BYTES32
      )
      expect(await erc721Wrapper.numTokensCreated()).to.be.equal(1)

      const newWrappedTokenAddr1 = await erc721Wrapper.tokensCreated(0)
      const wrappedToken = await ethers.getContractAt('WrappedERC721Impl', newWrappedTokenAddr1)
      const whitelistTokenState = await addressRegistry.whitelistState(newWrappedTokenAddr1)

      // new token should be whitelisted as ERC20_TOKEN
      expect(whitelistTokenState).to.equal(1)

      // check borrower has balance of 1
      const borrowerWrappedTokenBalance = await wrappedToken.balanceOf(borrower.address)

      expect(borrowerWrappedTokenBalance).to.equal(1)

      // check total supply is 1
      const totalSupply = await wrappedToken.totalSupply()

      expect(totalSupply).to.equal(1)

      // check wrapped remint reverts if total supply is non zero
      await expect(
        wrappedToken.connect(borrower).remint(
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          team.address
        )
      ).to.be.revertedWithCustomError(wrappedToken, 'CannotRemintUnlessZeroSupply')

      // check wrapped token name, symbol and decimal overrides
      const wrappedTokenName = await wrappedToken.name()
      const wrappedTokenSymbol = await wrappedToken.symbol()
      const wrappedTokenDecimals = await wrappedToken.decimals()
      expect(wrappedTokenName).to.equal('testName')
      expect(wrappedTokenSymbol).to.equal('testSymbol')
      expect(wrappedTokenDecimals).to.equal(0)

      const wrappedTokensInfo = await wrappedToken.getWrappedTokensInfo()
      expect(wrappedTokensInfo.length).to.equal(2)

      const getTotalAndCurrentNumOfTokensInWrapperPreRedeem = await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()

      expect(getTotalAndCurrentNumOfTokensInWrapperPreRedeem[0]).to.equal(4)
      expect(getTotalAndCurrentNumOfTokensInWrapperPreRedeem[1]).to.equal(4)

      // block all transfers
      await myFirstNFT.connect(team).toggleBlockTransferTokenId(1)
      await myFirstNFT.connect(team).toggleBlockTransferTokenId(2)
      await mySecondNFT.connect(team).toggleBlockTransferTokenId(1)
      await mySecondNFT.connect(team).toggleBlockTransferTokenId(2)

      await expect(wrappedToken.connect(borrower).redeem(borrower.address, borrower.address)).to.be.revertedWithCustomError(
        wrappedToken,
        'NoTokensTransferred'
      )

      // unblock two of the tokens
      await myFirstNFT.connect(team).toggleBlockTransferTokenId(1)
      await mySecondNFT.connect(team).toggleBlockTransferTokenId(2)

      const firstNFTIdx1InWrapper = await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 1)
      const firstNFTIdx2InWrapper = await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 2)
      const secondNFTIdx1InWrapper = await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 1)
      const secondNFTIdx2InWrapper = await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 2)

      expect(firstNFTIdx1InWrapper).to.be.true
      expect(firstNFTIdx2InWrapper).to.be.true
      expect(secondNFTIdx1InWrapper).to.be.true
      expect(secondNFTIdx2InWrapper).to.be.true

      await wrappedToken.connect(borrower).redeem(borrower.address, borrower.address)

      const getTotalAndCurrentNumOfTokensInWrapperPostRedeem = await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()

      expect(getTotalAndCurrentNumOfTokensInWrapperPostRedeem[0]).to.equal(4)
      expect(getTotalAndCurrentNumOfTokensInWrapperPostRedeem[1]).to.equal(2)

      // check ownership of all unlocked NFTs have shifted back to borrower, but locked NFTs
      const currOwnerFirstNFTIdx1PostRedeem = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2PostRedeem = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1PostRedeem = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2PostRedeem = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1PostRedeem).to.equal(borrower.address)
      expect(currOwnerFirstNFTIdx2PostRedeem).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx1PostRedeem).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx2PostRedeem).to.equal(borrower.address)

      // check borrower has balance of 0
      const borrowerWrappedTokenBalancePostRedeem = await wrappedToken.balanceOf(borrower.address)
      expect(borrowerWrappedTokenBalancePostRedeem).to.equal(0)

      // check total supply is 0
      const totalSupplyPostRedeem = await wrappedToken.totalSupply()
      expect(totalSupplyPostRedeem).to.equal(0)

      // check stuckToken status
      const stuckTokenStatusFirstNFTIdx1 = await wrappedToken.stuckTokens(myFirstNFT.address, 1)
      const stuckTokenStatusFirstNFTIdx2PreSweep = await wrappedToken.stuckTokens(myFirstNFT.address, 2)
      const stuckTokenStatusSecondNFTIdx1PreSweep = await wrappedToken.stuckTokens(mySecondNFT.address, 1)
      const stuckTokenStatusSecondNFTIdx2 = await wrappedToken.stuckTokens(mySecondNFT.address, 2)

      expect(stuckTokenStatusFirstNFTIdx1).to.be.false
      expect(stuckTokenStatusFirstNFTIdx2PreSweep).to.be.true
      expect(stuckTokenStatusSecondNFTIdx1PreSweep).to.be.true
      expect(stuckTokenStatusSecondNFTIdx2).to.be.false

      expect(await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 1)).to.be.false
      expect(await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 2)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 1)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 2)).to.be.false

      // expect sweep to revert if not called by last redeemer
      await expect(
        wrappedToken.connect(team).sweepTokensLeftAfterRedeem(myFirstNFT.address, [2])
      ).to.be.revertedWithCustomError(wrappedToken, 'InvalidSender')

      // expect sweep to revert if empty token array
      await expect(
        wrappedToken.connect(borrower).sweepTokensLeftAfterRedeem(myFirstNFT.address, [])
      ).to.be.revertedWithCustomError(wrappedToken, 'InvalidArrayLength')

      // toggle block transfer back for first blocked token
      await myFirstNFT.connect(team).toggleBlockTransferTokenId(2)

      // passing in token Ids that are not stuck should revert
      await expect(
        wrappedToken.connect(borrower).sweepTokensLeftAfterRedeem(myFirstNFT.address, [1, 2])
      ).to.be.revertedWithCustomError(wrappedToken, 'TokenNotStuck')

      // sweep stuck token in first NFT contract
      await wrappedToken.connect(borrower).sweepTokensLeftAfterRedeem(myFirstNFT.address, [2])

      // sweep stuck token should revert since no tokens removed
      await expect(
        wrappedToken.connect(borrower).sweepTokensLeftAfterRedeem(mySecondNFT.address, [1])
      ).to.be.revertedWithCustomError(wrappedToken, 'NoTokensTransferred')

      // toggle block transfer back for second blocked token
      await mySecondNFT.connect(team).toggleBlockTransferTokenId(1)
      // sweep stuck token
      await wrappedToken.connect(borrower).sweepTokensLeftAfterRedeem(mySecondNFT.address, [1])

      // after sweep check that token is not counted in wrapper
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 1)).to.be.false

      const currOwnerFirstNFTIdx2PostSweep = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1PostSweep = await mySecondNFT.ownerOf(1)

      expect(currOwnerFirstNFTIdx2PostSweep).to.equal(borrower.address)
      expect(currOwnerSecondNFTIdx1PostSweep).to.equal(borrower.address)

      // check stuckToken status
      const stuckTokenStatusFirstNFTIdx2PostSweep = await wrappedToken.stuckTokens(myFirstNFT.address, 2)
      const stuckTokenStatusSecondNFTIdx1PostSweep = await wrappedToken.stuckTokens(mySecondNFT.address, 1)

      expect(stuckTokenStatusFirstNFTIdx2PostSweep).to.be.false
      expect(stuckTokenStatusSecondNFTIdx1PostSweep).to.be.false

      const getTotalAndCurrentNumOfTokensInWrapperPostSweep = await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()

      expect(getTotalAndCurrentNumOfTokensInWrapperPostSweep[0]).to.equal(4)
      expect(getTotalAndCurrentNumOfTokensInWrapperPostSweep[1]).to.equal(0)

      const firstRedeemer = await wrappedToken.lastRedeemer()

      expect(firstRedeemer).to.equal(borrower.address)

      // check remint reverts if empty array and tokens are missing from wrapped token
      await expect(wrappedToken.connect(borrower).remint([], team.address)).to.be.revertedWithCustomError(
        wrappedToken,
        'InvalidArrayLength'
      )

      // check remint reverts if recipient is address zero
      await expect(
        wrappedToken.connect(borrower).remint(
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          ZERO_ADDRESS
        )
      ).to.be.revertedWithCustomError(wrappedToken, 'InvalidAddress')

      await expect(
        wrappedToken.connect(borrower).remint(
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          team.address
        )
      ).to.be.revertedWithCustomError(wrappedToken, 'InvalidArrayLength')

      await expect(
        wrappedToken.connect(borrower).remint(
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [3] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          team.address
        )
      )
        .to.be.revertedWithCustomError(wrappedToken, 'TokenDoesNotBelongInWrapper')
        .withArgs(sortedNFTAddrs[0], 3)

      await expect(
        wrappedToken.connect(borrower).remint(
          [
            { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
            { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
          ],
          team.address
        )
      ).to.be.revertedWithCustomError(wrappedToken, 'TransferToWrappedTokenFailed')

      // set approval for wrapped token address
      await myFirstNFT.connect(borrower).setApprovalForAll(wrappedToken.address, true)
      await mySecondNFT.connect(borrower).setApprovalForAll(wrappedToken.address, true)

      await wrappedToken.connect(borrower).remint(
        [
          { tokenAddr: sortedNFTAddrs[0], tokenIds: [1, 2] },
          { tokenAddr: sortedNFTAddrs[1], tokenIds: [1, 2] }
        ],
        team.address
      )

      const currOwnerFirstNFTIdx1PostRemint = await myFirstNFT.ownerOf(1)
      const currOwnerFirstNFTIdx2PostRemint = await myFirstNFT.ownerOf(2)
      const currOwnerSecondNFTIdx1PostRemint = await mySecondNFT.ownerOf(1)
      const currOwnerSecondNFTIdx2PostRemint = await mySecondNFT.ownerOf(2)

      expect(currOwnerFirstNFTIdx1PostRemint).to.equal(wrappedToken.address)
      expect(currOwnerFirstNFTIdx2PostRemint).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx1PostRemint).to.equal(wrappedToken.address)
      expect(currOwnerSecondNFTIdx2PostRemint).to.equal(wrappedToken.address)

      const getTotalAndCurrentNumOfTokensInWrapperPostRemint = await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()

      expect(getTotalAndCurrentNumOfTokensInWrapperPostRemint[0]).to.equal(4)
      expect(getTotalAndCurrentNumOfTokensInWrapperPostRemint[1]).to.equal(4)

      expect(await wrappedToken.balanceOf(team.address)).to.be.equal(1)
      expect(await wrappedToken.totalSupply()).to.be.equal(1)

      await wrappedToken.connect(team).redeem(team.address, borrower.address)

      expect(await wrappedToken.balanceOf(team.address)).to.be.equal(0)
      expect(await wrappedToken.totalSupply()).to.be.equal(0)

      // check ownership of all NFTs has shifted back to borrower
      expect(await myFirstNFT.ownerOf(1)).to.equal(borrower.address)
      expect(await myFirstNFT.ownerOf(2)).to.equal(borrower.address)
      expect(await mySecondNFT.ownerOf(1)).to.equal(borrower.address)
      expect(await mySecondNFT.ownerOf(2)).to.equal(borrower.address)

      expect(await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()).to.eql([
        ethers.BigNumber.from(4),
        ethers.BigNumber.from(0)
      ])

      await myFirstNFT.connect(borrower).transferFrom(borrower.address, wrappedToken.address, 1)
      await myFirstNFT.connect(borrower).transferFrom(borrower.address, wrappedToken.address, 2)
      await mySecondNFT.connect(borrower).transferFrom(borrower.address, wrappedToken.address, 1)
      await mySecondNFT.connect(borrower).transferFrom(borrower.address, wrappedToken.address, 2)

      // check ownership of all NFTs has shifted to wrappedToken address
      expect(await myFirstNFT.ownerOf(1)).to.equal(wrappedToken.address)
      expect(await myFirstNFT.ownerOf(2)).to.equal(wrappedToken.address)
      expect(await mySecondNFT.ownerOf(1)).to.equal(wrappedToken.address)
      expect(await mySecondNFT.ownerOf(2)).to.equal(wrappedToken.address)

      // no change though in total and current number of tokens in wrapper since these were transferred directly
      expect(await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()).to.eql([
        ethers.BigNumber.from(4),
        ethers.BigNumber.from(0)
      ])

      // sync two of the tokens
      await wrappedToken.connect(borrower).sync(myFirstNFT.address, 1)
      await wrappedToken.connect(borrower).sync(mySecondNFT.address, 1)

      // check sync reverts if token is currently counted in wrapper
      await expect(wrappedToken.connect(borrower).sync(myFirstNFT.address, 1)).to.be.revertedWithCustomError(
        wrappedToken,
        'TokenAlreadyCountedInWrapper'
      )

      // check sync reverts if token is not an underlying component
      await expect(wrappedToken.connect(borrower).sync(myFirstNFT.address, 3))
        .to.be.revertedWithCustomError(wrappedToken, 'TokenDoesNotBelongInWrapper')
        .withArgs(myFirstNFT.address, 3)

      expect(await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()).to.eql([
        ethers.BigNumber.from(4),
        ethers.BigNumber.from(2)
      ])

      expect(await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 1)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 1)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 2)).to.be.false
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 2)).to.be.false

      //sync other two tokens
      await wrappedToken.connect(borrower).sync(myFirstNFT.address, 2)
      await wrappedToken.connect(borrower).sync(mySecondNFT.address, 2)

      expect(await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 1)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 1)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(myFirstNFT.address, 2)).to.be.true
      expect(await wrappedToken.isTokenCountedInWrapper(mySecondNFT.address, 2)).to.be.true

      expect(await wrappedToken.getTotalAndCurrentNumOfTokensInWrapper()).to.eql([
        ethers.BigNumber.from(4),
        ethers.BigNumber.from(4)
      ])

      // only last redeemer can call remint when all tokens synced
      await expect(wrappedToken.connect(borrower).remint([], borrower.address)).to.be.revertedWithCustomError(
        wrappedToken,
        'InvalidSender'
      )

      await wrappedToken.connect(team).remint([], borrower.address)

      // check status of redeemer, recipient and supply
      expect(await wrappedToken.lastRedeemer()).to.equal(team.address)
      expect(await wrappedToken.balanceOf(team.address)).to.be.equal(0)
      expect(await wrappedToken.balanceOf(borrower.address)).to.be.equal(1)
      expect(await wrappedToken.totalSupply()).to.be.equal(1)
    })
  })

  describe('ERC20 Wrapper Testing', function () {
    it('Should handle wrapping and redeeming of token basket correctly', async function () {
      const { addressRegistry, borrower, team, usdc, weth, erc20Wrapper } = await setupTest()

      // should revert if not called through address registry
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
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidSender')

      // should revert if wrapper not whitelisted
      await expect(
        addressRegistry.connect(team).createWrappedTokenForERC20s(
          [
            { tokenAddr: weth.address, tokenAmount: ONE_WETH },
            { tokenAddr: usdc.address, tokenAmount: ONE_USDC }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidAddress')

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address], 8)

      // should revert for non-whitelisted tokens
      await expect(
        addressRegistry.connect(team).createWrappedTokenForERC20s(
          [
            { tokenAddr: team.address, tokenAmount: ONE_WETH },
            { tokenAddr: addressRegistry.address, tokenAmount: ONE_USDC }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'NonWhitelistedToken')

      // should revert if insufficient allowance
      await expect(
        addressRegistry
          .connect(team)
          .createWrappedTokenForERC20s([{ tokenAddr: weth.address, tokenAmount: ONE_WETH }], '', '', ZERO_BYTES32)
      ).to.be.revertedWith('ERC20: insufficient allowance')

      // mint and approve test tokens
      const wrappedUsdcAmount = ONE_USDC.mul(876)
      const wrappedEthAmount = ONE_WETH.mul(8)
      await usdc.mint(borrower.address, wrappedUsdcAmount)
      await weth.mint(borrower.address, wrappedEthAmount)
      await usdc.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)
      await weth.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)

      // sort addresses
      const sortedTokenInfo = [
        { tokenAddr: weth.address, tokenAmount: wrappedEthAmount },
        { tokenAddr: usdc.address, tokenAmount: wrappedUsdcAmount }
      ].sort((a, b) => (ethers.BigNumber.from(a.tokenAddr).lte(b.tokenAddr) ? -1 : 1))

      // should revert with token address array out of order
      await expect(
        addressRegistry.connect(borrower).createWrappedTokenForERC20s(
          [
            { tokenAddr: sortedTokenInfo[1].tokenAddr, tokenAmount: 1 },
            { tokenAddr: sortedTokenInfo[0].tokenAddr, tokenAmount: 1 }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'NonIncreasingTokenAddrs')

      // should revert if any token amount is equal to 0
      await expect(
        addressRegistry.connect(borrower).createWrappedTokenForERC20s(
          [
            { tokenAddr: sortedTokenInfo[1].tokenAddr, tokenAmount: 0 },
            { tokenAddr: sortedTokenInfo[0].tokenAddr, tokenAmount: 1 }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidSendAmount')
      await expect(
        addressRegistry.connect(borrower).createWrappedTokenForERC20s(
          [
            { tokenAddr: sortedTokenInfo[0].tokenAddr, tokenAmount: 1 },
            { tokenAddr: sortedTokenInfo[1].tokenAddr, tokenAmount: 0 }
          ],
          '',
          '',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(erc20Wrapper, 'InvalidSendAmount')

      // check that initially no tokens have been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(0)

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
        'testSymbol',
        ZERO_BYTES32
      )

      // check new token has been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(1)

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
      expect(wrappedTokenDecimals).to.equal(18)
      expect(whitelistTokenState).to.equal(1)
      expect(isIOU).to.equal(false)

      // check that tokens were stored in instance storage correctly
      const tokenAddrs = await wrappedToken.getWrappedTokensInfo()

      expect(tokenAddrs[0]).to.equal(sortedTokenInfo[0].tokenAddr)
      expect(tokenAddrs[1]).to.equal(sortedTokenInfo[1].tokenAddr)

      // new token should be whitelisted as ERC20_TOKEN
      expect(whitelistTokenState).to.equal(1)

      // cannot mint from token with multiple addresses
      await expect(wrappedToken.connect(borrower).mint(borrower.address, 1, 0)).to.be.revertedWithCustomError(
        wrappedToken,
        'OnlyMintFromSingleTokenWrapper'
      )

      // check borrower has balance of minimum of two amounts, but no more than 10 ** 18
      const borrowerWrappedTokenBalance = await wrappedToken.balanceOf(borrower.address)
      const wrappedTokenSupplyCap = ethers.BigNumber.from(10).pow(18)
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

      // should revert if redeem more than balance
      await expect(
        wrappedToken.connect(borrower).redeem(borrower.address, borrower.address, borrowerWrappedTokenBalance.add(1))
      ).to.be.revertedWith('ERC20: burn amount exceeds balance')
      await expect(wrappedToken.connect(team).redeem(team.address, team.address, 0)).to.be.revertedWithCustomError(
        wrappedToken,
        'InvalidAmount'
      )
      await expect(
        wrappedToken.connect(team).redeem(borrower.address, team.address, borrowerWrappedTokenBalance)
      ).to.be.revertedWith('ERC20: insufficient allowance')

      // approve 3rd party to redeem
      await wrappedToken.connect(borrower).approve(team.address, totalSupply.div(2))

      // revert when recipient is zero address
      await expect(
        wrappedToken.connect(team).redeem(borrower.address, ZERO_ADDRESS, totalSupply.div(2))
      ).to.be.revertedWithCustomError(wrappedToken, 'InvalidAddress')

      // redeem half the balance
      await wrappedToken.connect(team).redeem(borrower.address, team.address, totalSupply.div(2))

      // check half of supply is burned
      const postPartialRedeemTotalSupply = await wrappedToken.totalSupply()
      expect(postPartialRedeemTotalSupply).to.equal(totalSupply.div(2))

      // check balance of borrower is half of original
      const postPartialRedeemBorrowerBalance = await wrappedToken.balanceOf(borrower.address)
      expect(postPartialRedeemBorrowerBalance).to.equal(borrowerWrappedTokenBalance.div(2))

      const postRedeemUsdcBalance = await usdc.balanceOf(team.address)
      const postRedeemWethBalance = await weth.balanceOf(team.address)

      expect(postRedeemUsdcBalance).to.equal(usdcBalanceOfWrappedToken.div(2))
      expect(postRedeemWethBalance).to.equal(wethBalanceOfWrappedToken.div(2))

      // redeem remaining balance
      await wrappedToken.connect(borrower).redeem(borrower.address, borrower.address, totalSupply.div(2))

      // check total supply is 0
      const postFullRedeemTotalSupply = await wrappedToken.totalSupply()
      expect(postFullRedeemTotalSupply).to.equal(0)

      // check balance of borrower is 0
      const postFullRedeemBorrowerBalance = await wrappedToken.balanceOf(borrower.address)
      expect(postFullRedeemBorrowerBalance).to.equal(0)

      // create wrapped placeholder token basket
      await addressRegistry
        .connect(borrower)
        .createWrappedTokenForERC20s([], 'testPlaceholderName', 'testPlaceholderSymbol', ZERO_BYTES32)

      // check new token has been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(2)
      const newPlaceholderWrappedTokenAddr = await erc20Wrapper.tokensCreated(1)
      const wrappedPlaceholderToken = await ethers.getContractAt('WrappedERC20Impl', newPlaceholderWrappedTokenAddr)
      const whitelistPlaceholderTokenState = await addressRegistry.whitelistState(newPlaceholderWrappedTokenAddr)

      // check name, symbol, and decimal overrides
      const wrappedPlaceholderTokenName = await wrappedPlaceholderToken.name()
      const wrappedPlaceholderTokenSymbol = await wrappedPlaceholderToken.symbol()
      const wrappedPlaceholderTokenDecimals = await wrappedPlaceholderToken.decimals()
      expect(wrappedPlaceholderTokenName).to.equal('testPlaceholderName')
      expect(wrappedPlaceholderTokenSymbol).to.equal('testPlaceholderSymbol')
      expect(wrappedPlaceholderTokenDecimals).to.equal(18)
      expect(whitelistPlaceholderTokenState).to.equal(1)
      expect(await wrappedPlaceholderToken.isIOU()).to.equal(true)

      const totalPlaceHolderSupply = await wrappedPlaceholderToken.totalSupply()
      expect(totalPlaceHolderSupply).to.equal(BASE)

      // cannot mint from placeholder token
      await expect(wrappedPlaceholderToken.connect(borrower).mint(borrower.address, 1, 0)).to.be.revertedWithCustomError(
        wrappedPlaceholderToken,
        'OnlyMintFromSingleTokenWrapper'
      )

      /** single token wrapper test **/

      // create wrapped token basket
      await addressRegistry.connect(borrower).createWrappedTokenForERC20s(
        [
          {
            tokenAddr: weth.address,
            tokenAmount: ONE_WETH
          }
        ],
        'wethWrapper',
        'wWeth',
        ZERO_BYTES32
      )

      // check new token has been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(3)

      const newSingleWrappedTokenAddr = await erc20Wrapper.tokensCreated(2)
      const wrappedSingleToken = await ethers.getContractAt('WrappedERC20Impl', newSingleWrappedTokenAddr)
      const whitelistSingleTokenState = await addressRegistry.whitelistState(newSingleWrappedTokenAddr)
      const isSingleIOU = await wrappedSingleToken.isIOU()

      // check name, symbol, and decimal overrides
      const wrappedSingleTokenName = await wrappedSingleToken.name()
      const wrappedSingleTokenSymbol = await wrappedSingleToken.symbol()
      const wrappedSingleTokenDecimals = await wrappedSingleToken.decimals()
      expect(wrappedSingleTokenName).to.equal('wethWrapper')
      expect(wrappedSingleTokenSymbol).to.equal('wWeth')
      expect(wrappedSingleTokenDecimals).to.equal(18)
      expect(whitelistSingleTokenState).to.equal(1)
      expect(isSingleIOU).to.equal(false)

      // check that tokens were stored in instance storage correctly
      const singleTokenAddrInfo = await wrappedToken.getWrappedTokensInfo()

      expect(singleTokenAddrInfo[0]).to.equal(weth.address)

      const totalSupplyPreMint = await wrappedSingleToken.totalSupply()

      expect(totalSupplyPreMint).to.equal(ONE_WETH)

      await expect(wrappedSingleToken.connect(borrower).mint(borrower.address, 0, 0)).to.be.revertedWithCustomError(
        wrappedSingleToken,
        'InvalidAmount'
      )

      await expect(wrappedSingleToken.connect(borrower).mint(ZERO_ADDRESS, 1, 0)).to.be.revertedWithCustomError(
        wrappedSingleToken,
        'InvalidAddress'
      )

      await weth.connect(borrower).approve(wrappedSingleToken.address, MAX_UINT256)

      await expect(
        wrappedSingleToken.connect(borrower).mint(team.address, ONE_WETH.mul(2), 10)
      ).to.be.revertedWithCustomError(wrappedSingleToken, 'InvalidSendAmount')

      await wrappedSingleToken.connect(borrower).mint(team.address, ONE_WETH.mul(2), 0)

      expect(await wrappedSingleToken.totalSupply()).to.equal(ONE_WETH.mul(3))
      expect(await wrappedSingleToken.balanceOf(team.address)).to.equal(ONE_WETH.mul(2))

      await wrappedSingleToken.connect(team).redeem(team.address, team.address, ONE_WETH.mul(1))

      expect(await wrappedSingleToken.totalSupply()).to.equal(ONE_WETH.mul(2))
      expect(await wrappedSingleToken.balanceOf(team.address)).to.equal(ONE_WETH.mul(1))

      const allTokensCreated = await erc20Wrapper.allTokensCreated()
      expect(allTokensCreated[0]).to.be.equal(await erc20Wrapper.tokensCreated(0))
      expect(allTokensCreated[1]).to.be.equal(await erc20Wrapper.tokensCreated(1))
      expect(allTokensCreated[2]).to.be.equal(await erc20Wrapper.tokensCreated(2))
    })

    it('Should handle single underling with negative rebasing correctly', async function () {
      const { addressRegistry, borrower, team, weth, erc20Wrapper } = await setupTest()

      // mint test tokens
      await weth.mint(borrower.address, ONE_WETH.mul(1000))
      await weth.mint(team.address, ONE_WETH.mul(1000))

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address], 8)

      // approve wrapper for initial mint
      await weth.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)

      // create wrapped token
      const initialMintAmount = ONE_WETH
      await addressRegistry.connect(borrower).createWrappedTokenForERC20s(
        [
          {
            tokenAddr: weth.address,
            tokenAmount: initialMintAmount
          }
        ],
        'wethWrapper',
        'wWeth',
        ZERO_BYTES32
      )

      // check new token has been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(1)

      // get new wrapper token contract
      const newSingleWrappedTokenAddr = await erc20Wrapper.tokensCreated(0)
      const wrappedSingleToken = await ethers.getContractAt('WrappedERC20Impl', newSingleWrappedTokenAddr)

      // check received mint amount
      expect(await wrappedSingleToken.balanceOf(borrower.address)).to.equal(initialMintAmount.sub(SINGLE_WRAPPER_MIN_MINT))

      // approve and mint again
      const secondMintAmount = ONE_WETH.mul(2)
      await weth.connect(borrower).approve(wrappedSingleToken.address, MAX_UINT256)
      await wrappedSingleToken.connect(borrower).mint(borrower.address, secondMintAmount, 0)

      expect(await wrappedSingleToken.totalSupply()).to.equal(initialMintAmount.add(secondMintAmount))
      expect(await wrappedSingleToken.balanceOf(borrower.address)).to.equal(
        initialMintAmount.sub(SINGLE_WRAPPER_MIN_MINT).add(secondMintAmount)
      )

      // automatically find mapping slot
      const mappingSlot = await findBalanceSlot(weth)

      // calculate balanceOf wrappedSingleToken slot
      const signerBalanceSlot = getSlot(wrappedSingleToken.address, mappingSlot)

      // set it to the value to mock negative rebasing token
      const targetBal = ONE_WETH
      await ethers.provider.send('hardhat_setStorageAt', [
        weth.address,
        signerBalanceSlot,
        ethers.utils.hexlify(ethers.utils.zeroPad(targetBal, 32))
      ])

      // check that the user balance is equal to the expected value
      expect(await weth.balanceOf(wrappedSingleToken.address)).to.be.eq(targetBal)

      // check that another mint takes into account downwards rebased wrapper balance
      await weth.connect(team).approve(wrappedSingleToken.address, MAX_UINT256)
      const preMintBal = await wrappedSingleToken.balanceOf(team.address)
      const totalSupply = await wrappedSingleToken.totalSupply()
      const thirdMintAmount = ONE_WETH.mul(2)
      await wrappedSingleToken.connect(team).mint(team.address, thirdMintAmount, 0)
      const postMintBal = await wrappedSingleToken.balanceOf(team.address)
      const expMintAmount = thirdMintAmount.mul(totalSupply).div(targetBal)
      expect(expMintAmount).to.be.eq(postMintBal.sub(preMintBal))

      // check redemption
      const addressRegistryOwner = await addressRegistry.owner()
      const totalBal = await weth.balanceOf(wrappedSingleToken.address)
      const preRedemptionBal = await weth.balanceOf(borrower.address)
      const preRedemptionTotalSupply = await wrappedSingleToken.totalSupply()
      const redemptionAmount = await wrappedSingleToken.balanceOf(borrower.address)
      await wrappedSingleToken.connect(borrower).redeem(borrower.address, borrower.address, redemptionAmount)
      const postRedemptionBal = await weth.balanceOf(borrower.address)
      const postRedemptionTotalSupply = await wrappedSingleToken.totalSupply()
      const expReceivedRedemptionAmount = redemptionAmount.mul(totalBal).div(preRedemptionTotalSupply)
      expect(expReceivedRedemptionAmount).to.be.eq(postRedemptionBal.sub(preRedemptionBal))
      expect(preRedemptionTotalSupply.sub(redemptionAmount)).to.be.equal(postRedemptionTotalSupply)
    })

    it('Should handle single underling with positive rebasing correctly', async function () {
      const { addressRegistry, borrower, team, weth, erc20Wrapper } = await setupTest()

      // mint test tokens
      await weth.mint(borrower.address, ONE_WETH.mul(1000))
      await weth.mint(team.address, ONE_WETH.mul(1000))

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address], 8)

      // approve wrapper for initial mint
      await weth.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)

      // create wrapped token
      const initialMintAmount = ONE_WETH
      await addressRegistry.connect(borrower).createWrappedTokenForERC20s(
        [
          {
            tokenAddr: weth.address,
            tokenAmount: initialMintAmount
          }
        ],
        'wethWrapper',
        'wWeth',
        ZERO_BYTES32
      )

      // check new token has been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(1)

      // get new wrapper token contract
      const newSingleWrappedTokenAddr = await erc20Wrapper.tokensCreated(0)
      const wrappedSingleToken = await ethers.getContractAt('WrappedERC20Impl', newSingleWrappedTokenAddr)

      // check received mint amount
      expect(await wrappedSingleToken.balanceOf(borrower.address)).to.equal(initialMintAmount.sub(SINGLE_WRAPPER_MIN_MINT))

      // approve and mint again
      const secondMintAmount = ONE_WETH.mul(2)
      await weth.connect(borrower).approve(wrappedSingleToken.address, MAX_UINT256)
      await wrappedSingleToken.connect(borrower).mint(borrower.address, secondMintAmount, 0)

      expect(await wrappedSingleToken.totalSupply()).to.equal(initialMintAmount.add(secondMintAmount))
      expect(await wrappedSingleToken.balanceOf(borrower.address)).to.equal(
        initialMintAmount.sub(SINGLE_WRAPPER_MIN_MINT).add(secondMintAmount)
      )

      // automatically find mapping slot
      const mappingSlot = await findBalanceSlot(weth)

      // calculate balanceOf wrappedSingleToken slot
      const signerBalanceSlot = getSlot(wrappedSingleToken.address, mappingSlot)

      // set it to the value to mock negative rebasing token
      const targetBal = ONE_WETH.mul(1000)
      await ethers.provider.send('hardhat_setStorageAt', [
        weth.address,
        signerBalanceSlot,
        ethers.utils.hexlify(ethers.utils.zeroPad(targetBal, 32))
      ])

      // check that the user balance is equal to the expected value
      expect(await weth.balanceOf(wrappedSingleToken.address)).to.be.eq(targetBal)

      // check that another mint takes into account upwards rebased wrapper balance
      await weth.connect(team).approve(wrappedSingleToken.address, MAX_UINT256)
      const preMintWrappedTokenUndBal = await weth.balanceOf(wrappedSingleToken.address)
      const preMintUserBal = await weth.balanceOf(team.address)
      const preMintTotalSupply = await wrappedSingleToken.totalSupply()
      const thirdMintAmount = ONE_WETH.mul(2)
      await wrappedSingleToken.connect(team).mint(team.address, thirdMintAmount, 0)
      const postMintWrappedTokenUndBal = await weth.balanceOf(wrappedSingleToken.address)
      const postMintUserBal = await weth.balanceOf(team.address)
      const postMintTotalSupply = await wrappedSingleToken.totalSupply()
      const expMintAmount = thirdMintAmount.mul(preMintTotalSupply).div(preMintWrappedTokenUndBal)
      expect(thirdMintAmount).to.be.eq(postMintWrappedTokenUndBal.sub(preMintWrappedTokenUndBal))
      expect(thirdMintAmount).to.be.eq(preMintUserBal.sub(postMintUserBal))
      expect(expMintAmount).to.be.eq(postMintTotalSupply.sub(preMintTotalSupply))

      // check redemption
      const totalBal = await weth.balanceOf(wrappedSingleToken.address)
      const preRedemptionBal = await weth.balanceOf(borrower.address)
      const preRedemptionTotalSupply = await wrappedSingleToken.totalSupply()
      const redemptionAmount = await wrappedSingleToken.balanceOf(borrower.address)
      await wrappedSingleToken.connect(borrower).redeem(borrower.address, borrower.address, redemptionAmount)
      const postRedemptionBal = await weth.balanceOf(borrower.address)
      const postRedemptionTotalSupply = await wrappedSingleToken.totalSupply()
      const expReceivedRedemptionAmount = redemptionAmount.mul(totalBal).div(preRedemptionTotalSupply)
      expect(expReceivedRedemptionAmount).to.be.eq(postRedemptionBal.sub(preRedemptionBal))
      expect(preRedemptionTotalSupply.sub(redemptionAmount)).to.be.equal(postRedemptionTotalSupply)

      // reset balance to zero
      await ethers.provider.send('hardhat_setStorageAt', [
        weth.address,
        signerBalanceSlot,
        ethers.utils.hexlify(ethers.utils.zeroPad(0, 32))
      ])

      // check mint reverts
      await expect(wrappedSingleToken.connect(team).mint(team.address, thirdMintAmount, 0)).to.be.revertedWithCustomError(
        wrappedSingleToken,
        'NonMintableTokenState'
      )
    })

    it('Should handle single underlying with donations correctly', async function () {
      const { addressRegistry, wrappedERC20Impl, borrower, team, weth, erc20Wrapper } = await setupTest()

      // mint test tokens
      await weth.mint(borrower.address, ONE_WETH.mul(1000))
      await weth.mint(team.address, ONE_WETH.mul(1000))

      // set token wrapper contract in address registry
      await addressRegistry.connect(team).setWhitelistState([erc20Wrapper.address], 8)

      // approve wrapper for initial mint
      await weth.connect(borrower).approve(erc20Wrapper.address, MAX_UINT256)

      // check revert on too small mint amount
      await expect(
        addressRegistry.connect(borrower).createWrappedTokenForERC20s(
          [
            {
              tokenAddr: weth.address,
              tokenAmount: 1
            }
          ],
          'wethWrapper',
          'wWeth',
          ZERO_BYTES32
        )
      ).to.be.revertedWithCustomError(wrappedERC20Impl, 'InvalidMintAmount')

      // create wrapped token
      const initialMintAmount = SINGLE_WRAPPER_MIN_MINT.add(1)
      await addressRegistry.connect(borrower).createWrappedTokenForERC20s(
        [
          {
            tokenAddr: weth.address,
            tokenAmount: initialMintAmount
          }
        ],
        'wethWrapper',
        'wWeth',
        ZERO_BYTES32
      )

      // check new token has been created
      expect(await erc20Wrapper.numTokensCreated()).to.be.equal(1)

      // get new wrapper token contract
      const newSingleWrappedTokenAddr = await erc20Wrapper.tokensCreated(0)
      const wrappedSingleToken = await ethers.getContractAt('WrappedERC20Impl', newSingleWrappedTokenAddr)

      // check received mint amount
      expect(await wrappedSingleToken.balanceOf(borrower.address)).to.equal(initialMintAmount.sub(SINGLE_WRAPPER_MIN_MINT))

      // check expected balances
      expect(await wrappedSingleToken.totalSupply()).to.equal(initialMintAmount)
      expect(await weth.balanceOf(wrappedSingleToken.address)).to.equal(initialMintAmount)

      // specify some 2nd mint amount
      const secondMint = ONE_WETH

      // front-run mint with donation that causes truncation
      const totalSupply = await wrappedSingleToken.totalSupply()
      const totalBalance = await weth.balanceOf(wrappedSingleToken.address)
      const donationToCauseTruncation = secondMint.mul(totalSupply).sub(totalBalance).add(1)
      await weth.mint(wrappedSingleToken.address, donationToCauseTruncation)

      // check that underlying balance increased by donation amount
      expect(await weth.balanceOf(wrappedSingleToken.address)).to.be.eq(donationToCauseTruncation.add(initialMintAmount))

      // check that mint reverts
      await weth.connect(team).approve(wrappedSingleToken.address, MAX_UINT256)
      await expect(wrappedSingleToken.connect(team).mint(team.address, secondMint, 0)).to.be.revertedWithCustomError(
        wrappedSingleToken,
        'InvalidMintAmount'
      )

      // check redemption
      const preRedemptionUserTokenBal = await wrappedSingleToken.balanceOf(borrower.address)
      const preRedemptionUserUndBal = await weth.balanceOf(borrower.address)
      const preRedemptionWrapperUndBal = await weth.balanceOf(wrappedSingleToken.address)
      const preRedemptionTokenSupply = await wrappedSingleToken.totalSupply()
      await wrappedSingleToken.connect(borrower).redeem(borrower.address, borrower.address, preRedemptionUserTokenBal)
      const postRedemptionUserTokenBal = await wrappedSingleToken.balanceOf(borrower.address)
      const postRedemptionUserUndBal = await weth.balanceOf(borrower.address)
      const postRedemptionWrapperUndBal = await weth.balanceOf(wrappedSingleToken.address)
      const postRedemptionTotalSupply = await wrappedSingleToken.totalSupply()
      const expReceivedRedemptionAmount = preRedemptionUserTokenBal
        .mul(preRedemptionWrapperUndBal)
        .div(preRedemptionTokenSupply)
      expect(postRedemptionUserTokenBal).to.be.equal(0)
      expect(postRedemptionTotalSupply).to.be.equal(SINGLE_WRAPPER_MIN_MINT)
      expect(postRedemptionWrapperUndBal).to.be.equal(preRedemptionWrapperUndBal.sub(expReceivedRedemptionAmount))
      expect(postRedemptionUserUndBal.sub(preRedemptionUserUndBal)).to.be.equal(expReceivedRedemptionAmount)
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
          minLoan: 1,
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
      const expectedProtocolAndVaultTransferFee = 0
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount: collTokenSendAmount,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
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
          expectedTransferFee: 0,
          deadline: MAX_UINT256,
          callbackAddr: callbackAddr,
          callbackData: callbackData
        },
        lenderVault.address
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
          minLoan: 1,
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
        expectedProtocolAndVaultTransferFee: 0,
        expectedCompartmentTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32,
        mysoTokenManagerData: ZERO_BYTES32
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
        const expectedProtocolAndVaultTransferFee = 0
        const expectedCompartmentTransferFee = 0
        const quoteTupleIdx = 0
        const callbackAddr = ZERO_ADDRESS
        const callbackData = ZERO_BYTES32
        const borrowInstructions = {
          collSendAmount: sellAmountOfCollToken,
          expectedProtocolAndVaultTransferFee,
          expectedCompartmentTransferFee,
          deadline: MAX_UINT256,
          minLoanAmount: 0,
          callbackAddr,
          callbackData,
          mysoTokenManagerData: ZERO_BYTES32
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
              expectedTransferFee: 0,
              deadline: MAX_UINT256,
              callbackAddr: callbackAddr,
              callbackData: callbackData
            },
            lenderVault.address
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

        // should revert with on chain quote that has min or max loan limit of zero
        onChainQuote.generalQuoteInfo.minLoan = ethers.BigNumber.from(0)
        onChainQuote.generalQuoteInfo.maxLoan = ethers.BigNumber.from(0)
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
        onChainQuote.generalQuoteInfo.maxLoan = MAX_UINT256
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')
        onChainQuote.generalQuoteInfo.minLoan = ONE_USDC.mul(1000)
        onChainQuote.generalQuoteInfo.maxLoan = ethers.BigNumber.from(0)
        await expect(
          quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        ).to.be.revertedWithCustomError(quoteHandler, 'InvalidQuote')

        // reset to be valid min loan (and max loan)
        onChainQuote.generalQuoteInfo.minLoan = ONE_USDC.mul(1000)
        onChainQuote.generalQuoteInfo.maxLoan = MAX_UINT256

        // add valid on chain quote
        await quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote)
        await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
        const sellAmountOfCollToken = ONE_WETH
        const expectedProtocolAndVaultTransferFee = 0
        const expectedCompartmentTransferFee = 0
        const quoteTupleIdx = 0
        const callbackAddr = ZERO_ADDRESS
        const callbackData = ZERO_BYTES32
        const borrowInstructions = {
          collSendAmount: sellAmountOfCollToken,
          expectedProtocolAndVaultTransferFee,
          expectedCompartmentTransferFee,
          deadline: MAX_UINT256,
          minLoanAmount: 0,
          callbackAddr,
          callbackData,
          mysoTokenManagerData: ZERO_BYTES32
        }

        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOnChainQuote(
              lenderVault.address,
              { ...borrowInstructions, expectedCompartmentTransferFee: 1 },
              onChainQuote,
              quoteTupleIdx
            )
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidSwap')

        await expect(
          borrowerGateway
            .connect(borrower)
            .borrowWithOnChainQuote(lenderVault.address, borrowInstructions, onChainQuote, quoteTupleIdx)
        ).to.emit(lenderVault, 'QuoteProcessed')
      })

      it('Should handle off-chain swap quotes correctly (1/2)', async function () {
        const { borrowerGateway, lender, signer, borrower, usdc, weth, lenderVault, quoteHandler } = await setupTest()

        // lenderVault owner deposits usdc
        await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

        // lender produces template off-chain quote (incl swap quote tuples)
        const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
          lenderVault,
          lender,
          signer,
          whitelistAuthority: ZERO_ADDRESS,
          weth,
          usdc
        })

        // borrower approves gateway and executes quote
        await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
        const collSendAmount = ONE_WETH
        const expectedProtocolAndVaultTransferFee = 0
        const expectedCompartmentTransferFee = 0
        const callbackAddr = ZERO_ADDRESS
        const callbackData = ZERO_BYTES32
        const borrowInstructions = {
          collSendAmount,
          expectedProtocolAndVaultTransferFee,
          expectedCompartmentTransferFee,
          deadline: MAX_UINT256,
          minLoanAmount: 0,
          callbackAddr,
          callbackData,
          mysoTokenManagerData: ZERO_BYTES32
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
        ).to.be.revertedWithCustomError(lenderVault, 'InvalidUpfrontFee')
      })

      it('Should handle off-chain swap quotes correctly (2/2)', async function () {
        const { borrowerGateway, lender, signer, borrower, usdc, weth, lenderVault } = await setupTest()

        // lenderVault owner deposits usdc
        await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

        // lender produces quote with earliest repay != 0
        const { offChainQuote, quoteTuples, quoteTuplesTree } = await generateOffChainQuote({
          lenderVault,
          lender,
          signer,
          whitelistAuthority: ZERO_ADDRESS,
          weth,
          usdc,
          earliestRepayTenor: 1
        })

        // borrower approves gateway and executes quote
        await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)
        const collSendAmount = ONE_WETH
        const expectedProtocolAndVaultTransferFee = 0
        const expectedCompartmentTransferFee = 0
        const callbackAddr = ZERO_ADDRESS
        const callbackData = ZERO_BYTES32
        const borrowInstructions = {
          collSendAmount,
          expectedProtocolAndVaultTransferFee,
          expectedCompartmentTransferFee,
          deadline: MAX_UINT256,
          minLoanAmount: 0,
          callbackAddr,
          callbackData,
          mysoTokenManagerData: ZERO_BYTES32
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

    it('Should handle swap with protocol fee correctly', async function () {
      const { borrowerGateway, quoteHandler, lender, team, borrower, usdc, weth, lenderVault } = await setupTest()

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      await borrowerGateway.connect(team).setProtocolFeeParams([BASE.div(500), BASE.div(100)])

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
      const sellAmountOfCollToken = ONE_WETH.mul(499).div(500)
      const expectedProtocolAndVaultTransferFee = ONE_WETH.div(500)
      const expectedCompartmentTransferFee = 0
      const quoteTupleIdx = 0
      const callbackAddr = ZERO_ADDRESS
      const callbackData = ZERO_BYTES32
      const borrowInstructions = {
        collSendAmount: ONE_WETH,
        expectedProtocolAndVaultTransferFee,
        expectedCompartmentTransferFee,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr,
        callbackData,
        mysoTokenManagerData: ZERO_BYTES32
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
      expect(borrowerWethBalPre.sub(borrowerWethBalPost)).to.equal(
        vaultWethBalPost.sub(vaultWethBalPre).add(ONE_WETH.div(500))
      )
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
            expectedTransferFee: 0,
            deadline: MAX_UINT256,
            callbackAddr: callbackAddr,
            callbackData: callbackData
          },
          lenderVault.address
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
          minLoan: 1,
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
        expectedProtocolAndVaultTransferFee: 0,
        expectedCompartmentTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32,
        mysoTokenManagerData: ZERO_BYTES32
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
          minLoan: 1,
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
      await lenderVault.connect(lender).transferOwnership(maliciousOwnerContract.address)
      await maliciousOwnerContract.connect(lender).claimVaultOwnership(lenderVault.address)
      expect(await lenderVault.owner()).to.be.equal(maliciousOwnerContract.address)

      // step 6: lender consumes own quote with malicious compartment
      await usdc.connect(lender).mint(lender.address, ONE_USDC)
      await usdc.connect(lender).approve(borrowerGateway.address, MAX_UINT256)
      const collSendAmount2 = ONE_USDC
      const quoteTupleIdx2 = 0
      const borrowInstructions2 = {
        collSendAmount: collSendAmount2,
        expectedProtocolAndVaultTransferFee: 0,
        expectedCompartmentTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32,
        mysoTokenManagerData: ZERO_BYTES32
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

  describe('Quote Policy Manager', function () {
    it('Should handle checks on policy updates correctly', async function () {
      const {
        quoteHandler,
        addressRegistry,
        borrowerGateway,
        lender,
        delegateOnChainQuoting,
        borrower,
        team,
        usdc,
        weth,
        lenderVault
      } = await setupTest()

      const TestQuotePolicyManager = await ethers.getContractFactory('TestQuotePolicyManager')
      const testQuotePolicyManager = await TestQuotePolicyManager.connect(team).deploy()
      await testQuotePolicyManager.deployed()

      await addressRegistry.connect(team).setWhitelistState([testQuotePolicyManager.address], 10)

      // should revert if unregistered vault
      await expect(
        quoteHandler.connect(team).updateQuotePolicyManagerForVault(borrower.address, testQuotePolicyManager.address, false)
      ).to.be.revertedWithCustomError(quoteHandler, 'UnregisteredVault')

      // should revert if not vault owner
      await expect(
        quoteHandler
          .connect(team)
          .updateQuotePolicyManagerForVault(lenderVault.address, testQuotePolicyManager.address, false)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')

      await expect(lenderVault.connect(lender).setDelegateOnChainQuoting(delegateOnChainQuoting.address))
        .to.emit(lenderVault, 'DelegateOnChainQuotingUpdated')
        .withArgs(delegateOnChainQuoting.address, ZERO_ADDRESS)

      // should revert even if called by approved quote handler
      await expect(
        quoteHandler
          .connect(delegateOnChainQuoting)
          .updateQuotePolicyManagerForVault(lenderVault.address, testQuotePolicyManager.address, false)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidSender')

      // should revert if not whitelisted quote policy manager
      await expect(
        quoteHandler.connect(lender).updateQuotePolicyManagerForVault(lenderVault.address, quoteHandler.address, false)
      ).to.be.revertedWithCustomError(quoteHandler, 'InvalidAddress')

      // lenderVault owner deposits usdc
      await usdc.connect(lender).transfer(lenderVault.address, ONE_USDC.mul(100000))

      // lender owner gives regular quote
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
          minLoan: 1,
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

      // set policy manager address
      await expect(
        quoteHandler
          .connect(lender)
          .updateQuotePolicyManagerForVault(lenderVault.address, testQuotePolicyManager.address, false)
      )
        .to.emit(quoteHandler, 'QuotePolicyManagerUpdated')
        .withArgs(lenderVault.address, testQuotePolicyManager.address)

      await expect(quoteHandler.connect(lender).addOnChainQuote(lenderVault.address, onChainQuote1)).to.emit(
        quoteHandler,
        'OnChainQuoteAdded'
      )

      // borrower approves gateway and executes quote
      await weth.connect(borrower).approve(borrowerGateway.address, MAX_UINT256)

      const collSendAmount1 = ONE_WETH
      const quoteTupleIdx1 = 0
      const borrowInstructions1 = {
        collSendAmount: collSendAmount1,
        expectedProtocolAndVaultTransferFee: 0,
        expectedCompartmentTransferFee: 0,
        deadline: MAX_UINT256,
        minLoanAmount: 0,
        callbackAddr: ZERO_ADDRESS,
        callbackData: ZERO_BYTES32,
        mysoTokenManagerData: ZERO_BYTES32
      }

      await expect(
        borrowerGateway
          .connect(borrower)
          .borrowWithOnChainQuote(lenderVault.address, borrowInstructions1, onChainQuote1, quoteTupleIdx1)
      ).to.be.revertedWithCustomError(quoteHandler, 'QuoteViolatesPolicy')

      // set policy to allow
      await testQuotePolicyManager.connect(team).updatePolicy(lenderVault.address, true)

      await borrowerGateway
        .connect(borrower)
        .borrowWithOnChainQuote(lenderVault.address, borrowInstructions1, onChainQuote1, quoteTupleIdx1)
    })
  })
})
