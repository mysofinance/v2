import { expect } from 'chai'
import { ethers } from 'hardhat'
import { HARDHAT_CHAIN_ID_AND_FORKING_CONFIG, getMysoOracleMainnetForkingConfig } from '../../hardhat.config'

// test config constants & vars
let snapshotId: String // use snapshot id to reset state before each test

// constants
const hre = require('hardhat')
const BASE = ethers.BigNumber.from(10).pow(18)
const ONE_USDC = ethers.BigNumber.from(10).pow(6)
const ONE_WETH = ethers.BigNumber.from(10).pow(18)
const ONE_MYSO = ethers.BigNumber.from(10).pow(18)
const ONE_WSTETH = ethers.BigNumber.from(10).pow(18)
const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1)
const MAX_UINT256 = ethers.BigNumber.from(2).pow(256).sub(1)
const ONE_HOUR = ethers.BigNumber.from(60 * 60)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_BYTES32 = ethers.utils.formatBytes32String('')

describe('Peer-to-Peer: Myso Recent Forked Mainnet Tests', function () {
  before(async () => {
    console.log('Note: Running mainnet tests with the following forking config:')
    console.log(HARDHAT_CHAIN_ID_AND_FORKING_CONFIG)
    if (HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId !== 1) {
      console.warn('Invalid hardhat forking config! Expected `HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId` to be 1!')

      console.warn('Assuming that current test run is using `npx hardhat coverage`!')

      console.warn('Re-importing mainnet forking config from `hardhat.config.ts`...')
      const mainnetForkingConfig = getMysoOracleMainnetForkingConfig()

      console.warn('Overwriting chainId to hardhat default `31337` to make off-chain signing consistent...')
      HARDHAT_CHAIN_ID_AND_FORKING_CONFIG.chainId = 31337

      console.log('block number: ', mainnetForkingConfig.url)

      console.warn('Trying to manually switch network to forked mainnet for this test file...')
      await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [
          {
            forking: {
              jsonRpcUrl: mainnetForkingConfig.url,
              blockNumber: mainnetForkingConfig.blockNumber
            }
          }
        ]
      })
    }
  })

  beforeEach(async () => {
    snapshotId = await hre.network.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await hre.network.provider.send('evm_revert', [snapshotId])
  })

  async function setupTest() {
    const [lender, signer, borrower, team, whitelistAuthority, someUser] = await ethers.getSigners()
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
    await addressRegistry.connect(team).initialize(lenderVaultFactory.address, borrowerGateway.address, quoteHandler.address)

    /* ********************************** */
    /* DEPLOYMENT OF SYSTEM CONTRACTS END */
    /* ********************************** */

    // create a vault
    await lenderVaultFactory.connect(lender).createVault(ZERO_BYTES32)
    const lenderVaultAddrs = await addressRegistry.registeredVaults()
    const lenderVaultAddr = lenderVaultAddrs[0]
    const lenderVault = await LenderVaultImplementation.attach(lenderVaultAddr)

    // prepare WETH balance
    const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const weth = await ethers.getContractAt('IWETH', WETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [borrower.address, '0x204FCE5E3E25026110000000'])
    await weth.connect(borrower).deposit({ value: ONE_WETH.mul(1) })

    //prepare wstEth balances
    const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
    const WSTETH_HOLDER = '0x5fEC2f34D80ED82370F733043B6A536d7e9D7f8d'
    const wsteth = await ethers.getContractAt('IWETH', WSTETH_ADDRESS)
    await ethers.provider.send('hardhat_setBalance', [WSTETH_HOLDER, '0x56BC75E2D63100000'])
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WSTETH_HOLDER]
    })

    const wstEthHolder = await ethers.getSigner(WSTETH_HOLDER)

    await wsteth.connect(wstEthHolder).transfer(team.address, '10000000000000000000')

    const reth = '0xae78736Cd615f374D3085123A210448E74Fc6393'
    const cbeth = '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704'
    const rethToEthChainlinkAddr = '0x536218f9E9Eb48863970252233c8F271f554C2d0'
    const cbethToEthChainlinkAddr = '0xF017fcB346A1885194689bA23Eff2fE6fA5C483b'

    return {
      addressRegistry,
      borrowerGateway,
      quoteHandler,
      lenderVaultImplementation,
      lender,
      signer,
      borrower,
      team,
      whitelistAuthority,
      weth,
      wsteth,
      reth,
      cbeth,
      rethToEthChainlinkAddr,
      cbethToEthChainlinkAddr,
      lenderVault,
      lenderVaultFactory,
      someUser
    }
  }

  describe('Myso Oracle Testing', function () {
    it('Should set up myso IOO price correctly', async function () {
      const {
        addressRegistry,
        borrowerGateway,
        quoteHandler,
        lender,
        borrower,
        team,
        weth,
        wsteth,
        reth,
        cbeth,
        cbethToEthChainlinkAddr,
        rethToEthChainlinkAddr,
        lenderVault
      } = await setupTest()

      const myso = '0x00000000000000000000000000000000DeaDBeef'

      // deploy myso oracle
      const MysoOracle = await ethers.getContractFactory('MysoOracle')

      const mysoOracle = await MysoOracle.connect(team).deploy(
        [reth, cbeth],
        [rethToEthChainlinkAddr, cbethToEthChainlinkAddr],
        50000000
      )
      await mysoOracle.deployed()

      const mysoPriceData = await mysoOracle.mysoPrice()

      expect(mysoPriceData.prePrice).to.equal(50000000)
      expect(mysoPriceData.postPrice).to.equal(50000000)
      const timestampAtDeployment = mysoPriceData.switchTime

      await expect(mysoOracle.connect(lender).setMysoPrice(80000000)).to.be.revertedWith('Ownable: caller is not the owner')

      await expect(mysoOracle.getPrice(weth.address, cbeth)).to.be.revertedWithCustomError(mysoOracle, 'NoMyso')

      const wethCollMysoLoanPrice = await mysoOracle.getPrice(weth.address, myso)
      const wstEthCollMysoLoanPrice = await mysoOracle.getPrice(wsteth.address, myso)
      const rethCollMysoLoanPrice = await mysoOracle.getPrice(reth, myso)
      const cbethCollMysoLoanPrice = await mysoOracle.getPrice(cbeth, myso)

      //toggle to show logs
      const showLogs = true
      if (showLogs) {
        console.log(
          'wethCollMysoLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(wethCollMysoLoanPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'wstEthCollMysoLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(wstEthCollMysoLoanPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'rethCollMysoLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(rethCollMysoLoanPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'cbEthCollMysoLoanPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(cbethCollMysoLoanPrice, 18).slice(0, 8))) / 1000000
        )
      }

      await mysoOracle.connect(team).setMysoPrice(100000000)
      const newMysoPriceData = await mysoOracle.mysoPrice()
      expect(newMysoPriceData.prePrice).to.equal(50000000)
      expect(newMysoPriceData.postPrice).to.equal(100000000)
      expect(newMysoPriceData.switchTime).to.be.gte(ethers.BigNumber.from(timestampAtDeployment).add(ONE_HOUR))
      const newWethCollMysoLoanPrice = await mysoOracle.getPrice(weth.address, myso)
      expect(newWethCollMysoLoanPrice).to.equal(wethCollMysoLoanPrice)
      await ethers.provider.send('evm_mine', [ethers.BigNumber.from(newMysoPriceData.switchTime).add(10).toNumber()])
      const wethCollMysoLoanPostPrice = await mysoOracle.getPrice(weth.address, myso)
      // difference is very small less than the order of 10^-13
      expect(
        wethCollMysoLoanPostPrice
          .sub(wethCollMysoLoanPrice.div(2))
          .mul(ethers.BigNumber.from(10).pow(13))
          .div(wethCollMysoLoanPostPrice)
      ).to.be.equal(0)

      const wstEthCollMysoLoanPostPrice = await mysoOracle.getPrice(wsteth.address, myso)
      const rethCollMysoLoanPostPrice = await mysoOracle.getPrice(reth, myso)
      const cbethCollMysoLoanPostPrice = await mysoOracle.getPrice(cbeth, myso)

      if (showLogs) {
        console.log(
          'wethCollMysoLoanPostPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(wethCollMysoLoanPostPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'wstEthCollMysoLoanPostPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(wstEthCollMysoLoanPostPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'rethCollMysoLoanPostPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(rethCollMysoLoanPostPrice, 18).slice(0, 8))) / 1000000
        )
        console.log(
          'cbEthCollMysoLoanPostPrice',
          Math.round(1000000 * Number(ethers.utils.formatUnits(cbethCollMysoLoanPostPrice, 18).slice(0, 8))) / 1000000
        )
      }
    })
  })
})
