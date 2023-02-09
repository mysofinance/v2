// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IBorrowerCompartmentFactory {
    function createCompartment(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address borrower,
        uint256 loanId
    ) external returns (address newBorrowerCompartment);
}
