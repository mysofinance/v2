// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IERC721Wrapper {
    /**
     * @notice Allows user to create wrapped NFT token
     * @param minter Address of the minter
     * @param tokensToBeWrapped Array of NFT addresses and ids to be wrapped
     * @param name New wrapped token name
     * @param symbol New wrapped token symbol
     */
    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external returns (address);
}
