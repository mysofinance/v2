// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "../Constants.sol";
import {DataTypesPeerToPool} from "./DataTypesPeerToPool.sol";
import {Errors} from "../Errors.sol";
import {IFactory} from "./interfaces/IFactory.sol";
import {IFundingPoolImpl} from "./interfaces/IFundingPoolImpl.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IMysoTokenManager} from "../interfaces/IMysoTokenManager.sol";

contract LoanProposalImpl is Initializable, ILoanProposalImpl {
    using SafeERC20 for IERC20Metadata;

    mapping(uint256 => uint256) public totalConvertedSubscriptionsPerIdx; // denominated in loan Token
    mapping(uint256 => uint256) public collTokenConverted;
    DataTypesPeerToPool.DynamicLoanProposalData public dynamicData;
    DataTypesPeerToPool.StaticLoanProposalData public staticData;
    uint256 public lastLoanTermsUpdateTime;
    uint256 internal _totalSubscriptionsThatClaimedOnDefault;
    mapping(address => mapping(uint256 => bool))
        internal _lenderExercisedConversion;
    mapping(address => mapping(uint256 => bool))
        internal _lenderClaimedRepayment;
    mapping(address => bool) internal _lenderClaimedCollateralOnDefault;
    DataTypesPeerToPool.LoanTerms internal _loanTerms;
    mapping(uint256 => uint256) internal _loanTokenRepaid;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _factory,
        address _arranger,
        address _fundingPool,
        address _collToken,
        address _whitelistAuthority,
        uint256 _arrangerFee,
        uint256 _unsubscribeGracePeriod,
        uint256 _conversionGracePeriod,
        uint256 _repaymentGracePeriod
    ) external initializer {
        if (_arrangerFee > Constants.MAX_ARRANGER_FEE) {
            revert Errors.InvalidFee();
        }
        if (
            _unsubscribeGracePeriod < Constants.MIN_UNSUBSCRIBE_GRACE_PERIOD ||
            _unsubscribeGracePeriod > Constants.MAX_UNSUBSCRIBE_GRACE_PERIOD ||
            _conversionGracePeriod < Constants.MIN_CONVERSION_GRACE_PERIOD ||
            _repaymentGracePeriod < Constants.MIN_REPAYMENT_GRACE_PERIOD ||
            _conversionGracePeriod + _repaymentGracePeriod >
            Constants.MAX_CONVERSION_AND_REPAYMENT_GRACE_PERIOD
        ) {
            revert Errors.InvalidGracePeriod();
        }
        staticData.factory = _factory;
        staticData.fundingPool = _fundingPool;
        staticData.collToken = _collToken;
        staticData.arranger = _arranger;
        if (_whitelistAuthority != address(0)) {
            staticData.whitelistAuthority = _whitelistAuthority;
        }
        staticData.unsubscribeGracePeriod = _unsubscribeGracePeriod;
        staticData.conversionGracePeriod = _conversionGracePeriod;
        staticData.repaymentGracePeriod = _repaymentGracePeriod;
        dynamicData.arrangerFee = _arrangerFee;
        dynamicData.protocolFee = IFactory(_factory).protocolFee();
    }

    function proposeLoanTerms(
        DataTypesPeerToPool.LoanTerms calldata newLoanTerms
    ) external {
        if (msg.sender != staticData.arranger) {
            revert Errors.InvalidSender();
        }
        DataTypesPeerToPool.LoanStatus status = dynamicData.status;
        if (
            status != DataTypesPeerToPool.LoanStatus.WITHOUT_LOAN_TERMS &&
            status != DataTypesPeerToPool.LoanStatus.IN_NEGOTIATION
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        if (
            block.timestamp <
            lastLoanTermsUpdateTime +
                Constants.LOAN_TERMS_UPDATE_COOL_OFF_PERIOD
        ) {
            revert Errors.WaitForLoanTermsCoolOffPeriod();
        }
        if (
            newLoanTerms.minTotalSubscriptions == 0 ||
            newLoanTerms.minTotalSubscriptions >
            newLoanTerms.maxTotalSubscriptions
        ) {
            revert Errors.InvalidSubscriptionRange();
        }
        address fundingPool = staticData.fundingPool;
        _repaymentScheduleCheck(
            newLoanTerms.minTotalSubscriptions,
            newLoanTerms.repaymentSchedule
        );
        uint256 totalSubscriptions = IFundingPoolImpl(fundingPool)
            .totalSubscriptions(address(this));
        if (totalSubscriptions > newLoanTerms.maxTotalSubscriptions) {
            revert Errors.InvalidMaxTotalSubscriptions();
        }
        _loanTerms = newLoanTerms;
        if (status != DataTypesPeerToPool.LoanStatus.IN_NEGOTIATION) {
            dynamicData.status = DataTypesPeerToPool.LoanStatus.IN_NEGOTIATION;
        }
        lastLoanTermsUpdateTime = block.timestamp;
        emit LoanTermsProposed(newLoanTerms);
    }

    function lockLoanTerms(uint256 _loanTermsUpdateTime) external {
        if (
            msg.sender != staticData.arranger &&
            msg.sender != _loanTerms.borrower
        ) {
            revert Errors.InvalidSender();
        }
        if (
            dynamicData.status != DataTypesPeerToPool.LoanStatus.IN_NEGOTIATION
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 currLastLoanTermsUpdateTime = lastLoanTermsUpdateTime;
        if (
            block.timestamp <
            currLastLoanTermsUpdateTime +
                Constants.LOAN_TERMS_UPDATE_COOL_OFF_PERIOD
        ) {
            revert Errors.WaitForLoanTermsCoolOffPeriod();
        }
        // once cool off period has passed, check if "remaining" time until
        // first due date is "sufficiently" far enough in the future
        if (
            _loanTerms.repaymentSchedule[0].dueTimestamp <
            block.timestamp +
                staticData.unsubscribeGracePeriod +
                Constants.LOAN_EXECUTION_GRACE_PERIOD +
                Constants.MIN_TIME_UNTIL_FIRST_DUE_DATE
        ) {
            revert Errors.FirstDueDateTooCloseOrPassed();
        }
        if (_loanTermsUpdateTime != currLastLoanTermsUpdateTime) {
            revert Errors.InconsistentLastLoanTermsUpdateTime();
        }
        dynamicData.loanTermsLockedTime = block.timestamp;
        dynamicData.status = DataTypesPeerToPool.LoanStatus.LOAN_TERMS_LOCKED;

        emit LoanTermsLocked();
    }

    function finalizeLoanTermsAndTransferColl(
        uint256 expectedTransferFee
    ) external {
        DataTypesPeerToPool.LoanTerms memory _unfinalizedLoanTerms = _loanTerms;
        if (msg.sender != _unfinalizedLoanTerms.borrower) {
            revert Errors.InvalidSender();
        }
        // revert if loan terms are locked or lender cutoff time hasn't passed yet
        if (
            dynamicData.status !=
            DataTypesPeerToPool.LoanStatus.LOAN_TERMS_LOCKED ||
            block.timestamp < _lenderInOrOutCutoffTime()
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        address fundingPool = staticData.fundingPool;
        uint256 totalSubscriptions = IFundingPoolImpl(fundingPool)
            .totalSubscriptions(address(this));
        if (totalSubscriptions < _unfinalizedLoanTerms.minTotalSubscriptions) {
            revert Errors.FellShortOfTotalSubscriptionTarget();
        }
        if (
            _unfinalizedLoanTerms.repaymentSchedule[0].dueTimestamp <=
            block.timestamp + Constants.MIN_TIME_UNTIL_FIRST_DUE_DATE
        ) {
            revert Errors.FirstDueDateTooCloseOrPassed();
        }
        dynamicData.status = DataTypesPeerToPool.LoanStatus.READY_TO_EXECUTE;
        // note: now that final subscription amounts are known, convert relative values
        // to absolute, i.e.:
        // i) loanTokenDue from relative (e.g., 25% of final loan amount) to absolute (e.g., 25 USDC),
        // ii) collTokenDueIfConverted from relative (e.g., convert every
        // 1 loanToken for 8 collToken) to absolute (e.g., 200 collToken)
        (
            DataTypesPeerToPool.LoanTerms memory _finalizedLoanTerms,
            uint256 _arrangerFee,
            uint256 _finalCollAmountReservedForDefault,
            uint256 _finalCollAmountReservedForConversions,
            uint256 _protocolFee
        ) = getAbsoluteLoanTerms(
                _unfinalizedLoanTerms,
                totalSubscriptions,
                IERC20Metadata(IFundingPoolImpl(fundingPool).depositToken())
                    .decimals()
            );
        for (uint256 i; i < _finalizedLoanTerms.repaymentSchedule.length; ) {
            _loanTerms.repaymentSchedule[i].loanTokenDue = _finalizedLoanTerms
                .repaymentSchedule[i]
                .loanTokenDue;
            _loanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted = _finalizedLoanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted;
            unchecked {
                ++i;
            }
        }
        dynamicData.arrangerFee = _arrangerFee;
        dynamicData.protocolFee = _protocolFee;
        dynamicData.grossLoanAmount = totalSubscriptions;
        dynamicData
            .finalCollAmountReservedForDefault = _finalCollAmountReservedForDefault;
        dynamicData
            .finalCollAmountReservedForConversions = _finalCollAmountReservedForConversions;
        address mysoTokenManager = IFactory(staticData.factory)
            .mysoTokenManager();
        if (mysoTokenManager != address(0)) {
            IMysoTokenManager(mysoTokenManager).processP2PoolLoanFinalization(
                address(this),
                fundingPool,
                staticData.collToken,
                staticData.arranger,
                msg.sender,
                totalSubscriptions,
                _finalCollAmountReservedForDefault,
                _finalCollAmountReservedForConversions
            );
        }

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
            IERC20Metadata(collToken).balanceOf(address(this)) !=
            preBal +
                _finalCollAmountReservedForDefault +
                _finalCollAmountReservedForConversions
        ) {
            revert Errors.InvalidSendAmount();
        }

        emit LoanTermsAndTransferCollFinalized(
            totalSubscriptions,
            _finalCollAmountReservedForDefault,
            _finalCollAmountReservedForConversions,
            _arrangerFee,
            _protocolFee
        );
    }

    function rollback() external {
        // cannot be called anymore once lockInFinalAmountsAndProvideCollateral() called
        if (
            dynamicData.status !=
            DataTypesPeerToPool.LoanStatus.LOAN_TERMS_LOCKED
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 totalSubscriptions = IFundingPoolImpl(staticData.fundingPool)
            .totalSubscriptions(address(this));
        uint256 lenderInOrOutCutoffTime = _lenderInOrOutCutoffTime();
        if (
            msg.sender == _loanTerms.borrower ||
            msg.sender == staticData.arranger ||
            (block.timestamp >= lenderInOrOutCutoffTime &&
                totalSubscriptions < _loanTerms.minTotalSubscriptions) ||
            (block.timestamp >=
                lenderInOrOutCutoffTime + Constants.LOAN_EXECUTION_GRACE_PERIOD)
        ) {
            dynamicData.status = DataTypesPeerToPool.LoanStatus.ROLLBACK;
        } else {
            revert Errors.InvalidRollBackRequest();
        }

        emit Rolledback();
    }

    function checkAndUpdateStatus() external {
        if (msg.sender != staticData.fundingPool) {
            revert Errors.InvalidSender();
        }
        if (
            dynamicData.status !=
            DataTypesPeerToPool.LoanStatus.READY_TO_EXECUTE
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        dynamicData.status = DataTypesPeerToPool.LoanStatus.LOAN_DEPLOYED;

        emit LoanDeployed();
    }

    function exerciseConversion() external {
        address fundingPool = staticData.fundingPool;
        uint256 lenderContribution = IFundingPoolImpl(fundingPool)
            .subscriptionAmountOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        if (
            dynamicData.status != DataTypesPeerToPool.LoanStatus.LOAN_DEPLOYED
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = dynamicData.currentRepaymentIdx;
        _checkCurrRepaymentIdx(repaymentIdx);
        mapping(uint256 => bool)
            storage lenderExercisedConversionPerRepaymentIdx = _lenderExercisedConversion[
                msg.sender
            ];
        if (lenderExercisedConversionPerRepaymentIdx[repaymentIdx]) {
            revert Errors.AlreadyConverted();
        }
        // must be after when the period of this loan is due, but before borrower can repay
        // note: conversion can be done if blocktime is in the half-open interval of:
        // [dueTimestamp, dueTimestamp + conversionGracePeriod)
        DataTypesPeerToPool.Repayment memory _repayment = _loanTerms
            .repaymentSchedule[repaymentIdx];
        if (
            block.timestamp < _repayment.dueTimestamp ||
            block.timestamp >=
            _repayment.dueTimestamp + staticData.conversionGracePeriod
        ) {
            revert Errors.OutsideConversionTimeWindow();
        }
        uint256 totalConvertedSubscriptions = totalConvertedSubscriptionsPerIdx[
            repaymentIdx
        ];
        uint256 conversionAmount;
        if (
            dynamicData.grossLoanAmount ==
            totalConvertedSubscriptions + lenderContribution
        ) {
            // case where "last lender" converts then provide remaining amount to mitigate potential rounding errors
            conversionAmount =
                _repayment.collTokenDueIfConverted -
                collTokenConverted[repaymentIdx];
        } else {
            // in all other cases, distribute collateral token on pro rata basis
            conversionAmount =
                (_repayment.collTokenDueIfConverted * lenderContribution) /
                dynamicData.grossLoanAmount;
        }
        if (conversionAmount == 0) {
            revert Errors.ZeroConversionAmount();
        }
        collTokenConverted[repaymentIdx] += conversionAmount;
        totalConvertedSubscriptionsPerIdx[repaymentIdx] += lenderContribution;
        lenderExercisedConversionPerRepaymentIdx[repaymentIdx] = true;
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
        if (
            dynamicData.status != DataTypesPeerToPool.LoanStatus.LOAN_DEPLOYED
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = dynamicData.currentRepaymentIdx++;
        _checkCurrRepaymentIdx(repaymentIdx);
        // must be after when the period of this loan when lenders can convert,
        // but before default period for this period
        // note: repayment can be done in the half-open interval of:
        // [dueTimestamp + conversionGracePeriod, dueTimestamp + conversionGracePeriod + repaymentGracePeriod)
        DataTypesPeerToPool.Repayment memory _repayment = _loanTerms
            .repaymentSchedule[repaymentIdx];
        uint256 currConversionCutoffTime = _repayment.dueTimestamp +
            staticData.conversionGracePeriod;
        uint256 currRepaymentCutoffTime = currConversionCutoffTime +
            staticData.repaymentGracePeriod;
        if (
            (block.timestamp < currConversionCutoffTime) ||
            (block.timestamp >= currRepaymentCutoffTime)
        ) {
            revert Errors.OutsideRepaymentTimeWindow();
        }
        address fundingPool = staticData.fundingPool;
        address loanToken = IFundingPoolImpl(fundingPool).depositToken();
        uint256 collTokenLeftUnconverted = _repayment.collTokenDueIfConverted -
            collTokenConverted[repaymentIdx];
        uint256 remainingLoanTokenDue = (_repayment.loanTokenDue *
            collTokenLeftUnconverted) / _repayment.collTokenDueIfConverted;
        _loanTokenRepaid[repaymentIdx] = remainingLoanTokenDue;
        uint256 preBal = IERC20Metadata(loanToken).balanceOf(address(this));
        IERC20Metadata(loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            remainingLoanTokenDue + expectedTransferFee
        );
        if (
            IERC20Metadata(loanToken).balanceOf(address(this)) !=
            remainingLoanTokenDue + preBal
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

        emit Repaid(remainingLoanTokenDue, collSendAmount);
    }

    function claimRepayment(uint256 repaymentIdx) external {
        address fundingPool = staticData.fundingPool;
        uint256 lenderContribution = IFundingPoolImpl(fundingPool)
            .subscriptionAmountOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        // the currentRepaymentIdx (initially 0) only ever gets incremented on repay;
        // hence any `repaymentIdx` smaller than `currentRepaymentIdx` will always
        // map to a valid repayment claim
        if (repaymentIdx >= dynamicData.currentRepaymentIdx) {
            revert Errors.RepaymentIdxTooLarge();
        }
        DataTypesPeerToPool.LoanStatus status = dynamicData.status;
        if (
            status != DataTypesPeerToPool.LoanStatus.LOAN_DEPLOYED &&
            status != DataTypesPeerToPool.LoanStatus.DEFAULTED
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        // note: users can claim as soon as repaid, no need to check _getRepaymentCutoffTime(...)
        mapping(uint256 => bool)
            storage lenderClaimedRepaymentPerRepaymentIdx = _lenderClaimedRepayment[
                msg.sender
            ];
        if (
            lenderClaimedRepaymentPerRepaymentIdx[repaymentIdx] ||
            _lenderExercisedConversion[msg.sender][repaymentIdx]
        ) {
            revert Errors.AlreadyClaimed();
        }
        // repaid amount for that period split over those who didn't convert in that period
        uint256 subscriptionsEntitledToRepayment = dynamicData.grossLoanAmount -
            totalConvertedSubscriptionsPerIdx[repaymentIdx];
        uint256 claimAmount = (_loanTokenRepaid[repaymentIdx] *
            lenderContribution) / subscriptionsEntitledToRepayment;
        lenderClaimedRepaymentPerRepaymentIdx[repaymentIdx] = true;
        IERC20Metadata(IFundingPoolImpl(fundingPool).depositToken())
            .safeTransfer(msg.sender, claimAmount);

        emit RepaymentClaimed(msg.sender, claimAmount);
    }

    function markAsDefaulted() external {
        if (
            dynamicData.status != DataTypesPeerToPool.LoanStatus.LOAN_DEPLOYED
        ) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        uint256 repaymentIdx = dynamicData.currentRepaymentIdx;
        // this will check if loan has been fully repaid yet in this instance
        // note: loan can be marked as defaulted if no repayment and blocktime is in half-open interval of:
        // [dueTimestamp + conversionGracePeriod + repaymentGracePeriod, infty)
        _checkCurrRepaymentIdx(repaymentIdx);
        if (block.timestamp < _getRepaymentCutoffTime(repaymentIdx)) {
            revert Errors.NoDefault();
        }
        dynamicData.status = DataTypesPeerToPool.LoanStatus.DEFAULTED;
        emit LoanDefaulted();
    }

    function claimDefaultProceeds() external {
        if (dynamicData.status != DataTypesPeerToPool.LoanStatus.DEFAULTED) {
            revert Errors.InvalidActionForCurrentStatus();
        }
        address fundingPool = staticData.fundingPool;
        uint256 lenderContribution = IFundingPoolImpl(fundingPool)
            .subscriptionAmountOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert Errors.InvalidSender();
        }
        if (_lenderClaimedCollateralOnDefault[msg.sender]) {
            revert Errors.AlreadyClaimed();
        }
        uint256 lastPeriodIdx = dynamicData.currentRepaymentIdx;
        address collToken = staticData.collToken;
        uint256 totalSubscriptions = dynamicData.grossLoanAmount;
        uint256 stillToBeConvertedCollTokens = _loanTerms
            .repaymentSchedule[lastPeriodIdx]
            .collTokenDueIfConverted - collTokenConverted[lastPeriodIdx];

        // if only some lenders converted, then split 'stillToBeConvertedCollTokens'
        // fairly among lenders who didn't already convert in default period to not
        // put them at an unfair disadvantage
        uint256 totalUnconvertedSubscriptionsFromLastIdx = totalSubscriptions -
            totalConvertedSubscriptionsPerIdx[lastPeriodIdx];
        uint256 totalCollTokenClaim;
        if (!_lenderExercisedConversion[msg.sender][lastPeriodIdx]) {
            totalCollTokenClaim =
                (stillToBeConvertedCollTokens * lenderContribution) /
                totalUnconvertedSubscriptionsFromLastIdx;
            collTokenConverted[lastPeriodIdx] += totalCollTokenClaim;
            totalConvertedSubscriptionsPerIdx[
                lastPeriodIdx
            ] += lenderContribution;
            _lenderExercisedConversion[msg.sender][lastPeriodIdx] = true;
        }
        // determine pro-rata share on remaining non-conversion related collToken balance
        totalCollTokenClaim +=
            ((IERC20Metadata(collToken).balanceOf(address(this)) -
                stillToBeConvertedCollTokens) * lenderContribution) /
            (totalSubscriptions - _totalSubscriptionsThatClaimedOnDefault);
        if (totalCollTokenClaim == 0) {
            revert Errors.AlreadyClaimed();
        }
        _lenderClaimedCollateralOnDefault[msg.sender] = true;
        _totalSubscriptionsThatClaimedOnDefault += lenderContribution;
        IERC20Metadata(collToken).safeTransfer(msg.sender, totalCollTokenClaim);

        emit DefaultProceedsClaimed(msg.sender);
    }

    function loanTerms()
        external
        view
        returns (DataTypesPeerToPool.LoanTerms memory)
    {
        return _loanTerms;
    }

    function canUnsubscribe() external view returns (bool) {
        return
            canSubscribe() ||
            dynamicData.status == DataTypesPeerToPool.LoanStatus.ROLLBACK;
    }

    function canSubscribe() public view returns (bool) {
        DataTypesPeerToPool.LoanStatus status = dynamicData.status;
        return (status == DataTypesPeerToPool.LoanStatus.IN_NEGOTIATION ||
            (status == DataTypesPeerToPool.LoanStatus.LOAN_TERMS_LOCKED &&
                block.timestamp < _lenderInOrOutCutoffTime()));
    }

    function getAbsoluteLoanTerms(
        DataTypesPeerToPool.LoanTerms memory _tmpLoanTerms,
        uint256 totalSubscriptions,
        uint256 loanTokenDecimals
    )
        public
        view
        returns (
            DataTypesPeerToPool.LoanTerms memory,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        uint256 _arrangerFee = (dynamicData.arrangerFee * totalSubscriptions) /
            Constants.BASE;
        uint256 _protocolFee = (dynamicData.protocolFee * totalSubscriptions) /
            Constants.BASE;
        uint256 _finalCollAmountReservedForDefault = (totalSubscriptions *
            _tmpLoanTerms.collPerLoanToken) / (10 ** loanTokenDecimals);
        // note: convert relative terms into absolute values, i.e.:
        // i) loanTokenDue relative to grossLoanAmount (e.g., 25% of final loan amount),
        // ii) collTokenDueIfConverted relative to loanTokenDue (e.g., convert every
        // 1 loanToken for 8 collToken)
        uint256 _finalCollAmountReservedForConversions;
        for (uint256 i; i < _tmpLoanTerms.repaymentSchedule.length; ) {
            _tmpLoanTerms.repaymentSchedule[i].loanTokenDue = SafeCast
                .toUint128(
                    (totalSubscriptions *
                        _tmpLoanTerms.repaymentSchedule[i].loanTokenDue) /
                        Constants.BASE
                );
            _tmpLoanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted = SafeCast.toUint128(
                (_tmpLoanTerms.repaymentSchedule[i].loanTokenDue *
                    _tmpLoanTerms
                        .repaymentSchedule[i]
                        .collTokenDueIfConverted) / (10 ** loanTokenDecimals)
            );
            _finalCollAmountReservedForConversions += _tmpLoanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted;
            unchecked {
                ++i;
            }
        }
        return (
            _tmpLoanTerms,
            _arrangerFee,
            _finalCollAmountReservedForDefault,
            _finalCollAmountReservedForConversions,
            _protocolFee
        );
    }

    function _checkCurrRepaymentIdx(uint256 repaymentIdx) internal view {
        // currentRepaymentIdx increments on every repay;
        // if and only if loan was fully repaid, then currentRepaymentIdx == _loanTerms.repaymentSchedule.length
        if (repaymentIdx == _loanTerms.repaymentSchedule.length) {
            revert Errors.LoanIsFullyRepaid();
        }
    }

    function _lenderInOrOutCutoffTime() internal view returns (uint256) {
        return
            dynamicData.loanTermsLockedTime + staticData.unsubscribeGracePeriod;
    }

    function _repaymentScheduleCheck(
        uint256 minTotalSubscriptions,
        DataTypesPeerToPool.Repayment[] memory repaymentSchedule
    ) internal view {
        if (repaymentSchedule.length == 0) {
            revert Errors.EmptyRepaymentSchedule();
        }
        // assuming loan terms are directly locked, then loan can get executed earliest after:
        // block.timestamp + Constants.LOAN_TERMS_UPDATE_COOL_OFF_PERIOD + Constants.LOAN_EXECUTION_GRACE_PERIOD
        if (
            repaymentSchedule[0].dueTimestamp <
            block.timestamp +
                Constants.LOAN_TERMS_UPDATE_COOL_OFF_PERIOD +
                staticData.unsubscribeGracePeriod +
                Constants.LOAN_EXECUTION_GRACE_PERIOD +
                Constants.MIN_TIME_UNTIL_FIRST_DUE_DATE
        ) {
            revert Errors.FirstDueDateTooCloseOrPassed();
        }
        uint256 prevDueDate;
        uint256 currDueDate;
        for (uint256 i; i < repaymentSchedule.length; ) {
            if (
                SafeCast.toUint128(
                    (repaymentSchedule[i].loanTokenDue *
                        minTotalSubscriptions) / Constants.BASE
                ) == 0
            ) {
                revert Errors.LoanTokenDueIsZero();
            }
            currDueDate = repaymentSchedule[i].dueTimestamp;
            if (
                currDueDate < prevDueDate + Constants.MIN_TIME_BETWEEN_DUE_DATES
            ) {
                revert Errors.InvalidDueDates();
            }
            prevDueDate = currDueDate;
            unchecked {
                ++i;
            }
        }
    }

    function _getRepaymentCutoffTime(
        uint256 repaymentIdx
    ) internal view returns (uint256 repaymentCutoffTime) {
        repaymentCutoffTime =
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
            staticData.conversionGracePeriod +
            staticData.repaymentGracePeriod;
    }
}
