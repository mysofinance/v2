// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {FundingPool} from "./FundingPool.sol";
import {DataTypes} from "./DataTypes.sol";

contract LoanProposalImpl is Initializable {
    using SafeERC20 for IERC20Metadata;

    address public fundingPool;
    address public loanToken;
    address public collToken;
    address public arranger;
    uint256 public arrangerFee;
    uint256 public loanTermsLockedTime;
    uint256 public lenderGracePeriod;
    uint256 public finalLoanAmount;
    uint256 public finalCollAmount;
    uint256 public currentRepaymentIdx;
    DataTypes.LoanStatus public status;
    mapping(address => uint256) public balanceOf;
    DataTypes.LoanTerms _loanTerms;
    mapping(uint256 => uint256) public loanTokenRepaid;
    mapping(uint256 => uint256) public collTokenRepaid;
    mapping(uint256 => uint256) public totalStakedConversionsPerIdx;
    mapping(address => mapping(uint256 => bool))
        public lenderExercisedConversion;
    mapping(address => mapping(uint256 => bool)) public lenderClaimedRepayment;
    mapping(address => bool) public lenderClaimedCollateral;

    function initialize(
        address _arranger,
        address _fundingPool,
        address _loanToken,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external initializer {
        fundingPool = _fundingPool;
        loanToken = _loanToken;
        collToken = _collToken;
        arranger = _arranger;
        arrangerFee = _arrangerFee;
        lenderGracePeriod = _lenderGracePeriod;
    }

    function loanTerms() external view returns (DataTypes.LoanTerms memory) {
        return _loanTerms;
    }

    function inSubscriptionPhase() public view returns (bool) {
        return
            status == DataTypes.LoanStatus.IN_NEGOTIATION ||
            (status == DataTypes.LoanStatus.BORROWER_ACCEPTED &&
                block.timestamp < loanTermsLockedTime + lenderGracePeriod);
    }

    function inUnsubscriptionPhase() external view returns (bool) {
        return inSubscriptionPhase() || status == DataTypes.LoanStatus.ROLLBACK;
    }

    function isReadyToExecute() external view returns (bool) {
        return status == DataTypes.LoanStatus.READY_TO_EXECUTE;
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
        status = DataTypes.LoanStatus.READY_TO_EXECUTE;
        arrangerFee = (arrangerFee * totalSubscribed) / 1e18;
        finalLoanAmount = totalSubscribed - arrangerFee;
        finalCollAmount =
            (finalLoanAmount * _loanTerms.collPerLoanToken) /
            (10 ** IERC20Metadata(loanToken).decimals());
        // todo: sanity check on successive repayment periods not overlapping and
        // collToken conversion amounts sum less than finalCollAmount
        for (uint256 i = 0; i < _loanTerms.repaymentSchedule.length; ) {
            _loanTerms.repaymentSchedule[i].loanTokenDue = toUint128(
                (finalLoanAmount *
                    _loanTerms.repaymentSchedule[i].loanTokenDue) / 1e18
            );
            _loanTerms.repaymentSchedule[i].collTokenDueIfConverted = toUint128(
                (_loanTerms.repaymentSchedule[i].loanTokenDue *
                    _loanTerms.repaymentSchedule[i].collTokenDueIfConverted) /
                    (10 ** IERC20Metadata(loanToken).decimals())
            );
            unchecked {
                i++;
            }
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
        totalStakedConversionsPerIdx[repaymentIdx] += lenderContribution;
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
        if (
            (block.timestamp <
                _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                    _loanTerms
                        .repaymentSchedule[repaymentIdx]
                        .conversionGracePeriod) ||
            (block.timestamp >
                _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                    _loanTerms
                        .repaymentSchedule[repaymentIdx]
                        .conversionGracePeriod +
                    _loanTerms
                        .repaymentSchedule[repaymentIdx]
                        .repaymentGracePeriod)
        ) {
            revert();
        }
        if (
            repaymentIdx > 0 &&
            !_loanTerms.repaymentSchedule[repaymentIdx - 1].repaid
        ) {
            revert(); // previous loan defaulted
        }
        uint256 collTokenDue = _loanTerms
            .repaymentSchedule[repaymentIdx]
            .collTokenDueIfConverted;
        uint256 remainingLoanTokenDue = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .loanTokenDue * (collTokenDue - collTokenRepaid[repaymentIdx])) /
            collTokenDue;
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
        }
    }

    function claimRepayment(uint256 repaymentIdx) external {
        checkRepaymentIdx(repaymentIdx);
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
        // repaid amount for that period split over those who didn't convert in that period
        uint256 claimAmount = (loanTokenRepaid[repaymentIdx] *
            lenderContribution) /
            (FundingPool(fundingPool).totalSubscribed(address(this)) -
                totalStakedConversionsPerIdx[repaymentIdx]);
        lenderClaimedRepayment[msg.sender][repaymentIdx] = true;
        IERC20Metadata(loanToken).safeTransfer(msg.sender, claimAmount);
    }

    function markAsDefaulted() external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        uint256 repaymentIdx = currentRepaymentIdx;
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
        // recoverVal split into two parts
        // 1) unconverted portion of last index is split over lenders who didn't convert
        // 2) rest of coll split over everyone
        uint256 recoveryVal = !lenderExercisedConversion[msg.sender][
            lastPeriodIdx
        ]
            ? (lastPeriodNonConvertedCollToken * lenderContribution) /
                (FundingPool(fundingPool).totalSubscribed(address(this)) -
                    totalStakedConversionsPerIdx[lastPeriodIdx])
            : 0;
        recoveryVal +=
            ((collTokenBal - lastPeriodNonConvertedCollToken) *
                lenderContribution) /
            FundingPool(fundingPool).totalSubscribed(address(this));
        lenderClaimedCollateral[msg.sender] = true;
        IERC20Metadata(collToken).safeTransfer(msg.sender, recoveryVal);
    }

    function checkRepaymentIdx(uint256 repaymentIdx) internal view {
        // currentRepaymentIdx == _loanTerms.repaymentSchedule.length on full repay,
        // so second equality check needed
        if (
            repaymentIdx > currentRepaymentIdx ||
            repaymentIdx == _loanTerms.repaymentSchedule.length
        ) {
            revert();
        }
    }

    function toUint128(uint256 x) internal pure returns (uint128 y) {
        y = uint128(x);
        if (y != x) {
            revert();
        }
    }
}
