pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ILendingPool} from "./interfaces/ILendingPool.sol";
import {ILendingPoolAddressesProvider} from "./interfaces/ILendingPoolAddressesProvider.sol";
import {IPriceOracleGetter} from "./interfaces/IPriceOracleGetter.sol";
import {IMysoV2FlashCallback} from "./interfaces/IMysoV2FlashCallback.sol";
import "hardhat/console.sol";

struct Loan { 
   address borrower;
   address collToken;
   address loanToken;
   uint256 expiry;
   uint256 initCollAmount;
   uint256 initLoanAmount;
   uint256 initRepayAmount;
   uint256 amountRepaidSoFar;
   uint256 collUnlockedSoFar;
}

struct LendingConfig {
    uint128 minRate;
    uint128 maxRate;
    uint128 spread;
    uint128 ltv;
    uint128 minLoanSize;
    uint40 minTenor;
    uint40 maxTenor;
}

contract Vault is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    mapping(address => mapping(address => LendingConfig)) public lendingConfigs;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public lockedAmounts;
    uint256 public loanId;
    address public owner;
    address public router;

    address AAVE_V2_LENDING_POOL_ADDR = 0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9;
    address AAVE_V2_LENDING_POOL_ADDRS_PROVIDER = 0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5;

    uint256 constant WAD = 1e27;

    error Invalid();

    constructor(address _router) {
        owner = msg.sender;
        router = _router;
    }
    

    function deposit(address token, uint256 amount, uint16 referralCode) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransferFrom(msg.sender, address(this), amount);
        ILendingPool(AAVE_V2_LENDING_POOL_ADDR).deposit(token, amount, address(this), referralCode);
    }

    function withdraw(address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransfer(owner, amount);
    }

    function setLendingConfig(address[] calldata loanAndCollToken, LendingConfig calldata _lendingConfig) external {
        (address loanToken, address collToken) = (loanAndCollToken[0], loanAndCollToken[1]);
        if (msg.sender != owner) {
            revert Invalid();
        }
        LendingConfig storage lendingConfig = lendingConfigs[loanToken][collToken];
        lendingConfig.minRate = _lendingConfig.minRate;
        lendingConfig.maxRate = _lendingConfig.maxRate;
        lendingConfig.spread = _lendingConfig.spread;
        lendingConfig.ltv = _lendingConfig.ltv;
        lendingConfig.minLoanSize = _lendingConfig.minLoanSize;
        lendingConfig.minTenor = _lendingConfig.minTenor;
        lendingConfig.maxTenor = _lendingConfig.maxTenor;
    }

    function quote(address[] calldata loanAndCollToken, uint256 collAmount, uint256 tenor) public view returns (uint256 loanAmount, uint256 repayAmount, uint256 expiry) {
        (address loanToken, address collToken) = (loanAndCollToken[0], loanAndCollToken[1]);
        expiry = block.timestamp + tenor;
        LendingConfig memory lendingConfig = lendingConfigs[loanToken][collToken];
        uint256 quoteRate = ILendingPool(AAVE_V2_LENDING_POOL_ADDR).getReserveData(loanToken).currentStableBorrowRate;
        quoteRate = quoteRate > lendingConfig.minRate ? quoteRate : lendingConfig.minRate;
        quoteRate = quoteRate + lendingConfig.spread;
        quoteRate = quoteRate < lendingConfig.maxRate ? quoteRate : lendingConfig.maxRate;

        if (tenor < lendingConfig.minTenor || lendingConfig.maxTenor < tenor) {
            revert Invalid();
        }

        address oracle = ILendingPoolAddressesProvider(AAVE_V2_LENDING_POOL_ADDRS_PROVIDER).getPriceOracle();
        uint256[] memory assetPrices = IPriceOracleGetter(oracle).getAssetsPrices(loanAndCollToken);

        uint256 collPriceDenomInLoanCcy = assetPrices[1] * 10**IERC20Metadata(loanToken).decimals() / assetPrices[0];
        loanAmount = collPriceDenomInLoanCcy * lendingConfig.ltv * collAmount / WAD / 10**IERC20Metadata(collToken).decimals();

        if (loanAmount < lendingConfig.minLoanSize) {
            revert Invalid();
        }

        repayAmount = loanAmount + loanAmount * quoteRate * tenor / (24*60*60*365) / WAD;
        if (repayAmount <= loanAmount) {
            revert Invalid();
        }
    }

    function borrow(address[] calldata loanAndCollToken, uint256 pledgeAmount, uint256 tenor, address callbacker, bytes calldata data) external nonReentrant() {
        (address loanToken, address collToken) = (loanAndCollToken[0], loanAndCollToken[1]);
        (uint256 loanAmount, uint256 repayAmount, uint256 expiry) = quote(loanAndCollToken, pledgeAmount, tenor);
        
        Loan memory loan;
        loan.borrower = msg.sender;
        loan.loanToken = loanToken;
        loan.collToken = collToken;
        loan.expiry = expiry;
        loan.initRepayAmount = repayAmount;

        uint256 loanTokenBalBefore = IERC20Metadata(loanToken).balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(collToken).balanceOf(address(this));
        
        IERC20Metadata(loanToken).safeTransfer(msg.sender, loanAmount);
        if (callbacker != address(0)) {
            IMysoV2FlashCallback(callbacker).mysoV2FlashCallback(0, 0, data);
        }
        IERC20Metadata(collToken).safeTransferFrom(msg.sender, address(this), pledgeAmount);

        uint256 loanTokenBalAfter = IERC20Metadata(loanToken).balanceOf(address(this));
        uint256 collTokenBalAfter = IERC20Metadata(collToken).balanceOf(address(this));
        uint256 collTokenReceived = collTokenBalAfter - collTokenBalBefore;
        
        loan.initCollAmount = collTokenReceived;
        loans[loanId] = loan;

        if (loanTokenBalBefore - loanTokenBalAfter < loanAmount) {
            revert Invalid();
        }
        if (collTokenReceived < pledgeAmount) {
            revert Invalid();
        }
    }

    function repay(uint256 _loanId, uint256 repayAmount, uint256 loanTokenTransferFees, address callbacker, bytes calldata data) external {
        Loan storage loan = loans[_loanId];

        (address loanToken, address collToken) = (loan.loanToken, loan.collToken);
        uint256 reclaimCollAmount = loan.initCollAmount * repayAmount / loan.initRepayAmount;

        if (msg.sender != loan.borrower) {
            revert Invalid();
        }
        if (block.timestamp >= loan.expiry) {
            revert Invalid();
        }
        if (repayAmount > repayAmount - loan.amountRepaidSoFar) {
            revert Invalid();
        }

        uint256 loanTokenBalBefore = IERC20Metadata(loanToken).balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(collToken).balanceOf(address(this));

        IERC20Metadata(collToken).safeTransfer(msg.sender, reclaimCollAmount);
        if (callbacker != address(0)) {
            IMysoV2FlashCallback(callbacker).mysoV2FlashCallback(0, 0, data);
        }
        IERC20Metadata(loanToken).safeTransferFrom(msg.sender, address(this), repayAmount+loanTokenTransferFees);

        uint256 loanTokenBalAfter = IERC20Metadata(loanToken).balanceOf(address(this));
        uint256 loanTokenAmountReceived = loanTokenBalAfter - loanTokenBalBefore;
        uint256 collTokenBalAfter = IERC20Metadata(collToken).balanceOf(address(this));

        if (loanTokenAmountReceived < repayAmount - loan.amountRepaidSoFar) {
            revert Invalid();
        }

        if (collTokenBalAfter - collTokenBalBefore < reclaimCollAmount) {
            revert Invalid();
        }

        loan.amountRepaidSoFar += loanTokenAmountReceived;
        lockedAmounts[loan.collToken] -= reclaimCollAmount;
    }

    function unlockCollateral(address token, uint256[] calldata loanIds) external {
        uint256 tmp;
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < loanIds.length; ) {
            Loan storage loan = loans[loanIds[i]];
            if (loan.collToken != token) {
                revert Invalid();
            }
            if (block.timestamp >= loan.expiry) {
                tmp = loan.initCollAmount - loan.collUnlockedSoFar;
            } else {
                tmp = loan.initCollAmount * loan.amountRepaidSoFar / loan.initRepayAmount - loan.collUnlockedSoFar;
            }
            loan.collUnlockedSoFar += tmp;
            totalUnlockableColl += tmp;
            unchecked { i++; }
        }
    lockedAmounts[token] -= totalUnlockableColl;
    }
}
