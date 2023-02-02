// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface ICompartment {
    /**
     * @notice function to initialize collateral compartment
     * @dev factory creates clone and then initializes implementation contract
     * @param vaultAddr address of vault
     * @param borrowerAddr address of borrower
     * @param collTokenAddr address of collateral token
     * @param loanIdx index of loan for given vault
     */
    function initialize(
        address vaultAddr,
        address borrowerAddr,
        address collTokenAddr,
        uint256 loanIdx
    ) external;

    /**
     * @notice function to run after vault created and initialized
     * @dev could possibly look into using the salted address to transfer first,
     * then move this in initializer...but for now will call right when returns from creation
     */
    function postTransferFromVault() external;
}
