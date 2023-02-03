pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IVaultFlashCallback} from "./interfaces/IVaultFlashCallback.sol";
import {DataTypes} from "./DataTypes.sol";

contract LenderVault is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    uint256 BASE = 1e18;

    mapping(address => uint256) public lockedAmounts;
    mapping(bytes32 => bool) isConsumedQuote;
    mapping(bytes32 => bool) public isStandingLoanOffer;
    DataTypes.StandingLoanOffer[] public standingLoanOffers; // stores standing loan offers
    DataTypes.Loan[] public loans; // stores loans

    uint256 public currLoanId;
    uint256 public loanQuoteNonce;
    address public owner;
    address public newOwner;

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
        loanQuoteNonce = 1;
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

    function invalidateQuotes() external {
        if (msg.sender != newOwner) {
            revert Invalid();
        }
        loanQuoteNonce += 1;
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

    function addStandingLoanOffer(
        DataTypes.StandingLoanOffer calldata standingLoanOffer
    ) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        if (
            standingLoanOffer.collToken == address(0) ||
            standingLoanOffer.loanToken == address(0) ||
            standingLoanOffer.collToken == standingLoanOffer.loanToken ||
            standingLoanOffer.timeUntilEarliestRepay >
            standingLoanOffer.tenor ||
            (standingLoanOffer.isNegativeInterestRate &&
                standingLoanOffer.interestRatePctInBase > BASE)
        ) {
            revert Invalid();
        }
        bytes32 standingLoanOfferHash = hashStandingLoanOffer(
            standingLoanOffer
        );
        if (isStandingLoanOffer[standingLoanOfferHash]) {
            revert Invalid();
        }
        isStandingLoanOffer[standingLoanOfferHash] = true;
        standingLoanOffers.push(standingLoanOffer);
    }

    function updateStandingLoanOffer(
        uint256 oldStandingLoanOfferIdx,
        DataTypes.StandingLoanOffer calldata newStandingLoanOffer
    ) external {
        if (msg.sender != owner) {
            revert Invalid();
        }
        uint256 arrayLen = standingLoanOffers.length;
        if (oldStandingLoanOfferIdx > arrayLen - 1) {
            revert Invalid();
        }
        DataTypes.StandingLoanOffer
            memory oldStandingLoanOffer = standingLoanOffers[
                oldStandingLoanOfferIdx
            ];
        bytes32 oldStandingLoanOfferHash = hashStandingLoanOffer(
            oldStandingLoanOffer
        );
        isStandingLoanOffer[oldStandingLoanOfferHash] = false;

        if (
            newStandingLoanOffer.collToken == address(0) ||
            newStandingLoanOffer.loanToken == address(0)
        ) {
            standingLoanOffers[oldStandingLoanOfferIdx] = standingLoanOffers[
                arrayLen - 1
            ];
            standingLoanOffers.pop();
        } else {
            bytes32 newStandingLoanOfferHash = hashStandingLoanOffer(
                newStandingLoanOffer
            );
            if (oldStandingLoanOfferHash == newStandingLoanOfferHash) {
                revert Invalid();
            }
            isStandingLoanOffer[newStandingLoanOfferHash] = true;
            standingLoanOffers[oldStandingLoanOfferIdx] = newStandingLoanOffer;
        }
    }

    // possibly whitelist possible coll and borr tokens so that
    // previous borrowers don't have to worry some malicious
    // ERC-20 draining funds later? obviously for first prototype not needed
    // but something to keep in mind maybe
    function borrow(
        DataTypes.StandingLoanOffer calldata standingLoanOffer,
        uint256 sendAmount,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        if (!isStandingLoanOffer[hashStandingLoanOffer(standingLoanOffer)]) {
            revert Invalid();
        }
        currLoanId += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.collToken = standingLoanOffer.collToken;
        loan.loanToken = standingLoanOffer.loanToken;
        loan.expiry = uint40(block.timestamp + standingLoanOffer.tenor);
        loan.earliestRepay = uint40(
            block.timestamp + standingLoanOffer.timeUntilEarliestRepay
        );
        uint256 tmp = (standingLoanOffer.loanPerCollUnit * sendAmount) /
            (10 ** IERC20Metadata(standingLoanOffer.collToken).decimals());
        if (uint128(tmp) != tmp) {
            revert Invalid();
        }
        loan.initLoanAmount = uint128(tmp);
        if (standingLoanOffer.isNegativeInterestRate) {
            tmp =
                (tmp * (BASE - standingLoanOffer.interestRatePctInBase)) /
                BASE;
        } else {
            tmp =
                (tmp * (BASE + standingLoanOffer.interestRatePctInBase)) /
                BASE;
        }
        if (uint128(tmp) != tmp) {
            revert Invalid();
        }
        loan.initRepayAmount = uint128(tmp);

        tmp = (sendAmount * standingLoanOffer.upfrontFeePctInBase) / BASE;

        _borrowTransfers(loan, sendAmount, tmp, callbacker, data);
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
                    loanQuote.sendAmount,
                    loanQuote.loanAmount,
                    loanQuote.expiry,
                    loanQuote.earliestRepay,
                    loanQuote.repayAmount,
                    loanQuote.validUntil,
                    loanQuote.upfrontFee,
                    loanQuote.nonce
                )
            );
            if (
                isConsumedQuote[payloadHash] ||
                loanQuote.nonce >= loanQuoteNonce
            ) {
                revert Invalid();
            }
            isConsumedQuote[payloadHash] = true;

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

        currLoanId += 1;

        DataTypes.Loan memory loan;
        loan.borrower = msg.sender;
        loan.collToken = loanQuote.collToken;
        loan.loanToken = loanQuote.loanToken;
        loan.expiry = uint40(loanQuote.expiry);
        loan.earliestRepay = uint40(loanQuote.earliestRepay);
        loan.initRepayAmount = uint128(loanQuote.repayAmount);
        loan.initLoanAmount = uint128(loanQuote.loanAmount);

        _borrowTransfers(
            loan,
            loanQuote.sendAmount,
            loanQuote.upfrontFee,
            callbacker,
            data
        );
    }

    function _borrowTransfers(
        DataTypes.Loan memory loan,
        uint256 sendAmount,
        uint256 upfrontFee,
        address callbacker,
        bytes calldata data
    ) internal {
        uint256 loanTokenBalBefore = IERC20Metadata(loan.loanToken).balanceOf(
            address(this)
        );
        if (
            loanTokenBalBefore - lockedAmounts[loan.loanToken] <
            loan.initLoanAmount
        ) {
            revert();
        }
        uint256 collTokenBalBefore = IERC20Metadata(loan.collToken).balanceOf(
            address(this)
        );

        IERC20Metadata(loan.loanToken).safeTransfer(
            msg.sender,
            loan.initLoanAmount
        );
        if (callbacker != address(0)) {
            IVaultFlashCallback(callbacker).vaultFlashCallback(loan, data);
        }
        IERC20Metadata(loan.collToken).safeTransferFrom(
            msg.sender,
            address(this),
            sendAmount
        );

        uint256 loanTokenBalAfter = IERC20Metadata(loan.loanToken).balanceOf(
            address(this)
        );
        uint256 collTokenBalAfter = IERC20Metadata(loan.collToken).balanceOf(
            address(this)
        );

        uint256 reclaimable = collTokenBalAfter -
            collTokenBalBefore -
            upfrontFee;
        if (reclaimable != uint128(reclaimable)) {
            revert Invalid();
        }
        loan.initCollAmount = uint128(reclaimable);
        loans.push(loan);
        lockedAmounts[loan.collToken] += uint128(reclaimable);

        if (loanTokenBalBefore - loanTokenBalAfter < loan.initLoanAmount) {
            revert Invalid();
        }
        if (collTokenBalAfter - collTokenBalBefore < sendAmount) {
            revert Invalid();
        }
    }

    function repay(
        DataTypes.LoanRepayInfo calldata loanRepayInfo,
        address callbacker,
        bytes calldata data
    ) external nonReentrant {
        DataTypes.Loan memory loan = loans[loanRepayInfo.loanId];
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
        uint256 reclaimCollAmount = (loan.initCollAmount *
            loanRepayInfo.repayAmount) / loan.initRepayAmount;

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
            DataTypes.Loan storage loan = loans[_loanIds[i]];
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

    function hashStandingLoanOffer(
        DataTypes.StandingLoanOffer memory standingLoanOffer
    ) internal pure returns (bytes32 standingLoanOfferHash) {
        standingLoanOfferHash = keccak256(
            abi.encode(
                standingLoanOffer.loanPerCollUnit,
                standingLoanOffer.interestRatePctInBase,
                standingLoanOffer.upfrontFeePctInBase,
                standingLoanOffer.collToken,
                standingLoanOffer.loanToken,
                standingLoanOffer.tenor,
                standingLoanOffer.timeUntilEarliestRepay,
                standingLoanOffer.isNegativeInterestRate
            )
        );
    }
}
