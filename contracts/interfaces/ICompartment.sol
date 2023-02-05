// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface ICompartment {
    /**
     * @notice function to initialize collateral compartment
     * @dev factory creates clone and then initializes implementation contract
     * @param vaultAddr address of vault
     * @param borrowerAddr address of borrower
     * @param collTokenAddr address of coll token
     * @param loanIdx index of the loan
     * @param data data needed possibly if stake or rewards pool
     */
    function initialize(
        address vaultAddr,
        address borrowerAddr,
        address collTokenAddr,
        uint256 loanIdx,
        bytes memory data
    ) external;

    /**
     * @notice function to unlock all collateral left in compartment
     * @dev this function can only be called by vault and returns all collateral to vault
     * @param collTokenAddr pass in collToken addr to avoid callback reads gas cost
     */
    function unlockCollToVault(address collTokenAddr) external;

    /**
     * @notice function to transfer some amount of collateral to borrower on repay
     * @dev this function can only be called by vault and returns amount to borrower address
     * @param amount amount of collateral token to send back to borrower
     * @param borrowerAddr address of borrower receiving transfer
     * @param collTokenAddr address of collateral token being transferred
     */
    function transferCollToBorrower(
        uint256 amount,
        address borrowerAddr,
        address collTokenAddr
    ) external;
}
