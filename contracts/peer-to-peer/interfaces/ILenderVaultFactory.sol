// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

interface ILenderVaultFactory {
    /**
     * @notice function creates new lender vaults
     * @return newLenderVaultAddr address of created vault
     */
    function createVault() external returns (address newLenderVaultAddr);

    /**
     * @notice function returns address registry
     */
    function addressRegistry() external view returns (address);

    /**
     * @notice function returns address of lender vault implementation contract
     */
    function lenderVaultImpl() external view returns (address);
}
