// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/Clones.sol";
import {IBorrowerCompartment} from "./interfaces/IBorrowerCompartment.sol";
import {IBorrowerCompartmentFactory} from "./interfaces/IBorrowerCompartmentFactory.sol";

contract BorrowerCompartmentFactory is IBorrowerCompartmentFactory {
    function createCompartment(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address borrower,
        address collToken,
        uint256 loanId
    ) external returns (address newBorrowerCompartment) {
        bytes32 salt = keccak256(
            abi.encodePacked(
                borrowerCompartmentImplementation,
                lenderVault,
                borrower,
                loanId
            )
        );
        newBorrowerCompartment = Clones.cloneDeterministic(
            borrowerCompartmentImplementation,
            salt
        );

        IBorrowerCompartment(newBorrowerCompartment).initialize(
            lenderVault,
            borrower,
            collToken,
            loanId
        );
    }
}
