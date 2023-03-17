// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IQuoteHandler {
    function addOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external;

    function updateOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata oldOnChainQuote,
        DataTypes.OnChainQuote calldata newOnChainQuote
    ) external;

    function deleteOnChainQuote(
        address lenderVault,
        DataTypes.OnChainQuote calldata onChainQuote
    ) external;

    function incrementOffChainQuoteNonce(address lenderVault) external;

    function invalidateOffChainQuote(
        address lenderVault,
        bytes32 offChainQuoteHash
    ) external;

    function checkAndRegisterOnChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OnChainQuote memory onChainQuote
    ) external;

    function checkAndRegisterOffChainQuote(
        address borrower,
        address lenderVault,
        DataTypes.OffChainQuote calldata offChainQuote,
        DataTypes.QuoteTuple calldata quoteTuple,
        bytes32[] memory proof
    ) external;

    function addressRegistry() external view returns (address);

    function offChainQuoteNonce(address) external view returns (uint256);

    function offChainQuoteIsInvalidated(
        address,
        bytes32
    ) external view returns (bool);

    function isOnChainQuote(address, bytes32) external view returns (bool);
}
