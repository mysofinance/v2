// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IVaultCallback {
    function borrowCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external;

    function repayCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external;
}
