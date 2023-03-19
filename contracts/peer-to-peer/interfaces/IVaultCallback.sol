// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import {DataTypes} from "../DataTypes.sol";

interface IVaultCallback {
    /**
     * @notice function which handles borrow side callback
     * @param loan loan data passed to the callback
     * @param data any extra info needed for the callback functionality
     */
    function borrowCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external;

    /**
     * @notice function which handles repay side callback
     * @param loan loan data passed to the callback
     * @param data any extra info needed for the callback functionality
     */
    function repayCallback(
        DataTypes.Loan calldata loan,
        bytes calldata data
    ) external;
}
