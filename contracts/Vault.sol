pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
import {ILendingPool} from "./interfaces/ILendingPool.sol";
import {DataTypes} from "./DataTypes.sol";

import "hardhat/console.sol";

contract Vault is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    mapping(uint256 => DataTypes.Loan) public loans;
    mapping(address => uint256) public lockedAmounts;
    uint256 public loanId;
    address public owner;
    address public router;

    address AAVE_V2_LENDING_POOL_ADDR =
        0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9;
    address USDC = address(0);

    error Invalid();

    constructor(address _router) {
        owner = msg.sender;
        router = _router;
    }

    function deposit(address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        IERC20Metadata(token).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        if (token == USDC) {
            ILendingPool(AAVE_V2_LENDING_POOL_ADDR).deposit(
                token,
                amount,
                address(this),
                0
            );
        }
    }

    function withdraw(address token, uint256 amount) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        uint256 vaultBalance = IERC20Metadata(token).balanceOf(address(this));
        if (amount > vaultBalance - lockedAmounts[token]) {
            revert Invalid();
        }

        if (token == USDC) {
            ILendingPool(AAVE_V2_LENDING_POOL_ADDR).withdraw(
                token,
                amount,
                msg.sender
            );
        }
        IERC20Metadata(token).safeTransfer(owner, amount);
    }

    function borrow(
        DataTypes.LoanQuote calldata loanQuote,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        bytes32 payloadHash = keccak256(
            abi.encode(
                loanQuote.borrower,
                loanQuote.collToken,
                loanQuote.loanToken,
                loanQuote.pledgeAmount,
                loanQuote.loanAmount,
                loanQuote.expiry,
                loanQuote.earliestRepay,
                loanQuote.repayAmount,
                loanQuote.validUntil
            )
        );
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );
        address signer = ecrecover(
            messageHash,
            loanQuote.v,
            loanQuote.r,
            loanQuote.s
        );

        if (signer != owner || loanQuote.validUntil < block.timestamp) {
            revert Invalid();
        }

        loanId += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.loanToken = loanQuote.loanToken;
        loan.collToken = loanQuote.collToken;
        loan.expiry = uint40(loanQuote.expiry);
        loan.earliestRepay = uint40(loanQuote.earliestRepay);
        loan.initRepayAmount = uint128(loanQuote.repayAmount);

        uint256 loanTokenBalBefore = IERC20Metadata(loanQuote.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(loanQuote.collToken)
            .balanceOf(address(this));

        if (loanQuote.loanToken == USDC) {
            ILendingPool(AAVE_V2_LENDING_POOL_ADDR).withdraw(
                loanQuote.loanToken,
                loanQuote.loanAmount,
                address(this)
            );
        }

        IERC20Metadata(loanQuote.loanToken).safeTransfer(
            msg.sender,
            loanQuote.loanAmount
        );
        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data);
        }
        IERC20Metadata(loanQuote.collToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanQuote.pledgeAmount
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanQuote.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalAfter = IERC20Metadata(loanQuote.collToken)
            .balanceOf(address(this));
        uint256 collTokenReceived = collTokenBalAfter - collTokenBalBefore;

        loan.initCollAmount = uint128(collTokenReceived);
        loans[loanId] = loan;

        if (loanTokenBalBefore - loanTokenBalAfter < loanQuote.loanAmount) {
            revert Invalid();
        }
        if (collTokenReceived < loanQuote.pledgeAmount) {
            revert Invalid();
        }
    }

    function repay(
        uint256 _loanId,
        uint256 repayAmount,
        uint256 loanTokenTransferFees,
        address callbacker,
        bytes calldata data
    ) external {
        DataTypes.Loan storage loan = loans[_loanId];

        (address loanToken, address collToken) = (
            loan.loanToken,
            loan.collToken
        );
        uint256 reclaimCollAmount = (loan.initCollAmount * repayAmount) /
            loan.initRepayAmount;

        if (msg.sender != loan.borrower) {
            revert Invalid();
        }
        if (
            block.timestamp < loan.earliestRepay ||
            block.timestamp >= loan.expiry
        ) {
            revert Invalid();
        }
        if (repayAmount > loan.initRepayAmount - loan.amountRepaidSoFar) {
            revert Invalid();
        }

        uint256 loanTokenBalBefore = IERC20Metadata(loanToken).balanceOf(
            address(this)
        );
        uint256 collTokenBalBefore = IERC20Metadata(collToken).balanceOf(
            address(this)
        );

        IERC20Metadata(collToken).safeTransfer(msg.sender, reclaimCollAmount);
        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data);
        }
        IERC20Metadata(loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            repayAmount + loanTokenTransferFees
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanToken).balanceOf(
            address(this)
        );
        uint256 loanTokenAmountReceived = loanTokenBalAfter -
            loanTokenBalBefore;
        uint256 collTokenBalAfter = IERC20Metadata(collToken).balanceOf(
            address(this)
        );

        if (loanTokenAmountReceived < repayAmount) {
            revert Invalid();
        }

        if (collTokenBalBefore - collTokenBalAfter < reclaimCollAmount) {
            revert Invalid();
        }

        loan.amountRepaidSoFar += uint128(loanTokenAmountReceived);
        lockedAmounts[loan.collToken] -= uint128(reclaimCollAmount);

        if (loanToken == USDC) {
            ILendingPool(AAVE_V2_LENDING_POOL_ADDR).deposit(
                loanToken,
                loanTokenAmountReceived,
                address(this),
                0
            );
        }
    }

    function unlockCollateral(
        address token,
        uint256[] calldata loanIds
    ) external {
        uint256 tmp;
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < loanIds.length; ) {
            DataTypes.Loan storage loan = loans[loanIds[i]];
            if (loan.collToken != token) {
                revert Invalid();
            }
            if (!loan.collUnlocked && block.timestamp >= loan.expiry) {
                tmp =
                    loan.initCollAmount -
                    (loan.initCollAmount * loan.amountRepaidSoFar) /
                    loan.initRepayAmount;
            }
            loan.collUnlocked = true;
            totalUnlockableColl += tmp;
            unchecked {
                i++;
            }
        }
        lockedAmounts[token] -= totalUnlockableColl;
    }
}
