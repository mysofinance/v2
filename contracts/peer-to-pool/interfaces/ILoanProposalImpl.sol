// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface ILoanProposalImpl {
    /**
     * @notice Initializes loan proposal
     * @param _arranger Address of the arranger of the proposal
     * @param _fundingPool Address of the funding pool to be used to source liquidity, if successful
     * @param _collToken Address of collateral token to be used in loan
     * @param _arrangerFee Arranger fee in percent (where 100% = BASE)
     * @param _lenderGracePeriod If lenders subscribe and proposal gets they can still unsubscribe from the deal for this time period before being locked-in
     */
    function initialize(
        address _arranger,
        address _fundingPool,
        address _collToken,
        uint256 _arrangerFee,
        uint256 _lenderGracePeriod
    ) external;

    /**
     * @notice Propose new loan terms
     * @param newLoanTerms The new loan terms
     * @dev Can only be called by the arranger
     */
    function proposeLoanTerms(
        DataTypes.LoanTerms calldata newLoanTerms
    ) external;

    /**
     * @notice Accept loan terms
     * @dev Can only be called by the borrower
     */
    function acceptLoanTerms() external;

    /**
     * @notice Finalize the loan terms and transfer final collateral amount
     * @param expectedTransferFee The expected transfer fee (if any) of the collateral token
     * @dev Can only be called by the borrower
     */
    function finalizeLoanTermsAndTransferColl(
        uint256 expectedTransferFee
    ) external;

    /**
     * @notice Rolls back the loan proposal
     * @dev Can be called by borrower during the lender grace period or by anyone in case the total subscribed fell below the minLoanAmount
     */
    function rollback() external;

    /**
     * @notice Updates the status of the loan proposal to 'LOAN_DEPLOYED'
     * @dev Can only be called by funding pool in conjunction with executing the loan proposal and settling amounts, i.e., sending loan amount to borrower and fees
     */
    function updateStatusToDeployed() external;

    /**
     * @notice Allows lenders to exercise their conversion right for given repayment period
     * @dev Can only be called by entitled lenders and during conversion grace period of given repayment period
     */
    function exerciseConversion() external;

    /**
     * @notice Allows borrower to repay
     * @param expectedTransferFee The expected transfer fee (if any) of the loan token
     * @dev Can only be called by borrower and during repayment grace period of given repayment period. If borrower doesn't repay in time the loan can be marked as defaulted and borrowers loses control over pledged collateral. Note that the repayment amount can be lower than the loanTokenDue if lenders convert (potentially 0 if all convert, in which case borrower still needs to call the repay function to not default). Also note that on repay any unconverted collateral token reserved for conversions for that period get transferred back to borrower.
     */
    function repay(uint256 expectedTransferFee) external;

    /**
     * @notice Allows lenders to claim any repayments for given repayment period
     * @param repaymentIdx the given repayment period index
     * @dev Can only be called by entitled lenders and if they didn't make use of their conversion right
     */
    function claimRepayment(uint256 repaymentIdx) external;

    /**
     * @notice Marks loan proposal as defaulted
     * @dev Can be called by anyone but only if borrower failed to repay during repayment grace period
     */
    function markAsDefaulted() external;

    /**
     * @notice Allows lenders to claim default proceeds
     * @dev Can only be called if borrower defaulted and loan proposal was marked as defaulted; default proceeds are whatever is left in collateral token in loan proposal contract; proceeds are splitted among all lenders taking into account any conversions lenders already made during the default period.
     */
    function claimDefaultProceeds() external;

    /**
     * @notice Returns the amount of subscriptions that converted for given repayment period
     * @param repaymentIdx The respective repayment index of given period
     * @return The total amount of subscriptions that converted for given repayment period
     */
    function totalConvertedSubscriptionsPerIdx(
        uint256 repaymentIdx
    ) external view returns (uint256);

    /**
     * @notice Returns the amount of collateral tokens that were converted during given repayment period
     * @param repaymentIdx The respective repayment index of given period
     * @return The total amount of collateral tokens that were converted during given repayment period
     */
    function collTokenConverted(
        uint256 repaymentIdx
    ) external view returns (uint256);

    function dynamicData()
        external
        view
        returns (
            uint256 arrangerFee,
            uint256 finalLoanAmount,
            uint256 finalCollAmountReservedForDefault,
            uint256 finalCollAmountReservedForConversions,
            uint256 loanTermsLockedTime,
            uint256 currentRepaymentIdx,
            DataTypes.LoanStatus status
        );

    function staticData()
        external
        view
        returns (
            address fundingPool,
            address collToken,
            address arranger,
            uint256 lenderGracePeriod
        );

    /**
     * @notice Returns the current loan terms
     * @return The current loan terms
     */
    function loanTerms() external view returns (DataTypes.LoanTerms memory);

    /**
     * @notice Returns flag indicating whether lenders can currently unsubscribe from loan proposal
     * @return Flag indicating whether lenders can currently unsubscribe from loan proposal
     */
    function inUnsubscriptionPhase() external view returns (bool);

    /**
     * @notice Returns flag indicating whether loan proposal is ready to be executed
     * @return Flag indicating whether loan proposal is ready to be executed
     */
    function isReadyToExecute() external view returns (bool);

    /**
     * @notice Returns flag indicating whether lenders can currently subscribe to loan proposal
     * @return Flag indicating whether lenders can currently subscribe to loan proposal
     */
    function inSubscriptionPhase() external view returns (bool);

    /**
     * @notice Returns indicative final loan terms
     * @param _tmpLoanTerms The current (or assumed) relative loan terms
     * @param totalSubscribed The current (or assumed) total subscribed amount
     * @param loanTokenDecimals The loan token decimals
     * @return loanTerms The loan terms in absolute terms
     * @return absArrangerFee The arranger fee in absolute terms
     * @return absLoanAmount The loan amount in absolute terms
     * @return absCollAmountReservedForDefault The collateral token amount reserved for default claims in absolute terms
     * @return absCollAmountReservedForConversions The collateral token amount reserved for lender conversions
     */
    function getAbsoluteLoanTerms(
        DataTypes.LoanTerms memory _tmpLoanTerms,
        uint256 totalSubscribed,
        uint256 loanTokenDecimals
    )
        external
        view
        returns (
            DataTypes.LoanTerms memory loanTerms,
            uint256 absArrangerFee,
            uint256 absLoanAmount,
            uint256 absCollAmountReservedForDefault,
            uint256 absCollAmountReservedForConversions
        );
}
