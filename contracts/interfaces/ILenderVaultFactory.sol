// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderVaultFactory {
    function createCompartment(
        DataTypes.Loan memory loan,
        uint256 reclaimable,
        address implAddr,
        address compartmentFactory,
        uint256 numLoans,
        bytes memory data
    ) external returns (address compartmentAddr, uint128 initCollAmount);

    function createVault() external returns (address newVaultAddr);
}
