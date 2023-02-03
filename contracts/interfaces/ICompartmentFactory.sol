// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface ICompartmentFactory {
    /**
     * @notice function to create collateral compartments
     * @dev creates clones of a particular collateral compartment and then initializes
     * with respective implementation contracts the parent vault and the borrower
     * @param implementationAddr address of implementation Contract
     * @param vaultAddr address of parent vault
     * @param borrowerAddr address of loan borrower in vault
     * @param collTokenAddr address of collateral token
     * @param loanIdx loan index of borrow for a unique salt
     */
    function createCompartment(
        address implementationAddr,
        address vaultAddr,
        address borrowerAddr,
        address collTokenAddr,
        uint256 loanIdx
    ) external returns (address);
}
