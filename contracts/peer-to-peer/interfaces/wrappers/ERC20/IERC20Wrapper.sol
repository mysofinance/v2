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

    /**
     * @notice Returns address registry
     * @return address registry
     */
    function addressRegistry() external view returns (address);

    /**
     * @notice Returns implementation contract address
     * @return implementation contract address
     */
    function wrappedErc20Impl() external view returns (address);

    /**
     * @notice Returns array of tokens created
     * @return array of tokens created
     */
    function tokensCreated() external view returns (address[] memory);

    /**
     * @notice Returns number of tokens created
     * @return number of tokens created
     */
    function numTokensCreated() external view returns (uint256);
}
