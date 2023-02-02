// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/Clones.sol";
import {ICompartment} from "./interfaces/ICompartment.sol";

// start simple with just an example voting and rewards implementation
// could make a mapping later for more flexibility
contract CollateralCompartmentFactory {
    error InvalidImplAddr();
    error ZeroAddr();

    address[] compartmentImplementations;
    mapping(address => bool) isValidImplementation;
    mapping(address => bool) public isCompartment;
    address[] allCompartments;

    constructor(address[] memory _Impls) {
        for (uint i = 0; i < _Impls.length; ) {
            if (!isValidImplementation[_Impls[i]]) {
                compartmentImplementations.push(_Impls[i]);
                isValidImplementation[_Impls[i]] = true;
            }
            unchecked {
                i++;
            }
        }
    }

    /**
     * @notice function to create collateral compartments
     * @dev creates clones of a particular collateral compartment and then initializes
     * with respective implementation contracts the parent vault and the borrower
     * @param implementationAddr address of implementation Contract
     * @param vaultAddr address of parent vault
     * @param borrowerAddr address of loan borrower in vault
     * @param collTokenAddr address of collateral token
     * @param loanIdx loan index of borrow for a unique salt
     */
    function createCompartment(
        address implementationAddr,
        address vaultAddr,
        address borrowerAddr,
        address collTokenAddr,
        uint256 loanIdx
    ) external returns (address) {
        if (!isValidImplementation[implementationAddr])
            revert InvalidImplAddr();
        if (
            vaultAddr == address(0) ||
            borrowerAddr == address(0) ||
            collTokenAddr == address(0)
        ) revert ZeroAddr();

        bytes32 salt = keccak256(
            abi.encodePacked(
                implementationAddr,
                vaultAddr,
                borrowerAddr,
                collTokenAddr,
                loanIdx
            )
        );
        address newCompartmentInstanceAddr = Clones.cloneDeterministic(
            implementationAddr,
            salt
        );

        ICompartment(newCompartmentInstanceAddr).initialize(
            vaultAddr,
            borrowerAddr,
            collTokenAddr,
            loanIdx
        );

        isCompartment[newCompartmentInstanceAddr] = true;
        allCompartments.push(newCompartmentInstanceAddr);

        return newCompartmentInstanceAddr;
    }
}
