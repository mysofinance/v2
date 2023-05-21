// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface ITokenBasketWrapper {
    function createWrappedTokenBasket(
        address tokenOwner,
        address[] calldata tokenAddrs,
        uint256[] calldata tokenAmounts,
        uint256 minAmount,
        string calldata name,
        string calldata symbol
    ) external returns (address);
}
