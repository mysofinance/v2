// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import {Errors} from "./Errors.sol";

abstract contract Ownable {
    address internal _owner;
    address internal _newOwner;

    event NewOwnerProposed(address indexed owner, address newOwner);

    event ClaimedOwnership(address indexed owner, address oldOwner);

    constructor() {
        _initialize(msg.sender);
    }

    function proposeNewOwner(address _newOwnerProposal) external {
        _senderCheckOwner();
        _newOwnerProposalCheck(_newOwnerProposal);
        _newOwner = _newOwnerProposal;
        emit NewOwnerProposed(_owner, _newOwnerProposal);
    }

    function claimOwnership() external {
        address tmpNewOwner = _newOwner;
        if (msg.sender != tmpNewOwner) {
            revert Errors.InvalidSender();
        }
        address oldOwner = _owner;
        _owner = tmpNewOwner;
        delete _newOwner;
        emit ClaimedOwnership(tmpNewOwner, oldOwner);
    }

    // note: needs to be explicitly overriden by inheriting contracts
    // (e.g., AddressRegistry) to avoid ambiguities regarding owner()
    // definitions in corresponding interfaces (e.g., IAddressRegistry)
    function owner() external view virtual returns (address);

    function _initialize(address initOwner) internal {
        _owner = initOwner;
    }

    function _senderCheckOwner() internal view {
        if (msg.sender != _owner) {
            revert Errors.InvalidSender();
        }
    }

    function _newOwnerProposalCheck(
        address _newOwnerProposal
    ) internal view virtual {
        if (
            _newOwnerProposal == address(this) || _newOwnerProposal == _newOwner
        ) {
            revert Errors.InvalidNewOwnerProposal();
        }
    }
}
