// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;
interface IVaultPriceOracle {

    function getPrice(address[] memory loanAndCollToken) external view returns (uint256);
}