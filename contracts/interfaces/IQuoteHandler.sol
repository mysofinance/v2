// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface IQuoteHandler {
    function doesAcceptOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote
    ) external view returns (bool);

    function doesAcceptOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.Quote memory quote
    ) external view returns (bool);

    function fromQuoteToLoanInfo(
        address borrower,
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.Quote calldata quote,
        uint256 quoteTupleIdx
    ) external view returns (DataTypes.Loan memory loan, uint256 upfrontFee);
}
