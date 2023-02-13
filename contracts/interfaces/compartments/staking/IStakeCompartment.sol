// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

interface IStakeCompartment {
    /**
     * @notice function to stake or delegate coll token
     * @dev this function allows borrower of loan (true owner of compartment)
     * to stake or if voting, delegate votes
     * @param data holds gauge index, delegate addr, or other reward token info if needed
     */
    function stake(bytes memory data) external;
}
