// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface IQuoteHandler {
    function doesVaultAcceptOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external view returns (bool);

    function doesVaultAcceptOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote memory onChainQuote
    ) external view returns (bool);
}
