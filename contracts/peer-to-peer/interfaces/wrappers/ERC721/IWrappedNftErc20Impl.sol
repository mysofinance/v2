// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {DataTypesPeerToPeer} from "../../../DataTypesPeerToPeer.sol";

interface IWrappedNftErc20Impl {
    function initialize(
        address tokenOwner,
        DataTypesPeerToPeer.NftAddressAndIds[] calldata tokenInfo,
        string calldata name,
        string calldata symbol
    ) external;

    function redeem() external;
}
