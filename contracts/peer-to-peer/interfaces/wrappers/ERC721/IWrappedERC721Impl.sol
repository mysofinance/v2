// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedERC721Impl {
    event Redeemed(address indexed redeemer, address recipient);

    event TransferFromWrappedTokenFailed(
        address indexed tokenAddr,
        uint256 indexed tokenId
    );

    event TokenSweepAttempted(address indexed tokenAddr, uint256[] tokenIds);

    /**
     * @notice Initializes the ERC20 wrapper
     * @param minter Address of the minter
     * @param tokensToBeWrapped Array of token info (address and ids array) for the tokens to be wrapped
     * @param name Name of the new wrapper token
     * @param symbol Symbol of the new wrapper token
     */
    function initialize(
        address minter,
        DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external;

    /**
     * @notice Transfers any stuck wrapped tokens to the redeemer
     * @param tokenAddr Address of the token to be swept
     * @param tokenIds Array of token ids to be swept
     */
    function sweepTokensLeftAfterRedeem(
        address tokenAddr,
        uint256[] calldata tokenIds
    ) external;

    /**
     * @notice Function to redeem wrapped token for underlying tokens
     * @param account Account that is redeeming wrapped tokens
     * @param recipient Account that is receiving underlying tokens
     */
    function redeem(address account, address recipient) external;

    /**
     * @notice Returns wrapped token info
     * @return wrappedTokens array of struct containing information about wrapped tokens
     */
    function getWrappedTokensInfo()
        external
        view
        returns (
            DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata wrappedTokens
        );
}
