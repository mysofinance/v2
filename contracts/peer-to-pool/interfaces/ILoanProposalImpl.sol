// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface ILoanProposalImpl {
    function initialize(
        address _arranger,
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external;

    function proposeLoanTerms(
        DataTypes.LoanTerms calldata newLoanTerms
    ) external;

    function acceptLoanTerms() external;

    function finalizeLoanTermsAndTransferColl() external;

    function rollback() external;

    function updateStatusToDeployed() external;

    function exerciseConversion() external;

    function repay() external;

    function claimRepayment(uint256 repaymentIdx) external;

    function markAsDefaulted() external;

    function claimOnDefault() external;

    function status() external view returns (DataTypes.LoanStatus);

    function fundingPool() external view returns (address);

    function collToken() external view returns (address);

    function arranger() external view returns (address);

    function arrangerFee() external view returns (uint256);

    function finalLoanAmount() external view returns (uint256);

    function finalCollAmountReservedForDefault()
        external
        view
        returns (uint256);

    function finalCollAmountReservedForConversions()
        external
        view
        returns (uint256);

    function loanTermsLockedTime() external view returns (uint256);

    function loanTerms() external view returns (DataTypes.LoanTerms memory);

    function inUnsubscriptionPhase() external view returns (bool);

    function isReadyToExecute() external view returns (bool);

    function inSubscriptionPhase() external view returns (bool);
}
