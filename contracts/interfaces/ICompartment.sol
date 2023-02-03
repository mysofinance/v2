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
     * @notice function to unlock all collateral left in compartment
     * @dev this function can only be called by vault and returns all collateral to vault
     */
    function unlockCollToVault() external;

    /**
     * @notice function to transfer some amount of collateral to borrower on repay
     * @dev this function can only be called by vault and returns amount to borrower address
     * @param amount amount of collateral token to send back to borrower
     */
    function transferCollToBorrower(uint256 amount) external;
}
