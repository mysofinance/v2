// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IBorrowerCompartmentFactory {
    function createCompartment(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address registryAddr,
        address borrower,
        address collToken,
        uint256 loanId,
        bytes memory data
    ) external returns (address newBorrowerCompartment);
}
