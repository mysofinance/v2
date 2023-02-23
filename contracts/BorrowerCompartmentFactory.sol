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
        newBorrowerCompartment = Clones.cloneDeterministic(
            borrowerCompartmentImplementation,
            getSalt(
                borrowerCompartmentImplementation,
                lenderVault,
                borrower,
                loanId
            )
        );
        IBorrowerCompartment(newBorrowerCompartment).initialize(
            lenderVault,
            borrower,
            collToken,
            loanId
        );
    }

    function predictCompartmentAddress(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address borrower,
        uint256 loanId
    ) external view returns (address compartmentAddress) {
        compartmentAddress = Clones.predictDeterministicAddress(
            borrowerCompartmentImplementation,
            getSalt(
                borrowerCompartmentImplementation,
                lenderVault,
                borrower,
                loanId
            ),
            address(this)
        );
    }

    function getSalt(
        address borrowerCompartmentImplementation,
        address lenderVault,
        address borrower,
        uint256 loanId
    ) internal pure returns (bytes32 salt) {
        salt = keccak256(
            abi.encodePacked(
                borrowerCompartmentImplementation,
                lenderVault,
                borrower,
                loanId
            )
        );
    }
}
