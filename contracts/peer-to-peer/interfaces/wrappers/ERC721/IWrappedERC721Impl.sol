// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedERC721Impl {
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
