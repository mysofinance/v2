// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IBorrowerCompartment {
    //shared compartment errors
    error InvalidSender();
    error InvalidPool();

    /**
     * @notice function to initialize collateral compartment
     * @dev factory creates clone and then initializes implementation contract
     * @param vaultAddr address of vault
     * @param registryAddr address of registry
     * @param borrowerAddr address of borrower
     * @param collTokenAddr address of collToken
     * @param loanId index of the loan
     * @param data holds gauge and reward token info if needed
     */
    function initialize(
        address vaultAddr,
        address registryAddr,
        address borrowerAddr,
        address collTokenAddr,
        uint256 loanId,
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
     * @dev this function can only be called by vault and tranfers proportional amount
     * of compartment collTokenBalance to borrower address. This needs use a proportion
     * and not the amount to account for possible changes due to rewards accruing
     * @param repayAmount amount of loan token being sent to vault
     * @param repayAmountLeft amount of loan token still outstanding
     * @param borrowerAddr address of borrower receiving transfer
     * @param collTokenAddr address of collateral token being transferred
     * @param callbackAddr address to send collateral to instead of borrower if using callback
     */
    function transferCollFromCompartment(
        uint256 repayAmount,
        uint256 repayAmountLeft,
        address borrowerAddr,
        address collTokenAddr,
        address callbackAddr
    ) external;
}
