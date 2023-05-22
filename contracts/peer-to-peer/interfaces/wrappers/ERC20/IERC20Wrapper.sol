// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../../peer-to-peer/DataTypesPeerToPeer.sol";

interface IERC20Wrapper {
    /**
     * @notice Allows user to wrap multiple ERC20 into one ERC20
     * @param minter Address of the minter
     * @param tokensToBeWrapped Array of WrappedERC20TokenInfo
     * @param name Name of the new wrapper token
     * @param symbol Symbol of the new wrapper token
     */
    function createWrappedToken(
        address minter,
        DataTypesPeerToPeer.WrappedERC20TokenInfo[] calldata tokensToBeWrapped,
        string calldata name,
        string calldata symbol
    ) external returns (address);
}
