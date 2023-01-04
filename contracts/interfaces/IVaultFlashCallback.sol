// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;
interface IVaultFlashCallback {

    function vaultFlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external;
}