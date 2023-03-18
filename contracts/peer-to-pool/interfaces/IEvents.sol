// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IEvents {
    event LoanProposalExecuted(address indexed loanProposalAddr);
    event LoanProposalCreated(
        address indexed loanProposalAddr,
        address indexed fundingPool,
        address indexed sender,
        address collToken,
        uint256 arrangerFee,
        uint256 lenderGracePeriod
    );
    event Subscribed(address indexed loanProposalAddr, uint256 amount);
    event Unsubscribed(address indexed loanProposalAddr, uint256 amount);
    event LoanTermsProposed(DataTypes.LoanTerms loanTerms);
    event LoanTermsAccepted();
    event LoanTermsAndTransferCollFinalized(
        uint256 finalLoanAmount,
        uint256 _finalCollAmountReservedForDefault,
        uint256 _finalCollAmountReservedForConversions,
        uint256 _arrangerFee
    );
    event Rollback();
    event LoanDeployed();
    event ConversionExercised(
        address indexed sender,
        uint256 repaymentIdx,
        uint256 amount
    );
    event ClaimRepayment(address indexed sender, uint256 amount);
    event Repay(
        uint256 remainingLoanTokenDue,
        uint256 collTokenLeftUnconverted
    );
    event LoanDefaulted();
    event DefaultProceedsClaimed(address indexed sender);
}
