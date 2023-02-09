// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVaultFactory {
    function createVault() external returns (address newLenderVaultAddr);
}
