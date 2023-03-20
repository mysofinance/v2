// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface IAddressRegistry {
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
     * @notice toggles whitelist status of provided tokens
     * @dev can only be called by registry owner
     * @param addrs addresses of tokens
     * @param whitelistStatus true if whitelisted, else false to delist
     */
    function toggleTokens(
        address[] memory addrs,
        bool whitelistStatus
    ) external;

    /**
     * @notice toggles whitelist status of callback
     * @dev can only be called by registry owner
     * @param addr address of callback
     * @param whitelistStatus true if whitelisted, else false to delist
     */
    function toggleCallbackAddr(address addr, bool whitelistStatus) external;

    /**
     * @notice toggles whitelist status of compartment
     * @dev can only be called by registry owner
     * @param addr address of compartment
     * @param whitelistStatus true if whitelisted, else false to delist
     */
    function toggleCompartmentImpl(address addr, bool whitelistStatus) external;

    /**
     * @notice toggles whitelist status of oracle
     * @dev can only be called by registry owner
     * @param addr address of oracle
     * @param whitelistStatus true if whitelisted, else false to delist
     */
    function toggleOracle(address addr, bool whitelistStatus) external;

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
     * @notice Returns boolean flag indicating whether given address is a whitelisted token
     * @param addr Address to check if it is a whitelisted token
     * @return Boolean flag indicating whether given address is a whitelisted token
     */
    function isWhitelistedToken(address addr) external view returns (bool);

    /**
     * @notice Returns boolean flag indicating whether given address is a whitelisted callback contract
     * @param addr Address to check if it is a whitelisted callback contract
     * @return Boolean flag indicating whether given address is a whitelisted callback contract
     */
    function isWhitelistedCallbackAddr(
        address addr
    ) external view returns (bool);

    /**
     * @notice Returns boolean flag indicating whether given address is a whitelisted compartment implementation contract
     * @param addr Address to check if it is a whitelisted compartment implementation contract
     * @return Boolean flag indicating whether given address is a whitelisted compartment implementation contract
     */
    function isWhitelistedCompartmentImpl(
        address addr
    ) external view returns (bool);

    /**
     * @notice Returns boolean flag indicating whether given address is a whitelisted oracle contract
     * @param addr Address to check if it is a whitelisted oracle contract
     * @return Boolean flag indicating whether given address is a whitelisted oracle contract
     */
    function isWhitelistedOracle(address addr) external view returns (bool);

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
