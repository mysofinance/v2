// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVault {
    function initialize(address vaultOwner, address addressRegistry) external;

    function vaultOwner() external view returns (address);

    function loans(
        uint256 index
    ) external view returns (DataTypes.Loan memory loan);

    function transferTo(
        address token,
        address recipient,
        uint256 amount
    ) external;

    function transferFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr,
        address collTokenCompartmentAddr
    ) external;

    function validateRepayInfo(
        address borrower,
        DataTypes.Loan memory loan,
        DataTypes.LoanRepayInfo memory loanRepayInfo
    ) external view;

    function updateLoanInfo(
        DataTypes.Loan memory loan,
        uint128 repayAmount,
        uint256 loanId,
        uint256 collAmount,
        bool isRepay
    ) external;

    function processQuote(
        address borrower,
        DataTypes.BorrowTransferInstructions calldata borrowInstructions,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypes.QuoteTuple calldata quoteTuple
    )
        external
        returns (
            DataTypes.Loan memory loan,
            uint256 loanId,
            uint256 upfrontFee,
            address collReceiver
        );

    function minNumOfSigners() external view returns (uint256);

    function isSigner(address signer) external view returns (bool);
}
