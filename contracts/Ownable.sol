// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Errors} from "./Errors.sol";

abstract contract Ownable {
    address internal _owner;
    address internal _newOwner;

    function proposeNewOwner(address _newOwnerProposal) external {
        senderCheckOwner();
        _owner = _newOwnerProposal;
    }

    function claimOwnership() external {
        if (msg.sender != _newOwner) {
            revert Errors.InvalidSender();
        }
        _owner = _newOwner;
    }

    function senderCheckOwner() internal view {
        if (msg.sender != _owner) {
            revert Errors.InvalidSender();
        }
    }
}