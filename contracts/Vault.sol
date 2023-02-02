pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
import {DataTypes} from "./DataTypes.sol";

import "hardhat/console.sol";

contract Vault is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    uint256 BASE = 1e18;

    mapping(address => uint256) public loanIds;
    mapping(address => mapping(uint256 => DataTypes.Loan)) public loans;
    mapping(address => uint256) public lockedAmounts;
    mapping(bytes32 => bool) executedQuote;

    address public owner;
    address public newOwner;

    DataTypes.StandingLoanOffer[10] public standingLoanOffers; // stores standing loan offers

    /*
    can remove ILendingPool because also interest bearing tokens can be deposited 
    by virtue of simple transfer; e.g. lender can also deposit an atoken and allow
    borrowers to directly borrow the atoken; the repayment amount could then also be
    set to be atoken such that on repayment any idle funds automatically continue earning
    yield
    */

    error Invalid();

    constructor() {
        owner = msg.sender;
    }

    function proposeNewOwner(address _newOwner) external {
        if (msg.sender != owner || _newOwner == address(0)) {
            revert Invalid();
        }
        newOwner = _newOwner;
    }

    function claimOwnership() external {
        if (msg.sender != newOwner) {
            revert Invalid();
        }
        owner = newOwner;
    }

    function cancelOrder(DataTypes.LoanQuote calldata loanQuote) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        bytes32 payloadHash = keccak256(
            abi.encode(
                loanQuote.borrower,
                loanQuote.collToken,
                loanQuote.loanToken,
                loanQuote.upfrontFeeToken,
                loanQuote.pledgeAmount,
                loanQuote.loanAmount,
                loanQuote.expiry,
                loanQuote.earliestRepay,
                loanQuote.repayAmount,
                loanQuote.validUntil,
                loanQuote.upfrontFee
            )
        );
        executedQuote[payloadHash] = true;
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

    function setStandingLoanOffer(
        DataTypes.StandingLoanOffer calldata standingLoanOffer,
        uint256 loanOfferId
    ) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        standingLoanOffers[loanOfferId] = standingLoanOffer;
    }

    // possibly whitelist possible coll and borr tokens so that
    // previous borrowers don't have to worry some malicious
    // ERC-20 draining funds later? obviously for first prototype not needed
    // but something to keep in mind maybe
    function borrow(
        uint256 loanOfferId,
        uint256 pledgeAmount,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        DataTypes.StandingLoanOffer
            memory standingLoanOffer = standingLoanOffers[loanOfferId];
        if (
            standingLoanOffer.collToken == address(0) ||
            standingLoanOffer.loanToken == address(0)
        ) {
            revert Invalid();
        }
        loanIds[standingLoanOffer.collToken] += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.loanToken = standingLoanOffer.loanToken;
        loan.expiry = uint40(block.timestamp + standingLoanOffer.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + standingLoanOffer.timeUntilEarliestRepay
        );
        uint256 tmp = (standingLoanOffer.loanPerCollUnit * pledgeAmount) /
            IERC20Metadata(standingLoanOffer.collToken).decimals();
        if (uint128(tmp) != tmp) {
            revert Invalid();
        }
        loan.initLoanAmount = uint128(tmp);
        if (standingLoanOffer.isNegativeRate) {
            tmp = (tmp * (BASE - standingLoanOffer.interestRate)) / BASE;
        } else {
            tmp = (tmp * (BASE + standingLoanOffer.interestRate)) / BASE;
        }
        if (uint128(tmp) != tmp) {
            revert Invalid();
        }
        loan.initRepayAmount = uint128(tmp);

        uint256 loanTokenBalBefore = IERC20Metadata(standingLoanOffer.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(standingLoanOffer.collToken)
            .balanceOf(address(this));

        IERC20Metadata(standingLoanOffer.loanToken).safeTransfer(
            msg.sender,
            loan.initLoanAmount
        );
        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data);
        }
        IERC20Metadata(standingLoanOffer.collToken).safeTransferFrom(
            msg.sender,
            address(this),
            pledgeAmount
        );

        uint256 loanTokenBalAfter = IERC20Metadata(standingLoanOffer.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalAfter = IERC20Metadata(standingLoanOffer.collToken)
            .balanceOf(address(this));
        uint256 collTokenReceived = collTokenBalAfter - collTokenBalBefore;

        if (uint128(collTokenReceived) != collTokenReceived) {
            revert Invalid();
        }
        loan.initCollAmount = uint128(collTokenReceived);
        loans[standingLoanOffer.collToken][
            loanIds[standingLoanOffer.collToken]
        ] = loan;
        lockedAmounts[standingLoanOffer.collToken] += uint128(
            collTokenReceived
        );

        if (loanTokenBalBefore - loanTokenBalAfter > loan.initLoanAmount) {
            revert Invalid();
        }
        if (collTokenReceived < pledgeAmount) {
            revert Invalid();
        }
    }

    function borrowWithQuote(
        DataTypes.LoanQuote calldata loanQuote,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        {
            bytes32 payloadHash = keccak256(
                abi.encode(
                    loanQuote.borrower,
                    loanQuote.collToken,
                    loanQuote.loanToken,
                    loanQuote.upfrontFeeToken,
                    loanQuote.pledgeAmount,
                    loanQuote.loanAmount,
                    loanQuote.expiry,
                    loanQuote.earliestRepay,
                    loanQuote.repayAmount,
                    loanQuote.validUntil,
                    loanQuote.upfrontFee
                )
            );
            if (executedQuote[payloadHash]) {
                revert Invalid();
            }
            executedQuote[payloadHash] = true;

            bytes32 messageHash = keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    payloadHash
                )
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
            if (
                loanQuote.borrower != address(0) &&
                loanQuote.borrower != msg.sender
            ) {
                revert Invalid();
            }
        }

        loanIds[loanQuote.collToken] += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.loanToken = loanQuote.loanToken;
        loan.expiry = uint40(loanQuote.expiry);
        loan.earliestRepay = uint40(loanQuote.earliestRepay);
        loan.initRepayAmount = uint128(loanQuote.repayAmount);

        uint256 loanTokenBalBefore = IERC20Metadata(loanQuote.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(loanQuote.collToken)
            .balanceOf(address(this));
        uint256 feeTokenBalBefore = IERC20Metadata(loanQuote.upfrontFeeToken)
            .balanceOf(address(this));

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
        IERC20Metadata(loanQuote.upfrontFeeToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanQuote.upfrontFee
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanQuote.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalAfter = IERC20Metadata(loanQuote.collToken)
            .balanceOf(address(this));
        uint256 feeTokenBalAfter = IERC20Metadata(loanQuote.collToken)
            .balanceOf(address(this));

        loan.initCollAmount = uint128(collTokenBalAfter - collTokenBalBefore);
        loans[loanQuote.collToken][loanIds[loanQuote.collToken]] = loan;
        lockedAmounts[loanQuote.collToken] += uint128(
            collTokenBalAfter - collTokenBalBefore
        );

        if (loanTokenBalBefore - loanTokenBalAfter < loanQuote.loanAmount) {
            revert Invalid();
        }
        if (collTokenBalAfter - collTokenBalBefore < loanQuote.pledgeAmount) {
            revert Invalid();
        }
        if (feeTokenBalAfter - feeTokenBalBefore < loanQuote.upfrontFee) {
            revert Invalid();
        }
    }

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        DataTypes.Loan storage loan = loans[loanRepayInfo.collToken][
            loanRepayInfo.loanId
        ];

        uint256 reclaimCollAmount = (loan.initCollAmount *
            loanRepayInfo.repayAmount) / loan.initRepayAmount;

        if (msg.sender != loan.borrower) {
            revert Invalid();
        }
        if (
            block.timestamp < loan.earliestRepay ||
            block.timestamp >= loan.expiry
        ) {
            revert Invalid();
        }
        if (
            loanRepayInfo.repayAmount >
            loan.initRepayAmount - loan.amountRepaidSoFar
        ) {
            revert Invalid();
        }

        uint256 loanTokenBalBefore = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));
        uint256 collTokenBalBefore = IERC20Metadata(loanRepayInfo.collToken)
            .balanceOf(address(this));

        IERC20Metadata(loanRepayInfo.collToken).safeTransfer(
            msg.sender,
            reclaimCollAmount
        );
        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data);
        }
        IERC20Metadata(loanRepayInfo.loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            loanRepayInfo.repayAmount + loanRepayInfo.loanTokenTransferFees
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loanRepayInfo.loanToken)
            .balanceOf(address(this));

        uint256 loanTokenAmountReceived = loanTokenBalAfter -
            loanTokenBalBefore;
        uint256 collTokenBalAfter = IERC20Metadata(loanRepayInfo.collToken)
            .balanceOf(address(this));

        if (loanTokenAmountReceived < loanRepayInfo.repayAmount) {
            revert Invalid();
        }

        if (collTokenBalBefore - collTokenBalAfter < reclaimCollAmount) {
            revert Invalid();
        }

        loan.amountRepaidSoFar += uint128(loanTokenAmountReceived);
        lockedAmounts[loanRepayInfo.collToken] -= uint128(reclaimCollAmount);
    }

    function unlockCollateral(
        address collToken,
        uint256[] calldata _loanIds
    ) external {
        uint256 totalUnlockableColl;
        for (uint256 i = 0; i < _loanIds.length; ) {
            uint256 tmp = 0;
            DataTypes.Loan storage loan = loans[collToken][_loanIds[i]];
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
        lockedAmounts[collToken] -= totalUnlockableColl;
        uint256 currentCollTokenBalance = IERC20Metadata(collToken).balanceOf(
            address(this)
        );
        IERC20Metadata(collToken).safeTransfer(
            owner,
            currentCollTokenBalance - lockedAmounts[collToken]
        );
    }
}
