// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Errors} from "./Errors.sol";

abstract contract Ownable {
    address internal _owner;
    address internal _newOwner;

    event NewOwnerProposed(
        address indexed emitter,
        address owner,
        address newOwner
    );

    event ClaimedOwnership(
        address indexed emitter,
        address owner,
        address oldOwner
    );

    function proposeNewOwner(address _newOwnerProposal) external {
        senderCheckOwner();
        _newOwner = _newOwnerProposal;
        emit NewOwnerProposed(address(this), _owner, _newOwnerProposal);
    }

    function claimOwnership() external {
        if (msg.sender != _newOwner) {
            revert Errors.InvalidSender();
        }
        address _oldOwner = _owner;
        _owner = _newOwner;
        emit ClaimedOwnership(address(this), _owner, _oldOwner);
    }

    // note: needs to be explicitly overriden by inheriting contracts
    // (e.g., AddressRegistry) to avoid ambiguities regarding owner()
    // definitions in corresponding interfaces (e.g., IAddressRegistry)
    function owner() external view virtual returns (address);

    function senderCheckOwner() internal view {
        if (msg.sender != _owner) {
            revert Errors.InvalidSender();
        }
    }
}
