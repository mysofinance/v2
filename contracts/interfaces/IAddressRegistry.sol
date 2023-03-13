// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface IAddressRegistry {
    function initialize(
        address _lenderVaultFactory,
        address _borrowerGateway,
        address _quoteHandler
    ) external;

    function addLenderVault(address addr) external;

    function toggleTokens(address[] memory addrs) external;

    function toggleCallbackAddr(address addr) external;

    function toggleOracle(address addr) external;

    function isWhitelistedCallbackAddr(address) external view returns (bool);

    function isWhitelistedToken(address) external view returns (bool);

    function isWhitelistedCollTokenHandler(
        address
    ) external view returns (bool);

    function isWhitelistedTokenPair(
        address collToken,
        address loanToken
    ) external view returns (bool);

    function isWhitelistedOracle(
        address oracleAddr
    ) external view returns (bool);

    function isRegisteredVault(address addr) external view returns (bool);

    function borrowerGateway() external view returns (address);

    function quoteHandler() external view returns (address);

    function owner() external view returns (address);
}
