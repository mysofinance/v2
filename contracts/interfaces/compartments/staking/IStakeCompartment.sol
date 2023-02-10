// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IStakeCompartment {
    /**
     * @notice function to stake coll token to another address
     * @dev this function allows borrower of loan (true owner of compartment)
     * to redirect stake to another address
     * @param registryAddr address of registry
     * @param collTokenAddr address of collToken
     * @param data holds gauge and reward token info if needed
     */
    function stake(
        address registryAddr,
        address collTokenAddr,
        bytes memory data
    ) external;
}
