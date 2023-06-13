// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IERC721Wrapper {
    /**
     * @notice Allows user to wrap (multiple) ERC721 into one ERC20
     * @param minter Address of the minter
     * @param tokensToBeWrapped Array of WrappedERC721TokenInfo
     * @param name Name of the new wrapper token
     * @param symbol Symbol of the new wrapper token
     */
    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external returns (address);

    /**
     * @notice Returns the number of tokens created
     * @return numTokens Number of tokens created
     */
    function numTokensCreated() external view returns (uint256 numTokens);
}
