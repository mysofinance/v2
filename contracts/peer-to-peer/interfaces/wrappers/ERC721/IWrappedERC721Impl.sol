// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedERC721Impl {
    event Redeemed(address indexed redeemer);

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
     * @notice Redeems the wrapped tokens
     * @dev This function can only be called by the owner of the erc20 wrapper
     * @dev This function can only be called once then token is burnt
     * @dev Any stuck tokens can be swept by the redeemer later
     */
    function redeem() external;

    /**
     * @notice Transfers any stuck wrapped tokens to the redeemer
     * @param tokenAddr Address of the token to be swept
     * @param tokenIds Array of token ids to be swept
     */
    function sweepTokensLeftAfterRedeem(
        address tokenAddr,
        uint256[] calldata tokenIds
    ) external;

    function getWrappedTokensInfo()
        external
        view
        returns (
            DataTypesPeerToPeer.WrappedERC721TokenInfo[] calldata wrappedTokens
        );
}
