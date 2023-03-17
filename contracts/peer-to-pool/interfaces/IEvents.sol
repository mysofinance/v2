// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IEvents {
    event LoanProposalExecuted(address indexed loanProposalAddr);
    event LoanProposalCreated(
        address indexed loanProposalAddr,
        address indexed fundingPool,
        address collToken,
        uint256 arrangerFee,
        uint256 lenderGracePeriod
    );
    event Subscribed(address indexed loanProposalAddr, uint256 amount);
    event Unsubscribed(address indexed loanProposalAddr, uint256 amount);
    event LoanTermsProposed(
        address indexed fundingPool,
        DataTypes.LoanTerms loanTerms
    );
    event LoanTermsAccepted(address indexed fundingPool);
    event LoanTermsAndTransferCollFinalized(address indexed fundingPool);
    event Rollback(address indexed fundingPool);
    event LoanDeployed(address indexed fundingPool);
    event ConversionExercised(address indexed fundingPool);
    event ClaimRepayment(address indexed fundingPool);
    event Repay(address indexed fundingPool);
    event LoanDefaulted(address indexed fundingPool);
    event ClaimDefaultProceeded(address indexed fundingPool);
}
