// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;
interface IVaultRateOracle {

    function getRate(address[] memory loanAndCollToken, uint256 collPriceDenomInLoanCcy, uint256 ltv, uint256 tenor, uint256 collAmount) external view returns (uint256);
}