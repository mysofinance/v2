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

    function lenderVaultFactory() external view returns (address);

    function borrowerGateway() external view returns (address);

    function quoteHandler() external view returns (address);

    function isRegisteredVault(address addr) external view returns (bool);

    function isWhitelistedToken(address addr) external view returns (bool);

    function isWhitelistedCallbackAddr(
        address addr
    ) external view returns (bool);

    function isWhitelistedCompartmentImpl(address) external view returns (bool);

    function isWhitelistedOracle(
        address oracleAddr
    ) external view returns (bool);

    function registeredVaultLength() external view returns (uint256);

    function owner() external view returns (address);
}
