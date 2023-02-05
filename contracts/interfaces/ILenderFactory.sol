// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface ILenderFactory {
    function createCompartments(
        DataTypes.Loan memory loan,
        uint256 reclaimable,
        address implAddr,
        address compartmentFactory,
        uint256 numLoans,
        bytes memory data
    ) external returns (address compartmentAddr, uint128 initCollAmount);

    function registeredVaults(address vaultAddr) external returns (bool);

    function whitelistedAddrs(
        DataTypes.WhiteListType _type,
        address whitelistAddr
    ) external returns (bool);
}
