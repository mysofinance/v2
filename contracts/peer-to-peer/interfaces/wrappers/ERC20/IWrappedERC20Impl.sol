// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedERC20Impl {
    event Redeemed(address indexed redeemer, address recipient, uint256 amount);

    /**
     * @notice Initializes the ERC20 wrapper
     * @param minter Address of the minter
     * @param wrappedTokens Array of WrappedERC20TokenInfo
     * @param totalInitialSupply Total initial supply of the wrapped token basket
     * @param name Name of the new wrapper token
     * @param symbol Symbol of the new wrapper token
     * @param decimals Decimals of the new wrapper token
     * @param isIOU Whether the wrapped token is an IOU token, i.e. it is not backed by any real ERC20 token
     */
    function initialize(
        address minter,
        DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata wrappedTokens,
        uint256 totalInitialSupply,
        string calldata name,
        string calldata symbol,
        uint8 decimals,
        bool isIOU
    ) external;

    /**
     * @notice Function to redeem wrapped token for underlying tokens
     * @param account Account that is redeeming wrapped tokens
     * @param recipient Account that is receiving underlying tokens
     * @param amount Amount of wrapped tokens to be redeemed
     */
    function redeem(
        address account,
        address recipient,
        uint256 amount
    ) external;

    /**
     * @notice Returns wrapped token info
     * @return wrappedTokens array of struct containing information about wrapped tokens
     */
    function getWrappedTokensInfo()
        external
        view
        returns (
            DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata wrappedTokens
        );

    /**
     * @notice Returns whether wrapped token is IOU
     * @return boolean flag indicating whether wrapped token is IOU
     */
    function isIOU() external view returns (bool);
}
