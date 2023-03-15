// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {FundingPool} from "./FundingPool.sol";
import {Constants} from "../Constants.sol";
import {DataTypes} from "./DataTypes.sol";

contract LoanProposalImpl is Initializable {
    using SafeERC20 for IERC20Metadata;

    address public fundingPool;
    address public collToken;
    address public arranger;
    uint256 public arrangerFee;
    uint256 public loanTermsLockedTime;
    uint256 public lenderGracePeriod;
    uint256 public finalLoanAmount;
    uint256 public finalCollAmount;
    uint256 public currentRepaymentIdx;
    uint256 public subscriptionsThatAlreadyClaimedRecoveryValue;
    DataTypes.LoanStatus public status;
    mapping(address => uint256) public balanceOf;
    DataTypes.LoanTerms internal _loanTerms;
    mapping(uint256 => uint256) public loanTokenRepaid;
    mapping(uint256 => uint256) public collTokenRepaid;
    mapping(uint256 => uint256) public totalConvertedContributionsPerIdx; // denominated in loan Token
    mapping(address => mapping(uint256 => bool))
        public lenderExercisedConversion;
    mapping(address => mapping(uint256 => bool)) public lenderClaimedRepayment;
    mapping(address => bool) public lenderClaimedCollateral;

    function initialize(
        address _arranger,
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external initializer {
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
        uint256 totalSubscribed = FundingPool(fundingPool).totalSubscribed(
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

    function lockInFinalAmounts() external {
        if (
            status != DataTypes.LoanStatus.BORROWER_ACCEPTED ||
            block.timestamp < loanTermsLockedTime + lenderGracePeriod
        ) {
            revert();
        }
        uint256 totalSubscribed = FundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        if (
            totalSubscribed < _loanTerms.minLoanAmount ||
            totalSubscribed > _loanTerms.maxLoanAmount
        ) {
            revert();
        }
        if (_loanTerms.repaymentSchedule[0].dueTimestamp <= block.timestamp) {
            revert(); // loan already due
        }
        status = DataTypes.LoanStatus.READY_TO_EXECUTE;
        arrangerFee = (arrangerFee * totalSubscribed) / Constants.BASE;
        finalLoanAmount = totalSubscribed - arrangerFee;
        address loanToken = FundingPool(fundingPool).depositToken();
        finalCollAmount =
            (finalLoanAmount * _loanTerms.collPerLoanToken) /
            (10 ** IERC20Metadata(loanToken).decimals());
        uint256 totalCollTokenDueIfConverted;
        for (uint256 i = 0; i < _loanTerms.repaymentSchedule.length; ) {
            _loanTerms.repaymentSchedule[i].loanTokenDue = toUint128(
                (finalLoanAmount *
                    _loanTerms.repaymentSchedule[i].loanTokenDue) /
                    Constants.BASE
            );
            _loanTerms.repaymentSchedule[i].collTokenDueIfConverted = toUint128(
                (_loanTerms.repaymentSchedule[i].loanTokenDue *
                    _loanTerms.repaymentSchedule[i].collTokenDueIfConverted) /
                    (10 ** IERC20Metadata(loanToken).decimals())
            );
            totalCollTokenDueIfConverted += _loanTerms
                .repaymentSchedule[i]
                .collTokenDueIfConverted;
            unchecked {
                i++;
            }
        }
        if (finalCollAmount < totalCollTokenDueIfConverted) {
            revert(); // possible collToken shortfall
        }
    }

    function rollback() external {
        uint256 totalSubscribed = FundingPool(fundingPool).totalSubscribed(
            address(this)
        );
        if (status != DataTypes.LoanStatus.BORROWER_ACCEPTED) {
            revert();
        }
        if (
            (msg.sender == _loanTerms.borrower &&
                block.timestamp < loanTermsLockedTime + lenderGracePeriod) ||
            (block.timestamp >= loanTermsLockedTime + lenderGracePeriod &&
                (totalSubscribed < _loanTerms.minLoanAmount ||
                    totalSubscribed > _loanTerms.maxLoanAmount))
        ) {
            status = DataTypes.LoanStatus.ROLLBACK;
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
        uint256 lenderContribution = FundingPool(fundingPool)
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
            FundingPool(fundingPool).totalSubscribed(address(this));
        collTokenRepaid[repaymentIdx] += conversionAmount;
        totalConvertedContributionsPerIdx[repaymentIdx] += lenderContribution;
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
        uint256 conversionTimeEnd = _loanTerms
            .repaymentSchedule[repaymentIdx]
            .dueTimestamp +
            _loanTerms.repaymentSchedule[repaymentIdx].conversionGracePeriod;
        if (
            (block.timestamp < conversionTimeEnd) ||
            (block.timestamp >
                conversionTimeEnd +
                    _loanTerms
                        .repaymentSchedule[repaymentIdx]
                        .repaymentGracePeriod)
        ) {
            revert();
        }
        address loanToken = FundingPool(fundingPool).depositToken();
        uint256 collTokenDue = _loanTerms
            .repaymentSchedule[repaymentIdx]
            .collTokenDueIfConverted;
        uint256 remainingCollTokenDue = collTokenDue -
            collTokenRepaid[repaymentIdx];
        uint256 remainingLoanTokenDue = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .loanTokenDue * remainingCollTokenDue) / collTokenDue;
        loanTokenRepaid[repaymentIdx] = remainingLoanTokenDue;
        _loanTerms.repaymentSchedule[repaymentIdx].repaid = true;
        IERC20Metadata(loanToken).safeTransferFrom(
            msg.sender,
            address(this),
            remainingLoanTokenDue
        );
        if (_loanTerms.repaymentSchedule.length - 1 == repaymentIdx) {
            uint256 collBal = IERC20Metadata(collToken).balanceOf(
                address(this)
            );
            IERC20Metadata(collToken).safeTransfer(msg.sender, collBal);
        } else {
            IERC20Metadata(collToken).safeTransfer(
                msg.sender,
                remainingCollTokenDue
            );
        }
    }

    function claimRepayment(uint256 repaymentIdx) external {
        if (repaymentIdx >= currentRepaymentIdx) {
            revert();
        }
        if (!_loanTerms.repaymentSchedule[repaymentIdx].repaid) {
            revert();
        }
        // must be after period for repayment claim is made default time has passed
        if (
            block.timestamp <=
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                _loanTerms
                    .repaymentSchedule[repaymentIdx]
                    .conversionGracePeriod +
                _loanTerms.repaymentSchedule[repaymentIdx].repaymentGracePeriod
        ) {
            revert();
        }
        if (lenderClaimedRepayment[msg.sender][repaymentIdx]) {
            revert();
        }
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert();
        }
        uint256 lenderContribution = FundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        address loanToken = FundingPool(fundingPool).depositToken();
        // repaid amount for that period split over those who didn't convert in that period
        uint256 claimAmount = (loanTokenRepaid[repaymentIdx] *
            lenderContribution) /
            (FundingPool(fundingPool).totalSubscribed(address(this)) -
                totalConvertedContributionsPerIdx[repaymentIdx]);
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
        if (
            block.timestamp >
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                _loanTerms
                    .repaymentSchedule[repaymentIdx]
                    .conversionGracePeriod +
                _loanTerms
                    .repaymentSchedule[repaymentIdx]
                    .repaymentGracePeriod &&
            !_loanTerms.repaymentSchedule[repaymentIdx].repaid
        ) {
            status = DataTypes.LoanStatus.DEFAULTED;
        } else {
            revert();
        }
    }

    function claimCollateralOnDefault() external {
        if (status != DataTypes.LoanStatus.DEFAULTED) {
            revert();
        }
        uint256 lenderContribution = FundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        if (lenderClaimedCollateral[msg.sender]) {
            revert();
        }
        uint256 lastPeriodIdx = currentRepaymentIdx;
        uint256 lastPeriodCollTokenDue = _loanTerms
            .repaymentSchedule[lastPeriodIdx]
            .collTokenDueIfConverted;
        uint256 collTokenBal = IERC20Metadata(collToken).balanceOf(
            address(this)
        );
        uint256 lastPeriodNonConvertedCollToken = lastPeriodCollTokenDue -
            collTokenRepaid[lastPeriodIdx];
        uint256 recoveryCollAmount = collTokenBal -
            lastPeriodNonConvertedCollToken;
        uint256 subscriptionsLeftForLastIdx = FundingPool(fundingPool)
            .totalSubscribed(address(this)) -
            totalConvertedContributionsPerIdx[lastPeriodIdx];
        uint256 subscriptionsLeftForRecoveryClaim = FundingPool(fundingPool)
            .totalSubscribed(address(this)) -
            subscriptionsThatAlreadyClaimedRecoveryValue;
        // recoveryVal split into two parts
        // 1) unconverted portion of last index is split over lenders who didn't convert OR claim yet
        // 2) rest of coll split over everyone who has not claimed
        uint256 recoveryVal = !lenderExercisedConversion[msg.sender][
            lastPeriodIdx
        ]
            ? (lastPeriodNonConvertedCollToken * lenderContribution) /
                subscriptionsLeftForLastIdx
            : 0;
        // accounts for collateral and contribution towards last index
        collTokenRepaid[lastPeriodIdx] += recoveryVal;
        // update counter for those who have claimed/converted on the coll set aside for last round
        totalConvertedContributionsPerIdx[lastPeriodIdx] += lenderContribution;
        recoveryVal +=
            (recoveryCollAmount * lenderContribution) /
            subscriptionsLeftForRecoveryClaim;
        lenderClaimedCollateral[msg.sender] = true;
        // update counter for those who have claimed
        subscriptionsThatAlreadyClaimedRecoveryValue += lenderContribution;
        IERC20Metadata(collToken).safeTransfer(msg.sender, recoveryVal);
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
                block.timestamp < loanTermsLockedTime + lenderGracePeriod);
    }

    function checkRepaymentIdx(uint256 repaymentIdx) internal view {
        // currentRepaymentIdx == _loanTerms.repaymentSchedule.length on full repay,
        if (repaymentIdx == _loanTerms.repaymentSchedule.length) {
            revert();
        }
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert();
        }
    }

    function repaymentScheduleCheck(
        DataTypes.Repayment[] memory repaymentSchedule
    ) internal pure {
        if (repaymentSchedule.length == 0) {
            revert(); // must have at least one entry
        }
        uint256 prevPeriodEnd;
        uint256 currPeriodStart;
        for (uint i = 0; i < repaymentSchedule.length; ) {
            currPeriodStart = repaymentSchedule[i].dueTimestamp;
            if (currPeriodStart <= prevPeriodEnd) {
                revert(); // overlapping intervals
            }
            if (
                repaymentSchedule[i].conversionGracePeriod *
                    repaymentSchedule[i].repaymentGracePeriod ==
                0
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
}
