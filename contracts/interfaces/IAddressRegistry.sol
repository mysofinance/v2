// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IAddressRegistry {
    function isWhitelistedTokenPair(address) external view returns (bool);

    function isWhitelistedCallbackAddr(address) external view returns (bool);

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

    function isRegisteredVault(address addr) external view returns (bool);

    function borrowerGateway() external view returns (address);

    function setLenderVaultFactory(address addr) external;

    function setBorrowerGateway(address addr) external;

    function addLenderVault(address addr) external;

    function toggleTokenPair(address addr) external;

    function toggleCallbackAddr(address addr) external;

    function toggleCollTokenHandler(address addr) external;

    function toggleAutoQuoteStrategy(address addr) external;
}
