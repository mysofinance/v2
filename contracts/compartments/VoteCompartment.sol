// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVoteCompartment} from "../interfaces/IVoteCompartment.sol";

// start simple with just an example voting and rewards implementation
// could make a mapping later for more flexibility
contract VoteCompartment is Initializable {
    using SafeERC20 for IERC20;

    error InvalidSender();

    address vaultAddr;
    address borrowerAddr;
    address collTokenAddr;
    uint256 loanIdx;

    constructor() {}

    function initialize(
        address _vaultAddr,
        address _borrowerAddr,
        address _collTokenAddr,
        uint256 _loanIdx
    ) external initializer {
        vaultAddr = _vaultAddr;
        borrowerAddr = _borrowerAddr;
        collTokenAddr = _collTokenAddr;
        loanIdx = _loanIdx;
    }

    function postTransferFromVault() external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        _delegate(borrowerAddr);
    }

    function redirectDelegates(address newDelegatee) external {
        if (msg.sender != borrowerAddr) revert InvalidSender();
        _delegate(newDelegatee);
    }

    function _delegate(address delegatee) internal {
        IVoteCompartment(collTokenAddr).delegate(delegatee);
    }

    // not sure if will make this transfer to vault or borrower directly..
    // this seems to save some gas, and shouldn't affect fees
    function transferToBorrower() external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        IERC20(collTokenAddr).safeTransfer(borrowerAddr, currentCollBalance);
    }

    // unlockColl this would be called on defaults
    function unlockCollToVault() external {
        if (msg.sender != vaultAddr) revert InvalidSender();
        uint256 currentCollBalance = IERC20(collTokenAddr).balanceOf(
            address(this)
        );
        IERC20(collTokenAddr).safeTransfer(vaultAddr, currentCollBalance);
    }
}
