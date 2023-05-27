// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedERC20Impl {
    /**
     * @notice Initializes the ERC20 wrapper
     * @param minter Address of the minter
     * @param wrappedTokens Array of WrappedERC20TokenInfo
     * @param totalInitialSupply Total initial supply of the wrapped token basket
     * @param name Name of the new wrapper token
     * @param symbol Symbol of the new wrapper token
     * @param isIOU Whether the wrapped token is an IOU token, i.e. it is not backed by any real ERC20 token
     */
    function initialize(
        address minter,
        DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata wrappedTokens,
        uint256 totalInitialSupply,
        string calldata name,
        string calldata symbol,
        bool isIOU
    ) external;

    function redeem(uint256 amount) external;

    function getWrappedTokensInfo()
        external
        view
        returns (
            DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata wrappedTokens
        );
}
