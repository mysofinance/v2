// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IStakeCompartment {
    /**
     * @notice function to stake coll token to another address
     * @dev this function allows borrower of loan (true owner of compartment)
     * to redirect delegation to another address
     * @param borrowerAddr address to allow as owner of stake
     * (might not be needed actually, maybe just need to add unstake and track rewards?)
     * @param collTokenAddr address of coll Token
     * @param stakeAddr address of intended stake
     */
    function stake(
        address borrowerAddr,
        address collTokenAddr,
        address stakeAddr
    ) external;
}
