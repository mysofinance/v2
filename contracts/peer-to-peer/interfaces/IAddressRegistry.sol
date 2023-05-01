// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../DataTypesPeerToPeer.sol";

interface IAddressRegistry {
    event WhitelistStateUpdated(
        address[] indexed whitelistAddrs,
        DataTypesPeerToPeer.WhitelistState whitelistState
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
     * @notice Allows user to claim whitelisted status
     * @param whitelistAuthority Address of whitelist authorithy
     * @param whitelistedUntil Timestamp until when user is whitelisted
     * @param v Part of signature from whitelist authority
     * @param r Part of signature from whitelist authority
     * @param s Part of signature from whitelist authority
     * @param salt Salt to make signature unique
     */
    function claimWhitelistStatus(
        address whitelistAuthority,
        uint256 whitelistedUntil,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes32 salt
    ) external;

    /**
     * @notice Allows whitelist authority to set the whitelist state for a given borrower
     * @param whitelistAuthority Address of whitelist authorithy
     * @param borrower Address of the borrower
     * @param whitelistedUntil Timestamp until which borrower shall be whitelisted
     */
    function updateBorrowerWhitelist(
        address whitelistAuthority,
        address borrower,
        uint256 whitelistedUntil
    ) external;

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
     * @notice Returns boolean flag indicating whether the borrower has been whitelisted by whitelistAuthority
     * @param whitelistAuthority Addresses of the whitelist authority
     * @param borrower Addresses of the borrower
     * @return Boolean flag indicating whether the borrower has been whitelisted by whitelistAuthority
     */
    function isWhitelistedBorrower(
        address whitelistAuthority,
        address borrower
    ) external view returns (bool);

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
}
