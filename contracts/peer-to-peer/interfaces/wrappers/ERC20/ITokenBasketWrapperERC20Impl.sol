// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

interface ITokenBasketWrapperERC20Impl {
    /**
     * @notice initializes the wrapped token basket
     * @param minter address of the minter
     * @param tokenAddrs addresses of the tokens to be wrapped
     * @param totalInitialSupply total initial supply of the wrapped token basket
     * @param name name of the wrapped token basket
     * @param symbol symbol of the wrapped token basket
     */
    function initialize(
        address minter,
        address[] calldata tokenAddrs,
        uint256 totalInitialSupply,
        string calldata name,
        string calldata symbol
    ) external;

    function redeem(uint256 amount) external;

    function getAllTokenAddrs() external view returns (address[] memory);
}
