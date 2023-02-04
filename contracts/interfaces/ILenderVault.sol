// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVault {
    function loans(uint256 index) external view returns (DataTypes.Loan memory);
}
