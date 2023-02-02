// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import {DataTypes} from "../DataTypes.sol";

interface IVaultFlashCallback {
    function vaultFlashCallback(
        DataTypes.Loan calldata loanQuote,
        bytes calldata data
    ) external;
}
