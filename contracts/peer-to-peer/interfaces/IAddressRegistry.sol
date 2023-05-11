// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IAddressRegistry {
    event WhitelistStateUpdated(
        address[] indexed whitelistAddrs,
        DataTypesPeerToPeer.WhitelistState whitelistState
    );

    event AllowedCompartmentForTokenUpdated(
        address[] tokens,
        address[] compartmentImpls,
        bool[] isAllowed
    );

    /**
     * @notice initializes factory, gateway, and quote handler contracts
     * @param _lenderVaultFactory address of the factory for lender vaults
     * @param _borrowerGateway address of the gateway with which borrowers interact
     * @param _quoteHandler address of contract which handles quote logic
     */
    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external;

    /**
     * @notice adds new lender vault to registry
     * @dev can only be called lender vault factory
     * @param addr address of new lender vault
     */
    function addLenderVault(address addr) external;

    /**
     * @notice Sets the whitelist state for a given address
     * @dev Can only be called by registry owner
     * @param addrs Addresses for which whitelist state shall be set
     * @param whitelistState The whitelist state to which addresses shall be set (NOT_WHITELISTED, TOKEN, ORACLE, COMPARTMENT, or CALLBACK)
     */
    function setWhitelistState(
        address[] memory addrs,
        DataTypesPeerToPeer.WhitelistState whitelistState
    ) external;

    /**
     * @notice Sets the compartment state for a given token
     * @dev Can only be called by registry owner
     * @param tokens Tokens for which compartment state shall be set
     * @param compartmentImpls Compartment implementations for which compartment state shall be set
     * @param isAllowed The compartment state to which tokens shall be set
     */
    function setStateOfCompartmentForToken(
        address[] memory tokens,
        address[] memory compartmentImpls,
        bool[] memory isAllowed
    ) external;

    /**
     * @notice Returns the address of the vault factory
     * @return Address of the vault factory contract
     */
    function lenderVaultFactory() external view returns (address);

    /**
     * @notice Returns the address of the borrower gateway
     * @return Address of the borrower gateway contract
     */
    function borrowerGateway() external view returns (address);

    /**
     * @notice Returns the address of the quote handler
     * @return Address of the quote handler contract
     */
    function quoteHandler() external view returns (address);

    /**
     * @notice Returns boolean flag indicating whether given address is a registered vault
     * @param addr Address to check if it is a registered vault
     * @return Boolean flag indicating whether given address is a registered vault
     */
    function isRegisteredVault(address addr) external view returns (bool);

    /**
     * @notice Returns whitelist state for given address
     * @param addr Address to check whitelist state for
     * @return whitelistState Whitelist state for given address (NOT_WHITELISTED, TOKEN, ORACLE, COMPARTMENT, or CALLBACK)
     */
    function whitelistState(
        address addr
    ) external view returns (DataTypesPeerToPeer.WhitelistState whitelistState);

    /**
     * @notice Returns an array of registered vault addresses
     * @return vaultAddrs The array of registered vault addresses
     */
    function registeredVaults()
        external
        view
        returns (address[] memory vaultAddrs);

    /**
     * @notice Returns address of the owner
     * @return Address of the owner
     */
    function owner() external view returns (address);

    /**
     * @notice Returns boolean flag indicating whether given compartment implementation is allowed for given token
     * @param token Address of token to check if compartment implementation is allowed
     * @param compartmentImpl Address of compartment implementation to check if it is allowed for token
     * @return isAllowed Boolean flag indicating whether compartment implementation is allowed for token
     */
    function isAllowedCompartmentForToken(
        address token,
        address compartmentImpl
    ) external view returns (bool isAllowed);
}
