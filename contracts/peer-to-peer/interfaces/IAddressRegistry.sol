// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface IAddressRegistry {
    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external;

    function addLenderVault(address addr) external;

    function toggleTokens(
        address[] memory addrs,
        bool whitelistStatus
    ) external;

    function toggleCallbackAddr(address addr, bool whitelistStatus) external;

    function toggleOracle(address addr, bool whitelistStatus) external;

    function isWhitelistedCallbackAddr(
        address addr
    ) external view returns (bool);

    function isWhitelistedToken(address addr) external view returns (bool);

    function isWhitelistedCollTokenHandler(
        address
    ) external view returns (bool);

    function isWhitelistedOracle(
        address oracleAddr
    ) external view returns (bool);

    function isRegisteredVault(address addr) external view returns (bool);

    function borrowerGateway() external view returns (address);

    function quoteHandler() external view returns (address);

    function owner() external view returns (address);
}
