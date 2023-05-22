// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedERC721Impl {
    /**
     * @notice initializes the wrapped ERC721 token
     * @param minter address of the minter
     * @param tokensToBeWrapped array of token info (address and ids array) for the tokens to be wrapped
     * @param name name of the wrapped token
     * @param symbol symbol of the wrapped token
     */
    function initialize(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external;

    function redeem() external;

    function getWrappedTokens()
        external
        view
        returns (
            DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata wrappedTokens
        );
}
