// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IAddressRegistry {
    function isWhitelistedCallbackAddr(address) external view returns (bool);

    function isWhitelistedToken(address) external view returns (bool);

    function isWhitelistedCollTokenHandler(
        address
    ) external view returns (bool);

    function isWhitelistedAutoQuoteStrategy(
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

    function setLenderVaultFactory(address addr) external;

    function setBorrowerGateway(address addr) external;

    function setQuoteHandler(address addr) external;

    function addLenderVault(address addr) external;

    function toggleTokens(address[] memory addrs) external;

    function toggleCallbackAddr(address addr) external;

    function toggleAutoQuoteStrategy(address addr) external;

    function toggleOracle(address addr) external;
}
