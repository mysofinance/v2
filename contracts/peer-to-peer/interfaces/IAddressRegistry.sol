// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface IAddressRegistry {
    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external;

    function toggleTokens(
        address[] memory addrs,
        bool whitelistStatus
    ) external;

    function toggleCallbackAddr(address addr, bool whitelistStatus) external;

    function toggleCompartmentImpl(address addr, bool whitelistStatus) external;

    function toggleOracle(address addr, bool whitelistStatus) external;

    function addLenderVault(address addr) external;

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

    function owner() external view returns (address);
}
