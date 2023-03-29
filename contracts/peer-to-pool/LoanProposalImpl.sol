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

    mapping(uint256 => uint256) public totalConvertedSubscriptionsPerIdx; // denominated in loan Token
    mapping(uint256 => uint256) public collTokenConverted;
    DataTypes.DynamicLoanProposalData public dynamicData;
    DataTypes.StaticLoanProposalData public staticData;
    uint256 internal lastLoanTermsUpdateTime;
    uint256 internal totalSubscriptionsThatClaimedOnDefault;
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
        if (_fundingPool == address(0) || _collToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (
            _arrangerFee < Constants.MIN_ARRANGER_FEE ||
            _arrangerFee > Constants.MAX_ARRANGER_FEE
        ) {
            revert Errors.InvalidFee();
        }
        if (
            _lenderGracePeriod < Constants.MIN_LENDER_UNSUBSCRIBE_GRACE_PERIOD
        ) {
            revert Errors.UnsubscribeGracePeriodTooShort();
        }
        staticData.fundingPool = _fundingPool;
        staticData.collToken = _collToken;
        staticData.arranger = _arranger;
        staticData.lenderGracePeriod = _lenderGracePeriod;
        dynamicData.arrangerFee = _arrangerFee;
    }

    function proposeLoanTerms(
        DataTypes.LoanTerms calldata newLoanTerms
    ) external {
        if (msg.sender != staticData.arranger) {
            revert Errors.InvalidSender();
        }
        DataTypes.LoanStatus status = dynamicData.status;
        if (
            status != DataTypes.LoanStatus.WITHOUT_LOAN_TERMS &&
            status != DataTypes.LoanStatus.IN_NEGOTIATION
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        if (
            block.timestamp - lastLoanTermsUpdateTime <
            Constants.LOAN_TERMS_UPDATE_COOL_OFF_PERIOD
        ) {
            revert Errors.WaitForLoanTermsCoolOffPeriod();
        }
        address fundingPool = staticData.fundingPool;
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
        dynamicData.status = DataTypes.LoanStatus.IN_NEGOTIATION;
        lastLoanTermsUpdateTime = block.timestamp;

        emit LoanTermsProposed(newLoanTerms);
    }

    function acceptLoanTerms() external {
        if (msg.sender != _loanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        if (dynamicData.status != DataTypes.LoanStatus.IN_NEGOTIATION) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        if (
            block.timestamp - lastLoanTermsUpdateTime <
            Constants.LOAN_TERMS_UPDATE_COOL_OFF_PERIOD
        ) {
            revert Errors.WaitForLoanTermsCoolOffPeriod();
        }
        address fundingPool = staticData.fundingPool;
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        // check if enough subscriptions
        // note: no need to check if subscriptions are > maxLoanAmount as
        // this is already done in funding pool
        if (totalSubscribed < _loanTerms.minLoanAmount) {
            revert Errors.TotalSubscribedTooLow();
        }
        dynamicData.loanTermsLockedTime = block.timestamp;
        dynamicData.status = DataTypes.LoanStatus.BORROWER_ACCEPTED;

        emit LoanTermsAccepted();
    }

    function finalizeLoanTermsAndTransferColl(
        uint256 expectedTransferFee
    ) external {
        DataTypes.LoanTerms memory _unfinalizedLoanTerms = _loanTerms;
        if (msg.sender != _unfinalizedLoanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        if (
            dynamicData.status != DataTypes.LoanStatus.BORROWER_ACCEPTED ||
            block.timestamp < timeUntilLendersCanUnsubscribe()
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        address fundingPool = staticData.fundingPool;
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
        dynamicData.status = DataTypes.LoanStatus.READY_TO_EXECUTE;
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
        dynamicData.arrangerFee = _arrangerFee;
        dynamicData.finalLoanAmount = _finalLoanAmount;
        dynamicData
            .finalCollAmountReservedForDefault = _finalCollAmountReservedForDefault;
        dynamicData
            .finalCollAmountReservedForConversions = _finalCollAmountReservedForConversions;
        // note: final collToken amount that borrower needs to transfer is sum of:
        // 1) amount reserved for lenders in case of default, and
        // 2) amount reserved for lenders in case all convert
        address collToken = staticData.collToken;
        uint256 preBal = IERC20Metadata(collToken).balanceOf(address(this));
        IERC20Metadata(collToken).safeTransferFrom(
            msg.sender,
            address(this),
            _finalCollAmountReservedForDefault +
                _finalCollAmountReservedForConversions +
                expectedTransferFee
        );
        if (
            IERC20Metadata(collToken).balanceOf(address(this)) - preBal !=
            _finalCollAmountReservedForDefault +
                _finalCollAmountReservedForConversions
        ) {
            revert Errors.InvalidSendAmount();
        }

        emit LoanTermsAndTransferCollFinalized(
            _finalLoanAmount,
            _finalCollAmountReservedForDefault,
            _finalCollAmountReservedForConversions,
            _arrangerFee
        );
    }

    function rollback() external {
        // cannot be called anymore once lockInFinalAmountsAndProvideCollateral() called
        if (dynamicData.status != DataTypes.LoanStatus.BORROWER_ACCEPTED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 totalSubscribed = IFundingPool(staticData.fundingPool)
            .totalSubscribed(address(this));
        uint256 _timeUntilLendersCanUnsubscribe = timeUntilLendersCanUnsubscribe();
        if (
            (msg.sender == _loanTerms.borrower &&
                block.timestamp < _timeUntilLendersCanUnsubscribe) ||
            (block.timestamp >= _timeUntilLendersCanUnsubscribe &&
                totalSubscribed < _loanTerms.minLoanAmount)
        ) {
            dynamicData.status = DataTypes.LoanStatus.ROLLBACK;
            address collToken = staticData.collToken;
            // transfer any previously provided collToken back to borrower
            IERC20Metadata(collToken).safeTransfer(
                _loanTerms.borrower,
                IERC20Metadata(collToken).balanceOf(address(this))
            );
        } else {
            revert Errors.InvalidRollBackRequest();
        }

        emit Rollback();
    }

    function checkAndupdateStatus() external {
        address fundingPool = staticData.fundingPool;
        if (msg.sender != fundingPool) {
            revert Errors.InvalidSender();
        }
        if (dynamicData.status != DataTypes.LoanStatus.READY_TO_EXECUTE) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        dynamicData.status = DataTypes.LoanStatus.LOAN_DEPLOYED;

        emit LoanDeployed();
    }

    function exerciseConversion() external {
        address fundingPool = staticData.fundingPool;
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        if (dynamicData.status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = dynamicData.currentRepaymentIdx;
        checkCurrRepaymentIdx(repaymentIdx);
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert Errors.AlreadyConverted();
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
        IERC20Metadata(staticData.collToken).safeTransfer(
            msg.sender,
            conversionAmount
        );

        emit ConversionExercised(msg.sender, repaymentIdx, conversionAmount);
    }

    function repay(uint256 expectedTransferFee) external {
        if (msg.sender != _loanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        if (dynamicData.status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = dynamicData.currentRepaymentIdx++;
        checkCurrRepaymentIdx(repaymentIdx);
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
        address fundingPool = staticData.fundingPool;
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
        if (
            IERC20Metadata(loanToken).balanceOf(address(this)) - preBal !=
            remainingLoanTokenDue
        ) {
            revert Errors.InvalidSendAmount();
        }
        // if final repayment, send all remaining coll token back to borrower
        // else send only unconverted coll token back to borrower
        address collToken = staticData.collToken;
        uint256 collSendAmount = _loanTerms.repaymentSchedule.length - 1 ==
            repaymentIdx
            ? IERC20Metadata(collToken).balanceOf(address(this))
            : collTokenLeftUnconverted;
        IERC20Metadata(collToken).safeTransfer(msg.sender, collSendAmount);

        emit Repay(remainingLoanTokenDue, collSendAmount);
    }

    function claimRepayment(uint256 repaymentIdx) external {
        address fundingPool = staticData.fundingPool;
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        // iff there's a repay, currentRepaymentIdx (initially 0) gets incremented;
        // hence any `repaymentIdx` smaller than `currentRepaymentIdx` will always
        // map to a valid repayment claim; no need to check `repaymentSchedule[repaymentIdx].repaid`
        if (repaymentIdx >= dynamicData.currentRepaymentIdx) {
            revert Errors.RepaymentIdxTooLarge();
        }
        // note: users can claim as soon as repaid, no need to check getRepaymentCutoffTime(...)
        if (
            lenderClaimedRepayment[msg.sender][repaymentIdx] ||
            lenderExercisedConversion[msg.sender][repaymentIdx]
        ) {
            revert Errors.AlreadyClaimed();
        }
        // repaid amount for that period split over those who didn't convert in that period
        uint256 subscriptionsEntitledToRepayment = (IFundingPool(fundingPool)
            .totalSubscribed(address(this)) -
            totalConvertedSubscriptionsPerIdx[repaymentIdx]);
        uint256 claimAmount = (loanTokenRepaid[repaymentIdx] *
            lenderContribution) / subscriptionsEntitledToRepayment;
        lenderClaimedRepayment[msg.sender][repaymentIdx] = true;
        IERC20Metadata(IFundingPool(fundingPool).depositToken()).safeTransfer(
            msg.sender,
            claimAmount
        );

        emit ClaimRepayment(msg.sender, claimAmount);
    }

    function markAsDefaulted() external {
        if (dynamicData.status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = dynamicData.currentRepaymentIdx;
        // this will check if loan has been fully repaid yet in this instance
        checkCurrRepaymentIdx(repaymentIdx);
        if (block.timestamp <= getRepaymentCutoffTime(repaymentIdx)) {
            revert Errors.NoDefault();
        }
        dynamicData.status = DataTypes.LoanStatus.DEFAULTED;
        emit LoanDefaulted();
    }

    function claimDefaultProceeds() external {
        if (dynamicData.status != DataTypes.LoanStatus.DEFAULTED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        address fundingPool = staticData.fundingPool;
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        if (lenderClaimedCollateralOnDefault[msg.sender]) {
            revert Errors.AlreadyClaimed();
        }
        uint256 lastPeriodIdx = dynamicData.currentRepaymentIdx;
        address collToken = staticData.collToken;
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        uint256 stillToBeConvertedCollTokens = _loanTerms
            .repaymentSchedule[lastPeriodIdx]
            .collTokenDueIfConverted - collTokenConverted[lastPeriodIdx];

        // if only some lenders converted, then split 'stillToBeConvertedCollTokens'
        // fairly among lenders who didn't already convert in default period to not
        // put them at an unfair disadvantage
        uint256 totalUnconvertedSubscriptionsFromLastIdx = totalSubscribed -
            totalConvertedSubscriptionsPerIdx[lastPeriodIdx];
        uint256 totalCollTokenClaim;
        if (!lenderExercisedConversion[msg.sender][lastPeriodIdx]) {
            totalCollTokenClaim =
                (stillToBeConvertedCollTokens * lenderContribution) /
                totalUnconvertedSubscriptionsFromLastIdx;
            collTokenConverted[lastPeriodIdx] += totalCollTokenClaim;
            totalConvertedSubscriptionsPerIdx[
                lastPeriodIdx
            ] += lenderContribution;
        }
        // determine pro-rata share on remaining non-conversion related collToken balance
        totalCollTokenClaim +=
            ((IERC20Metadata(collToken).balanceOf(address(this)) -
                stillToBeConvertedCollTokens) * lenderContribution) /
            (totalSubscribed - totalSubscriptionsThatClaimedOnDefault);
        lenderClaimedCollateralOnDefault[msg.sender] = true;
        totalSubscriptionsThatClaimedOnDefault += lenderContribution;

        IERC20Metadata(collToken).safeTransfer(msg.sender, totalCollTokenClaim);

        emit DefaultProceedsClaimed(msg.sender);
    }

    function loanTerms() external view returns (DataTypes.LoanTerms memory) {
        return _loanTerms;
    }

    function canUnsubscribe() external view returns (bool) {
        return
            canSubscribe() ||
            dynamicData.status == DataTypes.LoanStatus.ROLLBACK;
    }

    function canSubscribe() public view returns (bool) {
        return
            (dynamicData.status != DataTypes.LoanStatus.WITHOUT_LOAN_TERMS &&
                dynamicData.loanTermsLockedTime == 0) ||
            block.timestamp < timeUntilLendersCanUnsubscribe();
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
        uint256 _arrangerFee = (dynamicData.arrangerFee * totalSubscribed) /
            Constants.BASE;
        uint256 _finalLoanAmount = toUint128(totalSubscribed - _arrangerFee);
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

    function checkCurrRepaymentIdx(uint256 repaymentIdx) internal view {
        // currentRepaymentIdx increments on every repay; iff full repay then currentRepaymentIdx == _loanTerms.repaymentSchedule.length
        if (repaymentIdx == _loanTerms.repaymentSchedule.length) {
            revert Errors.LoanIsFullyRepaid();
        }
    }

    function timeUntilLendersCanUnsubscribe() internal view returns (uint256) {
        return dynamicData.loanTermsLockedTime + staticData.lenderGracePeriod;
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
                (currPeriodStart <= prevPeriodEnd ||
                    currPeriodStart - prevPeriodEnd <
                    Constants.MIN_TIME_BETWEEN_DUE_DATES) ||
                (repaymentSchedule[i].conversionGracePeriod <
                    Constants.MIN_CONVERSION_GRACE_PERIOD ||
                    repaymentSchedule[i].repaymentGracePeriod <
                    Constants.MIN_REPAYMENT_GRACE_PERIOD) ||
                repaymentSchedule[i].repaid
            ) {
                revert Errors.InvalidRepaymentSchedule();
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
