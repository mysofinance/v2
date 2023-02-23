// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface IQuoteHandler {
    function doesAcceptOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external view returns (bool);

    function doesAcceptOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool);

    function fromQuoteToLoanInfo(
        address borrower,
        uint256 collSendAmount,
        uint256 expectedTransferFee,
        DataTypes.GeneralQuoteInfo calldata generalQuoteInfo,
        DataTypes.QuoteTuple calldata quoteTuple
    ) external view returns (DataTypes.Loan memory loan, uint256 upfrontFee);
}
