// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface IOracle {
    /**
     * @notice function checks oracle validity and calculates collTokenPriceInLoanToken
     * @param collToken address of coll token
     * @param loanToken address of loan token
     * @return collTokenPriceInLoanToken collateral price denominated in loan token
     */
    function getPrice(
        address collToken,
        address loanToken
    ) external view returns (uint256 collTokenPriceInLoanToken);
}
