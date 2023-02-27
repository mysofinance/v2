// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IOracle {
    function getPrice(
        address collToken,
        address loanToken
    ) external view returns (uint256 collTokenPriceInLoanToken);

    function setOracleAddrs(
        address[] memory tokenAddrs,
        address[] memory oracleAddrs,
        bool[] memory isEth
    ) external;
}
