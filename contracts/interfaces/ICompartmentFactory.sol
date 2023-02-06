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
     * @param data extra data possibly needed for staking and rewards compartments (shared with vault flash loan possibly)
     */
    function createCompartment(
        address implementationAddr,
        address vaultAddr,
        address borrowerAddr,
        address collTokenAddr,
        uint256 loanIdx,
        uint256 collTokenBalBefore,
        bytes memory data
    ) external returns (address, uint128);
}
