// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IEvents} from "./interfaces/IEvents.sol";
import {IFundingPool} from "./interfaces/IFundingPool.sol";
import {Constants} from "../Constants.sol";
import {DataTypes} from "./DataTypes.sol";
import {Errors} from "../Errors.sol";

contract LoanProposalImpl is Initializable, IEvents, ILoanProposalImpl {
    using SafeERC20 for IERC20Metadata;

    DataTypes.LoanStatus public status;
    address public fundingPool;
    address public collToken;
    address public arranger;
    uint256 public arrangerFee;
    uint256 public finalLoanAmount;
    uint256 public finalCollAmountReservedForDefault;
    uint256 public finalCollAmountReservedForConversions;
    uint256 public loanTermsLockedTime;
    uint256 public lenderGracePeriod;
    uint256 public currentRepaymentIdx;
    uint256 public totalSubscriptionsThatClaimedOnDefault;
    mapping(uint256 => uint256) public totalConvertedSubscriptionsPerIdx; // denominated in loan Token
    mapping(uint256 => uint256) public collTokenConverted;
    mapping(address => mapping(uint256 => bool))
        internal lenderExercisedConversion;
    mapping(address => mapping(uint256 => bool))
        internal lenderClaimedRepayment;
    mapping(address => bool) internal lenderClaimedCollateralOnDefault;
    DataTypes.LoanTerms internal _loanTerms;
    mapping(uint256 => uint256) internal loanTokenRepaid;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _arranger,
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external initializer {
        if (
            _fundingPool == address(0) ||
            _collToken == address(0) ||
            _arranger == address(0)
        ) {
            revert Errors.InvalidAddress();
        }
        if (_arrangerFee == 0) {
            revert Errors.InvalidFee();
        }
        if (
            _lenderGracePeriod < Constants.MIN_LENDER_UNSUBSCRIBE_GRACE_PERIOD
        ) {
            revert Errors.UnsubscribeGracePeriodTooShort();
        }
        fundingPool = _fundingPool;
        collToken = _collToken;
        arranger = _arranger;
        arrangerFee = _arrangerFee;
        lenderGracePeriod = _lenderGracePeriod;
    }

    function proposeLoanTerms(
        DataTypes.LoanTerms calldata newLoanTerms
    ) external {
        if (msg.sender != arranger) {
            revert Errors.InvalidSender();
        }
        if (
            status != DataTypes.LoanStatus.WITHOUT_LOAN_TERMS &&
            status != DataTypes.LoanStatus.IN_NEGOTIATION
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        repaymentScheduleCheck(newLoanTerms.repaymentSchedule);
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        (, , uint256 _finalLoanAmount, , ) = getAbsoluteLoanTerms(
            newLoanTerms,
            totalSubscribed,
            IERC20Metadata(IFundingPool(fundingPool).depositToken()).decimals()
        );
        if (_finalLoanAmount > newLoanTerms.maxLoanAmount) {
            revert Errors.InvalidNewLoanTerms();
        }
        _loanTerms = newLoanTerms;
        status = DataTypes.LoanStatus.IN_NEGOTIATION;

        emit LoanTermsProposed(fundingPool, newLoanTerms);
    }

    function acceptLoanTerms() external {
        if (msg.sender != _loanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        if (status != DataTypes.LoanStatus.IN_NEGOTIATION) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        // check if enough subscriptions
        // note: no need to check if subscriptions are > maxLoanAmount as
        // this is already done in funding pool
        if (totalSubscribed < _loanTerms.minLoanAmount) {
            revert Errors.TotalSubscribedTooLow();
        }
        loanTermsLockedTime = block.timestamp;
        status = DataTypes.LoanStatus.BORROWER_ACCEPTED;

        emit LoanTermsAccepted(fundingPool);
    }

    function finalizeLoanTermsAndTransferColl(
        uint256 expectedTransferFee
    ) external {
        DataTypes.LoanTerms memory _unfinalizedLoanTerms = _loanTerms;
        if (msg.sender != _unfinalizedLoanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        if (
            status != DataTypes.LoanStatus.BORROWER_ACCEPTED ||
            block.timestamp < timeUntilLendersCanUnsubscribe()
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        if (
            totalSubscribed < _unfinalizedLoanTerms.minLoanAmount ||
            totalSubscribed > _unfinalizedLoanTerms.maxLoanAmount
        ) {
            revert Errors.TotalSubscribedNotTargetInRange();
        }
        if (
            _unfinalizedLoanTerms.repaymentSchedule[0].dueTimestamp <=
            block.timestamp + Constants.MIN_TIME_UNTIL_FIRST_DUE_DATE
        ) {
            revert Errors.DueDatesTooClose();
        }
        status = DataTypes.LoanStatus.READY_TO_EXECUTE;
        // note: now that final subscription amounts are known, convert relative values
        // to absolute, i.e.:
        // i) loanTokenDue from relative (e.g., 25% of final loan amount) to absolute (e.g., 25 USDC),
        // ii) collTokenDueIfConverted from relative (e.g., convert every
        // 1 loanToken for 8 collToken) to absolute (e.g., 200 collToken)
        (
            DataTypes.LoanTerms memory _finalizedLoanTerms,
            uint256 _arrangerFee,
            uint256 _finalLoanAmount,
            uint256 _finalCollAmountReservedForDefault,
            uint256 _finalCollAmountReservedForConversions
        ) = getAbsoluteLoanTerms(
                _unfinalizedLoanTerms,
                totalSubscribed,
                IERC20Metadata(IFundingPool(fundingPool).depositToken())
                    .decimals()
            );
        for (uint256 i = 0; i < _loanTerms.repaymentSchedule.length; ) {
            _loanTerms.repaymentSchedule[i].loanTokenDue = _finalizedLoanTerms
                .repaymentSchedule[i]
                .loanTokenDue;
            _loanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted = _finalizedLoanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted;
            unchecked {
                i++;
            }
        }
        arrangerFee = _arrangerFee;
        finalLoanAmount = _finalLoanAmount;
        finalCollAmountReservedForDefault = _finalCollAmountReservedForDefault;
        finalCollAmountReservedForConversions = _finalCollAmountReservedForConversions;
        // note: final collToken amount that borrower needs to transfer is sum of:
        // 1) amount reserved for lenders in case of default, and
        // 2) amount reserved for lenders in case all convert
        uint256 preBal = IERC20Metadata(collToken).balanceOf(address(this));
        IERC20Metadata(collToken).safeTransferFrom(
            msg.sender,
            address(this),
            _finalCollAmountReservedForDefault +
                _finalCollAmountReservedForConversions +
                expectedTransferFee
        );
        uint256 postBal = IERC20Metadata(collToken).balanceOf(address(this));
        if (
            postBal - preBal !=
            _finalCollAmountReservedForDefault +
                _finalCollAmountReservedForConversions
        ) {
            revert Errors.InvalidSendAmount();
        }

        emit LoanTermsAndTransferCollFinalized(fundingPool);
    }

    function rollback() external {
        // cannot be called anymore once lockInFinalAmountsAndProvideCollateral() called
        if (status != DataTypes.LoanStatus.BORROWER_ACCEPTED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        uint256 _timeUntilLendersCanUnsubscribe = timeUntilLendersCanUnsubscribe();
        if (
            (msg.sender == _loanTerms.borrower &&
                block.timestamp < _timeUntilLendersCanUnsubscribe) ||
            (block.timestamp >= _timeUntilLendersCanUnsubscribe &&
                totalSubscribed < _loanTerms.minLoanAmount)
        ) {
            status = DataTypes.LoanStatus.ROLLBACK;
            // transfer any previously provided collToken back to borrower
            uint256 collTokenBal = IERC20Metadata(collToken).balanceOf(
                address(this)
            );
            IERC20Metadata(collToken).safeTransfer(msg.sender, collTokenBal);
        } else {
            revert Errors.InvalidRollBackRequest();
        }

        emit Rollback(fundingPool);
    }

    function updateStatusToDeployed() external {
        if (msg.sender != fundingPool) {
            revert Errors.InvalidSender();
        }
        if (status != DataTypes.LoanStatus.READY_TO_EXECUTE) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        status = DataTypes.LoanStatus.LOAN_DEPLOYED;

        emit LoanDeployed(fundingPool);
    }

    function exerciseConversion() external {
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = currentRepaymentIdx;
        checkRepaymentIdx(repaymentIdx);
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert Errors.AlreadyConvertedForCurrenPeriod();
        }
        // must be after when the period of this loan is due, but before borrower can repay
        if (
            block.timestamp <
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp ||
            block.timestamp >
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                _loanTerms.repaymentSchedule[repaymentIdx].conversionGracePeriod
        ) {
            revert Errors.OutsideConversionTimeWindow();
        }
        uint256 conversionAmount = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .collTokenDueIfConverted * lenderContribution) /
            IFundingPool(fundingPool).totalSubscribed(address(this));
        collTokenConverted[repaymentIdx] += conversionAmount;
        totalConvertedSubscriptionsPerIdx[repaymentIdx] += lenderContribution;
        lenderExercisedConversion[msg.sender][repaymentIdx] = true;
        IERC20Metadata(collToken).safeTransfer(msg.sender, conversionAmount);

        emit ConversionExercised(fundingPool);
    }

    function repay(uint256 expectedTransferFee) external {
        if (msg.sender != _loanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = currentRepaymentIdx++;
        checkRepaymentIdx(repaymentIdx);
        // must be after when the period of this loan when lenders can convert,
        // but before default period for this period
        uint256 currConversionCutoffTime = _loanTerms
            .repaymentSchedule[repaymentIdx]
            .dueTimestamp +
            _loanTerms.repaymentSchedule[repaymentIdx].conversionGracePeriod;
        uint256 currRepaymentCutoffTime = currConversionCutoffTime +
            _loanTerms.repaymentSchedule[repaymentIdx].repaymentGracePeriod;
        if (
            (block.timestamp < currConversionCutoffTime) ||
            (block.timestamp > currRepaymentCutoffTime)
        ) {
            revert Errors.OutsideRepaymentTimeWindow();
        }
        address loanToken = IFundingPool(fundingPool).depositToken();
        uint256 collTokenDueIfAllConverted = _loanTerms
            .repaymentSchedule[repaymentIdx]
            .collTokenDueIfConverted;
        uint256 collTokenLeftUnconverted = collTokenDueIfAllConverted -
            collTokenConverted[repaymentIdx];
        uint256 remainingLoanTokenDue = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .loanTokenDue * collTokenLeftUnconverted) /
            collTokenDueIfAllConverted;
        loanTokenRepaid[repaymentIdx] = remainingLoanTokenDue;
        _loanTerms.repaymentSchedule[repaymentIdx].repaid = true;
        uint256 preBal = IERC20Metadata(loanToken).balanceOf(address(this));
        IERC20Metadata(loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            remainingLoanTokenDue + expectedTransferFee
        );
        uint256 postBal = IERC20Metadata(loanToken).balanceOf(address(this));
        if (postBal - preBal != remainingLoanTokenDue) {
            revert Errors.InvalidSendAmount();
        }
        // if final repayment, send all remaining coll token back to borrower
        // else send only unconverted coll token back to borrower
        uint256 collSendAmount = _loanTerms.repaymentSchedule.length - 1 ==
            repaymentIdx
            ? IERC20Metadata(collToken).balanceOf(address(this))
            : collTokenLeftUnconverted;
        IERC20Metadata(collToken).safeTransfer(msg.sender, collSendAmount);

        emit Repay(fundingPool);
    }

    function claimRepayment(uint256 repaymentIdx) external {
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        // iff there's a repay, currentRepaymentIdx (initially 0) gets incremented;
        // hence any `repaymentIdx` smaller than `currentRepaymentIdx` will always
        // map to a valid repayment claim; no need to check `repaymentSchedule[repaymentIdx].repaid`
        if (repaymentIdx >= currentRepaymentIdx) {
            revert();
        }
        // note: users can claim as soon as repaid, no need to check getRepaymentCutoffTime(...)
        if (lenderClaimedRepayment[msg.sender][repaymentIdx]) {
            revert();
        }
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert();
        }
        address loanToken = IFundingPool(fundingPool).depositToken();
        // repaid amount for that period split over those who didn't convert in that period
        uint256 subscriptionsEntitledToRepayment = (IFundingPool(fundingPool)
            .totalSubscribed(address(this)) -
            totalConvertedSubscriptionsPerIdx[repaymentIdx]);
        uint256 claimAmount = (loanTokenRepaid[repaymentIdx] *
            lenderContribution) / subscriptionsEntitledToRepayment;
        lenderClaimedRepayment[msg.sender][repaymentIdx] = true;
        IERC20Metadata(loanToken).safeTransfer(msg.sender, claimAmount);

        emit ClaimRepayment(fundingPool);
    }

    function markAsDefaulted() external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        uint256 repaymentIdx = currentRepaymentIdx;
        // this will check if loan has been fully repaid yet in this instance
        checkRepaymentIdx(repaymentIdx);
        uint256 currRepaymentCutoffDate = getRepaymentCutoffTime(repaymentIdx);
        if (
            block.timestamp > currRepaymentCutoffDate &&
            !_loanTerms.repaymentSchedule[repaymentIdx].repaid
        ) {
            status = DataTypes.LoanStatus.DEFAULTED;
        } else {
            revert();
        }

        emit LoanDefaulted(fundingPool);
    }

    function claimDefaultProceeds() external {
        if (status != DataTypes.LoanStatus.DEFAULTED) {
            revert();
        }
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        if (lenderClaimedCollateralOnDefault[msg.sender]) {
            revert();
        }
        uint256 lastPeriodIdx = currentRepaymentIdx;
        uint256 collTokenBal = IERC20Metadata(collToken).balanceOf(
            address(this)
        );
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        uint256 stillToBeConvertedCollTokens = _loanTerms
            .repaymentSchedule[lastPeriodIdx]
            .collTokenDueIfConverted - collTokenConverted[lastPeriodIdx];
        uint256 defaultClaimProRataShare;

        // if only some lenders converted, then split 'stillToBeConvertedCollTokens'
        // fairly among lenders who didn't already convert in default period to not
        // put them at an unfair disadvantage
        uint256 totalUnconvertedSubscriptionsFromLastIdx = totalSubscribed -
            totalConvertedSubscriptionsPerIdx[lastPeriodIdx];
        uint256 stillToBeConvertedCollTokenShare;
        if (!lenderExercisedConversion[msg.sender][lastPeriodIdx]) {
            stillToBeConvertedCollTokenShare =
                (stillToBeConvertedCollTokens * lenderContribution) /
                totalUnconvertedSubscriptionsFromLastIdx;
            collTokenConverted[
                lastPeriodIdx
            ] += stillToBeConvertedCollTokenShare;
            totalConvertedSubscriptionsPerIdx[
                lastPeriodIdx
            ] += lenderContribution;
        }
        // determine pro-rata share on remaining non-conversion related collToken balance
        uint256 remainingDefaultClaimShare = ((collTokenBal -
            stillToBeConvertedCollTokens) * lenderContribution) /
            (totalSubscribed - totalSubscriptionsThatClaimedOnDefault);
        lenderClaimedCollateralOnDefault[msg.sender] = true;
        totalSubscriptionsThatClaimedOnDefault += lenderContribution;
        defaultClaimProRataShare =
            stillToBeConvertedCollTokenShare +
            remainingDefaultClaimShare;

        IERC20Metadata(collToken).safeTransfer(
            msg.sender,
            defaultClaimProRataShare
        );

        emit ClaimDefaultProceeded(fundingPool);
    }

    function loanTerms() external view returns (DataTypes.LoanTerms memory) {
        return _loanTerms;
    }

    function inUnsubscriptionPhase() external view returns (bool) {
        return inSubscriptionPhase() || status == DataTypes.LoanStatus.ROLLBACK;
    }

    function isReadyToExecute() external view returns (bool) {
        return status == DataTypes.LoanStatus.READY_TO_EXECUTE;
    }

    function inSubscriptionPhase() public view returns (bool) {
        return
            status == DataTypes.LoanStatus.IN_NEGOTIATION ||
            (status == DataTypes.LoanStatus.BORROWER_ACCEPTED &&
                block.timestamp < timeUntilLendersCanUnsubscribe());
    }

    function getAbsoluteLoanTerms(
        DataTypes.LoanTerms memory _tmpLoanTerms,
        uint256 totalSubscribed,
        uint256 loanTokenDecimals
    )
        public
        view
        returns (DataTypes.LoanTerms memory, uint256, uint256, uint256, uint256)
    {
        uint256 _arrangerFee = (arrangerFee * totalSubscribed) / Constants.BASE;
        uint256 _finalLoanAmount = totalSubscribed - _arrangerFee;
        uint256 _finalCollAmountReservedForDefault = (_finalLoanAmount *
            _tmpLoanTerms.collPerLoanToken) / (10 ** loanTokenDecimals);
        // note: convert relative terms into absolute values, i.e.:
        // i) loanTokenDue relative to finalLoanAmount (e.g., 25% of final loan amount),
        // ii) collTokenDueIfConverted relative to loanTokenDue (e.g., convert every
        // 1 loanToken for 8 collToken)
        uint256 _finalCollAmountReservedForConversions;
        for (uint256 i = 0; i < _tmpLoanTerms.repaymentSchedule.length; ) {
            _tmpLoanTerms.repaymentSchedule[i].loanTokenDue = toUint128(
                (_finalLoanAmount *
                    _tmpLoanTerms.repaymentSchedule[i].loanTokenDue) /
                    Constants.BASE
            );
            _tmpLoanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted = toUint128(
                (_tmpLoanTerms.repaymentSchedule[i].loanTokenDue *
                    _tmpLoanTerms
                        .repaymentSchedule[i]
                        .collTokenDueIfConverted) / (10 ** loanTokenDecimals)
            );
            _finalCollAmountReservedForConversions += _tmpLoanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted;
            unchecked {
                i++;
            }
        }
        return (
            _tmpLoanTerms,
            _arrangerFee,
            _finalLoanAmount,
            _finalCollAmountReservedForDefault,
            _finalCollAmountReservedForConversions
        );
    }

    function checkRepaymentIdx(uint256 repaymentIdx) internal view {
        // currentRepaymentIdx == _loanTerms.repaymentSchedule.length on full repay,
        if (repaymentIdx == _loanTerms.repaymentSchedule.length) {
            revert();
        }
    }

    function timeUntilLendersCanUnsubscribe() internal view returns (uint256) {
        return loanTermsLockedTime + lenderGracePeriod;
    }

    function repaymentScheduleCheck(
        DataTypes.Repayment[] calldata repaymentSchedule
    ) internal view {
        if (repaymentSchedule.length == 0) {
            revert Errors.EmptyRepaymentSchedule();
        }
        if (
            repaymentSchedule[0].dueTimestamp <
            block.timestamp + Constants.MIN_TIME_UNTIL_FIRST_DUE_DATE
        ) {
            revert Errors.FirstDueDateTooClose();
        }
        uint256 prevPeriodEnd;
        uint256 currPeriodStart;
        for (uint i = 0; i < repaymentSchedule.length; ) {
            currPeriodStart = repaymentSchedule[i].dueTimestamp;
            if (
                currPeriodStart <= prevPeriodEnd ||
                currPeriodStart - prevPeriodEnd <
                Constants.MIN_TIME_BETWEEN_DUE_DATES
            ) {
                revert Errors.DueDatesTooClose(); // overlapping intervals or too short time between due dates
            }
            if (
                repaymentSchedule[i].conversionGracePeriod <
                Constants.MIN_CONVERSION_GRACE_PERIOD ||
                repaymentSchedule[i].repaymentGracePeriod <
                Constants.MIN_REPAYMENT_GRACE_PERIOD
            ) {
                revert Errors.GracePeriodsTooShort();
            }
            if (repaymentSchedule[i].repaid) {
                revert Errors.InvalidRepaidStatus();
            }
            prevPeriodEnd =
                currPeriodStart +
                repaymentSchedule[i].conversionGracePeriod +
                repaymentSchedule[i].repaymentGracePeriod;
            unchecked {
                i++;
            }
        }
    }

    function getRepaymentCutoffTime(
        uint256 repaymentIdx
    ) internal view returns (uint256 repaymentCutoffTime) {
        repaymentCutoffTime =
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
            _loanTerms.repaymentSchedule[repaymentIdx].conversionGracePeriod +
            _loanTerms.repaymentSchedule[repaymentIdx].repaymentGracePeriod;
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert Errors.OverflowUint128();
        }
    }
}
