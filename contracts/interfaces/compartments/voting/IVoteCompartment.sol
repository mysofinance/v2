// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

interface IVoteCompartment is IVotes {
    /**
     * @notice function to redirect delegate votes to another address
     * @dev this function allows borrower of loan (true owner of compartment)
     * to redirect delegation to another address
     * @param delegatee address of intended delegate
     */
    function redirectDelegate(address delegatee) external;
}
