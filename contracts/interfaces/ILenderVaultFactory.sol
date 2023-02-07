// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVaultFactory {
    event AutoQuoteStrategy(
        address indexed vaultAddr,
        address collToken,
        address loanToken,
        address indexed strategyAddr
    );

    event CollTokenCompartmentImpl(
        address indexed vaultAddr,
        address indexed collToken,
        address indexed collTokenImplAddr
    );

    event UpdatedOffChainQuoteNonce(
        address indexed vaultAddr,
        uint256 currentNonce
    );

    event OnChainQuote(
        address indexed vaultAddr,
        DataTypes.OnChainQuote onChainQuote,
        DataTypes.OnChainQuoteUpdateType onChainQuoteUpdateType,
        bool isActive
    );

    function createCompartment(
        DataTypes.Loan memory loan,
        uint256 reclaimable,
        address implAddr,
        address compartmentFactory,
        uint256 numLoans,
        bytes memory data
    ) external returns (address compartmentAddr, uint128 initCollAmount);

    /**
     * @notice function to create vault
     * @dev creates clones of a particular vault and then initializes
     * with lender vault implementation contract
     * @param compartmentFactory address of compartment factory
     */
    function createVault(
        address compartmentFactory
    ) external returns (address newVaultAddr);

    function isRegisteredVault(address vaultAddr) external returns (bool);

    function vaultOwner(address vaultAddr) external returns (address);

    function vaultNewOwner(address vaultAddr) external returns (address);

    function whitelistedAddrs(
        DataTypes.WhiteListType _type,
        address whitelistAddr
    ) external returns (bool);
}
