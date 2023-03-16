// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ILoanProposalImpl} from "./interfaces/ILoanProposalImpl.sol";
import {IFundingPool} from "./interfaces/IFundingPool.sol";
import {Constants} from "../Constants.sol";
import {DataTypes} from "./DataTypes.sol";

contract LoanProposalImpl is Initializable, ILoanProposalImpl {
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
    mapping(address => mapping(uint256 => bool))
        public lenderExercisedConversion;
    mapping(address => mapping(uint256 => bool)) public lenderClaimedRepayment;
    mapping(address => bool) public lenderClaimedCollateralOnDefault;
    DataTypes.LoanTerms internal _loanTerms;
    mapping(uint256 => uint256) internal loanTokenRepaid;
    mapping(uint256 => uint256) internal collTokenConverted;
    mapping(uint256 => uint256) internal totalConvertedSubscriptionsPerIdx; // denominated in loan Token

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
        if (_fundingPool == address(0)) {
            revert();
        }
        if (_collToken == address(0)) {
            revert();
        }
        if (_arranger == address(0)) {
            revert();
        }
        if (_arrangerFee == 0) {
            revert();
        }
        if (
            _lenderGracePeriod < Constants.MIN_LENDER_UNSUBSCRIBE_GRACE_PERIOD
        ) {
            revert();
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
            revert();
        }
        if (status != DataTypes.LoanStatus.IN_NEGOTIATION) {
            revert();
        }
        repaymentScheduleCheck(newLoanTerms.repaymentSchedule);
        _loanTerms = newLoanTerms;
    }

    function acceptLoanTerms() external {
        if (msg.sender != _loanTerms.borrower) {
            revert();
        }
        if (status != DataTypes.LoanStatus.IN_NEGOTIATION) {
            revert();
        }
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        if (
            totalSubscribed < _loanTerms.minLoanAmount ||
            totalSubscribed > _loanTerms.maxLoanAmount
        ) {
            revert();
        }
        loanTermsLockedTime = block.timestamp;
        status = DataTypes.LoanStatus.BORROWER_ACCEPTED;
    }

    function finalizeLoanTermsAndTransferColl() external {
        DataTypes.LoanTerms memory _unfinalizedLoanTerms = _loanTerms;
        if (msg.sender != _unfinalizedLoanTerms.borrower) {
            revert();
        }
        if (
            status != DataTypes.LoanStatus.BORROWER_ACCEPTED ||
            block.timestamp < timeUntilLendersCanUnsubscribe()
        ) {
            revert();
        }
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        if (
            totalSubscribed < _unfinalizedLoanTerms.minLoanAmount ||
            totalSubscribed > _unfinalizedLoanTerms.maxLoanAmount
        ) {
            revert();
        }
        if (
            _unfinalizedLoanTerms.repaymentSchedule[0].dueTimestamp <=
            block.timestamp
        ) {
            revert(); // loan already due
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
        IERC20Metadata(collToken).safeTransferFrom(
            msg.sender,
            address(this),
            _finalCollAmountReservedForDefault +
                _finalCollAmountReservedForConversions
        );
    }

    function rollback() external {
        // cannot be called anymore once lockInFinalAmountsAndProvideCollateral() called
        if (status != DataTypes.LoanStatus.BORROWER_ACCEPTED) {
            revert();
        }
        uint256 totalSubscribed = IFundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        uint256 _timeUntilLendersCanUnsubscribe = timeUntilLendersCanUnsubscribe();
        if (
            (msg.sender == _loanTerms.borrower &&
                block.timestamp < _timeUntilLendersCanUnsubscribe) ||
            (block.timestamp >= _timeUntilLendersCanUnsubscribe &&
                (totalSubscribed < _loanTerms.minLoanAmount ||
                    totalSubscribed > _loanTerms.maxLoanAmount))
        ) {
            status = DataTypes.LoanStatus.ROLLBACK;
            // transfer any previously provided collToken back to borrower
            uint256 collTokenBal = IERC20Metadata(collToken).balanceOf(
                address(this)
            );
            IERC20Metadata(collToken).safeTransfer(msg.sender, collTokenBal);
        } else {
            revert();
        }
    }

    function updateStatusToDeployed() external {
        if (msg.sender != fundingPool) {
            revert();
        }
        if (status != DataTypes.LoanStatus.READY_TO_EXECUTE) {
            revert();
        }
        status = DataTypes.LoanStatus.LOAN_DEPLOYED;
    }

    function exerciseConversion() external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        uint256 repaymentIdx = currentRepaymentIdx;
        checkRepaymentIdx(repaymentIdx);
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert();
        }
        // must be after when the period of this loan is due, but before borrower can repay
        if (
            block.timestamp <
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp ||
            block.timestamp >
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                _loanTerms.repaymentSchedule[repaymentIdx].conversionGracePeriod
        ) {
            revert();
        }
        uint256 conversionAmount = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .collTokenDueIfConverted * lenderContribution) /
            IFundingPool(fundingPool).totalSubscribed(address(this));
        collTokenConverted[repaymentIdx] += conversionAmount;
        totalConvertedSubscriptionsPerIdx[repaymentIdx] += lenderContribution;
        lenderExercisedConversion[msg.sender][repaymentIdx] = true;
        IERC20Metadata(collToken).safeTransfer(msg.sender, conversionAmount);
    }

    function repay() external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        if (msg.sender != _loanTerms.borrower) {
            revert();
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
            revert();
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
        IERC20Metadata(loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            remainingLoanTokenDue
        );
        // if final repayment, send all remaining coll token back to borrower
        if (_loanTerms.repaymentSchedule.length - 1 == repaymentIdx) {
            uint256 collBal = IERC20Metadata(collToken).balanceOf(
                address(this)
            );
            IERC20Metadata(collToken).safeTransfer(msg.sender, collBal);
            // else send only unconverted coll token back to borrower
        } else {
            IERC20Metadata(collToken).safeTransfer(
                msg.sender,
                collTokenLeftUnconverted
            );
        }
    }

    function claimRepayment(uint256 repaymentIdx) external {
        uint256 lenderContribution = IFundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        if (repaymentIdx >= currentRepaymentIdx) {
            revert();
        }
        if (!_loanTerms.repaymentSchedule[repaymentIdx].repaid) {
            revert();
        }
        // can only claim after repayment cutoff date
        uint256 repaymentCutoffTime = getRepaymentCutoffTime(repaymentIdx);
        if (block.timestamp <= repaymentCutoffTime) {
            revert();
        }
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
            revert(); // must have at least one entry
        }
        if (
            repaymentSchedule[0].dueTimestamp <
            block.timestamp + Constants.MIN_TIME_UNTIL_FIRST_DUE_DATE
        ) {
            revert();
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
                revert(); // overlapping intervals or too short time between due dates
            }
            if (
                repaymentSchedule[i].conversionGracePeriod <
                Constants.MIN_CONVERSION_GRACE_PERIOD ||
                repaymentSchedule[i].repaymentGracePeriod <
                Constants.MIN_REPAYMENT_GRACE_PERIOD
            ) {
                revert();
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
            revert();
        }
    }
}
