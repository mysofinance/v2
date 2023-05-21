// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedNftERC20Impl {
    function initialize(
        address tokenOwner,
        DataTypesPeerToPeer.NftAddressAndIds[] calldata tokenInfo,
        string calldata name,
        string calldata symbol
    ) external;

    function redeem() external;

    function getAllTokenAddrs() external view returns (address[] memory);
}
