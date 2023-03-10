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
    DataTypes.LoanStatus public status;
    mapping(address => uint256) public balanceOf;
    DataTypes.LoanTerms _loanTerms;
    mapping(uint256 => uint256) public loanTokenRepaid;
    mapping(uint256 => uint256) public collTokenRepaid;
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
            ((block.timestamp >= loanTermsLockedTime + lenderGracePeriod &&
                totalSubscribed < _loanTerms.minLoanAmount) ||
                totalSubscribed > _loanTerms.maxLoanAmount)
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

    function exerciseConversion(uint256 repaymentIdx) external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        checkRepaymentIdx(repaymentIdx);
        uint256 lenderContribution = FundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert();
        }
        if (
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
        lenderExercisedConversion[msg.sender][repaymentIdx] = true;
        // still need to thinkabout this update
        FundingPool(fundingPool).updateLenderDataOnConversion(
            msg.sender,
            conversionAmount,
            finalCollAmount
        );
        IERC20Metadata(collToken).safeTransfer(msg.sender, conversionAmount);
    }

    function repay(uint256 repaymentIdx) external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        if (msg.sender != _loanTerms.borrower) {
            revert();
        }
        checkRepaymentIdx(repaymentIdx);
        if (
            block.timestamp >
            _loanTerms.repaymentSchedule[repaymentIdx].dueTimestamp +
                _loanTerms
                    .repaymentSchedule[repaymentIdx]
                    .conversionGracePeriod +
                _loanTerms.repaymentSchedule[repaymentIdx].repaymentGracePeriod
        ) {
            revert();
        }
        uint256 collTokenDue = _loanTerms
            .repaymentSchedule[repaymentIdx]
            .collTokenDueIfConverted;
        uint256 remainingLoanTokenDue = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .loanTokenDue * (collTokenDue - collTokenRepaid[repaymentIdx])) /
            collTokenDue;
        loanTokenRepaid[repaymentIdx] += remainingLoanTokenDue;
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
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
        checkRepaymentIdx(repaymentIdx);
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
        uint256 lenderContribution = FundingPool(fundingPool)
            .subscribedBalanceOf(address(this), msg.sender);
        if (lenderContribution == 0) {
            revert();
        }
        if (lenderExercisedConversion[msg.sender][repaymentIdx]) {
            revert();
        }
        uint256 claimAmount = (_loanTerms
            .repaymentSchedule[repaymentIdx]
            .loanTokenDue * lenderContribution) /
            FundingPool(fundingPool).totalSubscribed(address(this));
        lenderClaimedRepayment[msg.sender][repaymentIdx] = true;
        IERC20Metadata(collToken).safeTransfer(msg.sender, claimAmount);
    }

    function markAsDefaulted(uint256 repaymentIdx) external {
        if (status != DataTypes.LoanStatus.LOAN_DEPLOYED) {
            revert();
        }
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
        uint256 recoveryVal = (IERC20Metadata(collToken).balanceOf(
            address(this)
        ) * lenderContribution) /
            FundingPool(fundingPool).totalSubscribed(address(this));
        lenderClaimedCollateral[msg.sender] = true;
        IERC20Metadata(collToken).safeTransfer(msg.sender, recoveryVal);
    }

    function checkRepaymentIdx(uint256 repaymentIdx) internal view {
        if (repaymentIdx >= _loanTerms.repaymentSchedule.length) {
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
