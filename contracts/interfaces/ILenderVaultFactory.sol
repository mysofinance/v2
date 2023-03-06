// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVaultFactory {
    function createVault() external returns (address newLenderVaultAddr);
}
