// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface ITokenBasketWrapperERC20Impl {
    function initialize(
        address tokenOwner,
        address[] calldata tokenAddrs,
        uint256 totalInitialSupply,
        string calldata name,
        string calldata symbol
    ) external;

    function redeem(uint256 amount) external;

    function getAllTokenAddrs() external view returns (address[] memory);
}
